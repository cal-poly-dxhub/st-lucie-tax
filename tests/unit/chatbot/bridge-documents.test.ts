import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The bridge imports getPool, uploadDocument, and S3Client at module load.
// Mock all three (hoisted) before importing the module under test.
const { poolQuery, uploadDocument, s3Send } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  uploadDocument: vi.fn(),
  s3Send: vi.fn(),
}));

vi.mock("@st-lucie/data-access", () => ({
  getPool: () => ({ query: poolQuery }),
}));
vi.mock("@st-lucie/office-ops/documents", () => ({
  uploadDocument,
}));
vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = s3Send;
  }
  class GetObjectCommand {
    constructor(public input: unknown) {}
  }
  return { S3Client, GetObjectCommand };
});

import { bridgeSessionDocuments } from "../../../services/chatbot/src/scheduling/bridge-documents.js";
import type { Session } from "@st-lucie/shared-types";

const APPT = 501;

// Minimal Session with just the fields the bridge reads.
function sessionWith(
  docs: unknown[],
  resolvedBuckets?: { bringIns?: unknown[]; optionalUploads?: unknown[]; forms?: unknown[] },
): Session {
  return {
    structuredContext: {
      documents: docs,
      resolvedBuckets: resolvedBuckets
        ? {
            bringIns: resolvedBuckets.bringIns ?? [],
            optionalUploads: resolvedBuckets.optionalUploads ?? [],
            forms: resolvedBuckets.forms ?? [],
          }
        : undefined,
    },
  } as unknown as Session;
}

function validatedDoc(itemId: string, filename: string, reason = "looks good") {
  return {
    documentType: "freeform label that should NOT be used",
    txnTypeId: "dl-renewal",
    status: "validated",
    s3Key: `uploads/stlucie/sess-abc/${itemId}/${filename}`,
    validationResult: JSON.stringify({ verdict: "accept", reason }),
  };
}

function pendingDoc(itemId: string) {
  return {
    documentType: itemId,
    txnTypeId: "dl-renewal",
    status: "pending",
  };
}

function catalogItem(itemId: string, bucket = "bring_in") {
  return { itemId, label: `Label for ${itemId}`, bucket };
}

// An accept GetObject returning some bytes.
function s3ObjectBody(bytes = "filebytes") {
  return {
    Body: (async function* () {
      yield new TextEncoder().encode(bytes);
    })(),
  };
}

beforeEach(() => {
  process.env.DOC_BUCKET = "chatbot-bucket";
  process.env.DOCUMENTS_BUCKET = "office-bucket";
  poolQuery.mockReset();
  uploadDocument.mockReset();
  s3Send.mockReset();
  // default: no existing documents row (idempotency SELECT returns empty)
  poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  uploadDocument.mockResolvedValue({ documentId: 1, s3Key: "office/key" });
  s3Send.mockResolvedValue(s3ObjectBody());
});
afterEach(() => vi.restoreAllMocks());

describe("bridgeSessionDocuments", () => {
  it("maps a validated doc to uploadDocument with doc_id/name/contentType/verdict from the s3Key", async () => {
    const session = sessionWith(
      [validatedDoc("photo-id-all-applicants", "front.jpg", "clear photo")],
      { bringIns: [catalogItem("photo-id-all-applicants")] },
    );

    await bridgeSessionDocuments(session, APPT);

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [, bucket, , input] = uploadDocument.mock.calls[0];
    expect(bucket).toBe("office-bucket");
    expect(input).toMatchObject({
      appointmentId: APPT,
      docId: "photo-id-all-applicants", // parsed from s3Key segment 3, NOT documentType
      name: "front.jpg",
      contentType: "image/jpeg",
      aiReviewStatus: "accept",
      aiReviewNotes: "clear photo",
    });
    expect(Buffer.isBuffer(input.fileBuffer)).toBe(true);
  });

  it("unions ALL resolvedBuckets itemIds into appointments.required_doc_ids regardless of upload status", async () => {
    const session = sessionWith(
      [validatedDoc("address-proof-1", "a.pdf"), pendingDoc("Human readable string")],
      {
        bringIns: [catalogItem("address-proof-1"), catalogItem("photo-id-all-applicants")],
        optionalUploads: [catalogItem("address-proof-2", "optional_upload")],
      },
    );

    await bridgeSessionDocuments(session, APPT);

    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    expect(String(updateCall![0])).toContain("required_doc_ids");
    expect(String(updateCall![0])).toContain("DISTINCT");
    // second bind param contains catalog itemIds from resolvedBuckets, NOT documentType strings
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toContain("address-proof-1");
    expect(docIds).toContain("photo-id-all-applicants");
    expect(docIds).toContain("address-proof-2");
    expect(docIds).toHaveLength(3);
  });

  it("updates required_doc_ids even when NO documents were uploaded", async () => {
    const session = sessionWith([pendingDoc("Human-readable doc name")], {
      bringIns: [catalogItem("photo-id-all-applicants"), catalogItem("address-proof-1")],
    });

    await bridgeSessionDocuments(session, APPT);

    // required_doc_ids should still be updated with catalog itemIds
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toContain("photo-id-all-applicants");
    expect(docIds).toContain("address-proof-1");

    // but no file uploads should occur
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("skips failed and pending docs for file bridge (only validated+s3Key are bridged)", async () => {
    const session = sessionWith(
      [
        { documentType: "x", txnTypeId: "t", status: "failed", validationResult: "{}" },
        { documentType: "y", txnTypeId: "t", status: "pending" },
        validatedDoc("dl-renewal-current", "dl.jpg"),
      ],
      { bringIns: [catalogItem("dl-renewal-current")] },
    );

    await bridgeSessionDocuments(session, APPT);

    expect(uploadDocument).toHaveBeenCalledTimes(1);
    expect(uploadDocument.mock.calls[0][3].docId).toBe("dl-renewal-current");
  });

  it("is idempotent: skips uploadDocument when a (appt, doc_id) row already exists", async () => {
    // idempotency SELECT returns a row → already bridged
    poolQuery.mockImplementation((sql: string) =>
      String(sql).includes("SELECT 1 FROM documents")
        ? Promise.resolve({ rows: [{ "?column?": 1 }], rowCount: 1 })
        : Promise.resolve({ rows: [], rowCount: 0 }),
    );
    const session = sessionWith([validatedDoc("photo-id-all-applicants", "front.jpg")], {
      bringIns: [catalogItem("photo-id-all-applicants")],
    });

    await bridgeSessionDocuments(session, APPT);

    expect(uploadDocument).not.toHaveBeenCalled();
    // required_doc_ids is still updated (separately from file bridge)
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall![1]).toEqual([APPT, ["photo-id-all-applicants"]]);
  });

  it("fail-open: one bad doc doesn't drop the others and the function never throws", async () => {
    // First uploadDocument throws, second succeeds.
    uploadDocument
      .mockRejectedValueOnce(new Error("S3 exploded"))
      .mockResolvedValueOnce({ documentId: 2, s3Key: "k" });
    const session = sessionWith(
      [validatedDoc("address-proof-1", "a.pdf"), validatedDoc("address-proof-2", "b.pdf")],
      { bringIns: [catalogItem("address-proof-1"), catalogItem("address-proof-2")] },
    );

    await expect(bridgeSessionDocuments(session, APPT)).resolves.toBeUndefined();
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    // required_doc_ids is updated with ALL catalog itemIds upfront (before file bridge)
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall![1]).toEqual([APPT, ["address-proof-1", "address-proof-2"]]);
  });

  it("empty resolvedBuckets → no UPDATE for required_doc_ids", async () => {
    const session = sessionWith([], { bringIns: [], optionalUploads: [], forms: [] });
    await bridgeSessionDocuments(session, APPT);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("no resolvedBuckets at all → no UPDATE for required_doc_ids, no crash", async () => {
    // Session without resolvedBuckets (e.g. older session or edge case)
    const session = sessionWith([]);
    await bridgeSessionDocuments(session, APPT);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("missing DOCUMENTS_BUCKET → still updates required_doc_ids, skips file bridge", async () => {
    delete process.env.DOCUMENTS_BUCKET;
    const session = sessionWith(
      [pendingDoc("human-readable"), validatedDoc("address-proof-1", "a.pdf")],
      { bringIns: [catalogItem("photo-id-all-applicants"), catalogItem("address-proof-1")] },
    );

    await expect(bridgeSessionDocuments(session, APPT)).resolves.toBeUndefined();

    // required_doc_ids is updated regardless of DOCUMENTS_BUCKET
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toContain("photo-id-all-applicants");
    expect(docIds).toContain("address-proof-1");

    // but no file uploads
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it("deduplicates itemId values across buckets before updating required_doc_ids", async () => {
    const session = sessionWith([], {
      bringIns: [catalogItem("photo-id-all-applicants")],
      // Same itemId in two buckets (shouldn't happen but defensive)
      optionalUploads: [catalogItem("photo-id-all-applicants", "optional_upload")],
      forms: [catalogItem("address-proof-1", "form")],
    });

    await bridgeSessionDocuments(session, APPT);

    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toHaveLength(2);
    expect(docIds).toContain("photo-id-all-applicants");
    expect(docIds).toContain("address-proof-1");
  });
});

// ─── dl-renewal decision-tree scenarios ──────────────────────────────────────
// These simulate the resolved buckets for a dl-renewal with real_id_status=not-compliant:
//   bring_in: fl-driver-license-to-renew, primary-id-passport, social-security-card
//   optional_upload: address-proof-1, address-proof-2
describe("bridgeSessionDocuments — dl-renewal scenarios", () => {
  const DL_RENEWAL_BRING_INS = [
    catalogItem("fl-driver-license-to-renew"),
    catalogItem("primary-id-passport"),
    catalogItem("social-security-card"),
  ];
  const DL_RENEWAL_OPTIONAL_UPLOADS = [
    catalogItem("address-proof-1", "optional_upload"),
    catalogItem("address-proof-2", "optional_upload"),
  ];
  const DL_RENEWAL_BUCKETS = {
    bringIns: DL_RENEWAL_BRING_INS,
    optionalUploads: DL_RENEWAL_OPTIONAL_UPLOADS,
    forms: [],
  };

  const ALL_DL_RENEWAL_DOC_IDS = [
    "fl-driver-license-to-renew",
    "primary-id-passport",
    "social-security-card",
    "address-proof-1",
    "address-proof-2",
  ];

  it("no docs uploaded: all 5 required_doc_ids are persisted, no files bridged", async () => {
    // User went through chatbot, identified docs, but skipped upload entirely.
    const session = sessionWith(
      [
        // Documents array has human-readable strings from identify-transaction
        { documentType: "Current FL driver license", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "US passport", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "Social Security card", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "Proof of address #1", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "Proof of address #2", txnTypeId: "dl-renewal", status: "skipped" },
      ],
      DL_RENEWAL_BUCKETS,
    );

    await bridgeSessionDocuments(session, APPT);

    // All 5 catalog itemIds should be in required_doc_ids
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toHaveLength(5);
    for (const id of ALL_DL_RENEWAL_DOC_IDS) {
      expect(docIds).toContain(id);
    }

    // No file uploads — nothing was uploaded in the chatbot
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(s3Send).not.toHaveBeenCalled();
  });

  it("1 of 2 optional docs uploaded: all 5 required_doc_ids persisted, 1 file bridged", async () => {
    // User uploaded address-proof-1 but not address-proof-2.
    const session = sessionWith(
      [
        { documentType: "Current FL driver license", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "US passport", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "Social Security card", txnTypeId: "dl-renewal", status: "skipped" },
        {
          documentType: "Proof of address #1",
          txnTypeId: "dl-renewal",
          status: "validated",
          s3Key: "uploads/stlucie/sess-123/address-proof-1/utility_bill.pdf",
          validationResult: JSON.stringify({ verdict: "accept", reason: "valid utility bill" }),
        },
        { documentType: "Proof of address #2", txnTypeId: "dl-renewal", status: "pending" },
      ],
      DL_RENEWAL_BUCKETS,
    );

    await bridgeSessionDocuments(session, APPT);

    // All 5 doc IDs still in required_doc_ids (not just the uploaded one)
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toHaveLength(5);
    for (const id of ALL_DL_RENEWAL_DOC_IDS) {
      expect(docIds).toContain(id);
    }

    // Only address-proof-1 was bridged (the uploaded one)
    expect(uploadDocument).toHaveBeenCalledTimes(1);
    const [, , , input] = uploadDocument.mock.calls[0];
    expect(input.docId).toBe("address-proof-1");
    expect(input.name).toBe("utility_bill.pdf");
    expect(input.contentType).toBe("application/pdf");
    expect(input.aiReviewStatus).toBe("accept");
    expect(input.aiReviewNotes).toBe("valid utility bill");
  });

  it("both optional docs uploaded: all 5 required_doc_ids persisted, 2 files bridged", async () => {
    // User uploaded both address-proof-1 and address-proof-2.
    const session = sessionWith(
      [
        { documentType: "Current FL driver license", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "US passport", txnTypeId: "dl-renewal", status: "skipped" },
        { documentType: "Social Security card", txnTypeId: "dl-renewal", status: "skipped" },
        {
          documentType: "Proof of address #1",
          txnTypeId: "dl-renewal",
          status: "validated",
          s3Key: "uploads/stlucie/sess-123/address-proof-1/utility_bill.pdf",
          validationResult: JSON.stringify({ verdict: "accept", reason: "valid utility bill" }),
        },
        {
          documentType: "Proof of address #2",
          txnTypeId: "dl-renewal",
          status: "validated",
          s3Key: "uploads/stlucie/sess-123/address-proof-2/bank_statement.jpg",
          validationResult: JSON.stringify({ verdict: "accept", reason: "recent bank statement" }),
        },
      ],
      DL_RENEWAL_BUCKETS,
    );

    await bridgeSessionDocuments(session, APPT);

    // All 5 doc IDs in required_doc_ids
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toHaveLength(5);
    for (const id of ALL_DL_RENEWAL_DOC_IDS) {
      expect(docIds).toContain(id);
    }

    // Both uploads bridged
    expect(uploadDocument).toHaveBeenCalledTimes(2);

    const bridgedDocIds = uploadDocument.mock.calls.map(([, , , input]) => input.docId);
    expect(bridgedDocIds).toContain("address-proof-1");
    expect(bridgedDocIds).toContain("address-proof-2");

    // Verify details of each bridged doc
    const proof1Call = uploadDocument.mock.calls.find(
      ([, , , input]) => input.docId === "address-proof-1",
    );
    expect(proof1Call![3]).toMatchObject({
      name: "utility_bill.pdf",
      contentType: "application/pdf",
      aiReviewStatus: "accept",
      aiReviewNotes: "valid utility bill",
    });

    const proof2Call = uploadDocument.mock.calls.find(
      ([, , , input]) => input.docId === "address-proof-2",
    );
    expect(proof2Call![3]).toMatchObject({
      name: "bank_statement.jpg",
      contentType: "image/jpeg",
      aiReviewStatus: "accept",
      aiReviewNotes: "recent bank statement",
    });
  });
});
