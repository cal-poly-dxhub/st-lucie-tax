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

// Minimal Session with just the doc fields the bridge reads.
function sessionWith(docs: unknown[]): Session {
  return {
    structuredContext: { documents: docs },
  } as unknown as Session;
}

function validatedDoc(itemId: string, filename: string, reason = "looks good") {
  return {
    documentType: itemId,
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
    const session = sessionWith([
      validatedDoc("photo-id-all-applicants", "front.jpg", "clear photo"),
    ]);

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

  it("unions ALL session doc_ids into appointments.required_doc_ids regardless of upload status", async () => {
    const session = sessionWith([
      validatedDoc("address-proof-1", "a.pdf"),
      pendingDoc("photo-id-all-applicants"),
      pendingDoc("address-proof-2"),
    ]);

    await bridgeSessionDocuments(session, APPT);

    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall).toBeTruthy();
    expect(String(updateCall![0])).toContain("required_doc_ids");
    expect(String(updateCall![0])).toContain("DISTINCT");
    // second bind param contains ALL doc types, not just the uploaded ones
    const docIds = updateCall![1][1] as string[];
    expect(docIds).toContain("address-proof-1");
    expect(docIds).toContain("photo-id-all-applicants");
    expect(docIds).toContain("address-proof-2");
    expect(docIds).toHaveLength(3);
  });

  it("updates required_doc_ids even when NO documents were uploaded", async () => {
    const session = sessionWith([
      pendingDoc("photo-id-all-applicants"),
      pendingDoc("address-proof-1"),
    ]);

    await bridgeSessionDocuments(session, APPT);

    // required_doc_ids should still be updated
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
    const session = sessionWith([
      { documentType: "x", txnTypeId: "t", status: "failed", validationResult: "{}" },
      { documentType: "y", txnTypeId: "t", status: "pending" },
      validatedDoc("dl-renewal-current", "dl.jpg"),
    ]);

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
    const session = sessionWith([validatedDoc("photo-id-all-applicants", "front.jpg")]);

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
    const session = sessionWith([
      validatedDoc("address-proof-1", "a.pdf"),
      validatedDoc("address-proof-2", "b.pdf"),
    ]);

    await expect(bridgeSessionDocuments(session, APPT)).resolves.toBeUndefined();
    expect(uploadDocument).toHaveBeenCalledTimes(2);
    // required_doc_ids is updated with ALL doc types upfront (before file bridge)
    const updateCall = poolQuery.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE appointments"),
    );
    expect(updateCall![1]).toEqual([APPT, ["address-proof-1", "address-proof-2"]]);
  });

  it("empty documents array → no UPDATE, no uploadDocument", async () => {
    await bridgeSessionDocuments(sessionWith([]), APPT);
    expect(uploadDocument).not.toHaveBeenCalled();
    expect(poolQuery).not.toHaveBeenCalled();
  });

  it("missing DOCUMENTS_BUCKET → still updates required_doc_ids, skips file bridge", async () => {
    delete process.env.DOCUMENTS_BUCKET;
    const session = sessionWith([
      pendingDoc("photo-id-all-applicants"),
      validatedDoc("address-proof-1", "a.pdf"),
    ]);

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

  it("deduplicates documentType values before updating required_doc_ids", async () => {
    const session = sessionWith([
      pendingDoc("photo-id-all-applicants"),
      // same documentType, different txnTypeId — should deduplicate
      { documentType: "photo-id-all-applicants", txnTypeId: "vehicle-reg", status: "pending" },
      pendingDoc("address-proof-1"),
    ]);

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
