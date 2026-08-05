/**
 * Bridge chatbot-uploaded documents into the clerk-visible `documents` table.
 *
 * WHY THIS EXISTS
 * ---------------
 * A document uploaded in the chatbot lands in the chatbot's own S3 bucket
 * (`DOC_BUCKET`) at `uploads/{tenant}/{session}/{itemId}/{filename}`, keyed by
 * SESSION id. The clerk's Service Clerk view reads the office-ops `documents`
 * table, joined on `appointment_id`, and only presigns objects that live in the
 * office-ops bucket (`DOCUMENTS_BUCKET`). Nothing connected the two, so a
 * customer's pre-uploaded doc was invisible to the clerk.
 *
 * This bridge runs once, at the booking seam (right after `appointmentId`
 * exists), and copies each VALIDATED upload into the office-ops bucket + writes
 * the `documents` row via the canonical office-ops writer `uploadDocument()`.
 *
 * TWO NON-OBVIOUS CORRECTNESS FACTS (verified against the schema/read path):
 *  - W1: `getClerkServiceRecord` builds its doc list from
 *    `appointments.required_doc_ids` LEFT JOIN `documents`; it returns NO docs
 *    when `required_doc_ids` is empty. Chatbot booking leaves it empty, so a
 *    bare `documents` INSERT is invisible. We MUST also union the bridged
 *    `doc_id`s into `required_doc_ids`.
 *  - `doc_id` is recovered losslessly from the S3 key: the SPA uploads with
 *    `documentType = catalog itemId`, so path segment 3 IS the registry
 *    `doc_id` (FK'd to `document_registry`). We never rely on the freeform
 *    `documents[].documentType` string.
 *
 * FAIL-OPEN CONTRACT: this function must NEVER throw. A booking must succeed
 * even if the bridge fails entirely (bad S3 read, FK miss, DB hiccup). Each
 * document is bridged in its own try/catch so one bad file can't drop the rest,
 * and the whole body is guarded. Callers still `await` it (see the seam in
 * local-server-app.ts) because under serverless-express the Lambda invocation
 * ends when the HTTP response resolves — a fire-and-forget promise would be
 * frozen/dropped by the container before the copy completes.
 */

import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { Session } from "@st-lucie/shared-types";
import { getPool } from "@st-lucie/data-access";
import { uploadDocument } from "@st-lucie/office-ops/documents";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

/** Guess a Content-Type from the filename extension. The presigned PUT stores
 *  none deliberately; the office bucket object gets this only as a browser
 *  render hint — it never affects correlation. */
function contentTypeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "pdf":
      return "application/pdf";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "heic":
      return "image/heic";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

/** Pull the human-readable reason out of a stored validationResult JSON blob. */
function reasonFromValidation(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
}

async function streamToBuffer(body: unknown): Promise<Buffer> {
  // The AWS SDK v3 GetObject Body is a Node Readable in Lambda.
  const chunks: Buffer[] = [];
  const stream = body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/**
 * Copy every validated session upload into the office-ops documents store and
 * make it visible to the clerk. Never throws.
 */
export async function bridgeSessionDocuments(
  session: Session,
  appointmentId: number,
): Promise<void> {
  try {
    // Read bucket names per-call (not module consts) so the values are current
    // and the function is testable. SOURCE = where the presigned upload landed
    // (same env pair as generate-url.ts); OFFICE = office-ops copy target.
    const sourceBucket = process.env.DOC_BUCKET_NAME || process.env.DOC_BUCKET || "";
    const officeBucket = process.env.DOCUMENTS_BUCKET || "";
    if (!officeBucket) {
      console.error("[doc-bridge] DOCUMENTS_BUCKET not set — skipping bridge");
      return;
    }
    const docs = session.structuredContext.documents.filter(
      (d) => d.status === "validated" && d.s3Key,
    );
    if (docs.length === 0) return;

    const pool = getPool();
    const bridgedDocIds: string[] = [];

    for (const doc of docs) {
      try {
        const s3Key = doc.s3Key as string;
        // uploads/{tenant}/{session}/{docId}/{filename} — segment 3 is the
        // catalog itemId, which equals the registry doc_id.
        const segments = s3Key.split("/");
        const docId = segments[3];
        const filename = decodeURIComponent(segments[segments.length - 1] || "");
        if (!docId || !filename) {
          console.error(`[doc-bridge] unparseable s3Key, skipping: ${s3Key}`);
          continue;
        }

        // Idempotency guard: don't re-insert a row for a (appointment, doc)
        // that already exists (e.g. a retried booking against the same
        // appointment). Advisory — no UNIQUE constraint — but the single-
        // booking flow is one invocation, so this is sufficient in practice.
        const existing = await pool.query(
          `SELECT 1 FROM documents WHERE appointment_id = $1 AND doc_id = $2 LIMIT 1`,
          [appointmentId, docId],
        );
        if ((existing.rowCount ?? 0) > 0) {
          bridgedDocIds.push(docId); // still ensure it's in required_doc_ids
          continue;
        }

        const obj = await s3.send(new GetObjectCommand({ Bucket: sourceBucket, Key: s3Key }));
        if (!obj.Body) {
          console.error(`[doc-bridge] empty S3 body, skipping: ${s3Key}`);
          continue;
        }
        const fileBuffer = await streamToBuffer(obj.Body);

        await uploadDocument(s3, officeBucket, pool, {
          appointmentId,
          docId,
          name: filename,
          fileBuffer,
          contentType: contentTypeFromName(filename),
          // Only validated docs reach here (rejects have no s3Key), so the
          // clerk-facing verdict is always an accept; carry the reason across.
          aiReviewStatus: "accept",
          aiReviewNotes: reasonFromValidation(doc.validationResult),
        });
        bridgedDocIds.push(docId);
      } catch (docErr) {
        // One bad file must not drop the others or the booking.
        console.error(
          `[doc-bridge] failed to bridge doc ${doc.s3Key} for appt ${appointmentId}:`,
          docErr,
        );
      }
    }

    if (bridgedDocIds.length > 0) {
      // W1: the clerk read is gated by required_doc_ids. Union the bridged
      // doc_ids in (idempotent set-union) so the LEFT JOIN surfaces them.
      await pool.query(
        `UPDATE appointments
         SET required_doc_ids = ARRAY(
           SELECT DISTINCT unnest(required_doc_ids || $2::text[])
         )
         WHERE id = $1`,
        [appointmentId, bridgedDocIds],
      );
    }
  } catch (err) {
    // Function-level guarantee: never throw into the booking path.
    console.error(`[doc-bridge] bridge failed for appt ${appointmentId}:`, err);
  }
}
