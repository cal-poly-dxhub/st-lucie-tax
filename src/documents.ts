import { type Queryable } from "./utils.js";
import { camelRows } from "./utils.js";

export interface UploadDocInput {
  appointmentId: number;
  docId: string | null;
  name: string;
  fileBuffer: Buffer;
  contentType: string;
  aiReviewStatus?: "accept" | "reject" | null;
  aiReviewNotes?: string | null;
}

export interface UploadDocResult {
  documentId: number;
  s3Key: string;
}

export async function uploadDocument(
  db: Queryable,
  input: UploadDocInput,
): Promise<UploadDocResult> {
  const s3Key = await uploadToS3(
    input.appointmentId,
    input.name,
    input.fileBuffer,
    input.contentType,
  );

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO documents (appointment_id, doc_id, name, s3_key, ai_review_status, ai_review_notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.appointmentId,
      input.docId,
      input.name,
      s3Key,
      input.aiReviewStatus ?? null,
      input.aiReviewNotes ?? null,
    ],
  );

  return { documentId: rows[0].id, s3Key };
}

// Stub — replace with real S3 PutObject call
async function uploadToS3(
  appointmentId: number,
  fileName: string,
  _buffer: Buffer,
  _contentType: string,
): Promise<string> {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `appointments/${appointmentId}/${Date.now()}_${sanitized}`;
}

export interface DocStatus {
  docId: string;
  name: string;
  uploaded: boolean;
  aiReviewStatus: "accept" | "reject" | null;
}

export async function getRequiredDocsStatus(
  db: Queryable,
  appointmentId: number,
): Promise<DocStatus[]> {
  const { rows } = await db.query(
    `SELECT dr.doc_id, dr.name,
            (d.id IS NOT NULL) AS uploaded,
            d.ai_review_status
     FROM appointments a
     CROSS JOIN LATERAL unnest(a.required_doc_ids) AS req(doc_id)
     JOIN document_registry dr
       ON dr.doc_id = req.doc_id
     LEFT JOIN documents d
       ON d.appointment_id = a.id
      AND d.doc_id = req.doc_id
     WHERE a.id = $1
     ORDER BY dr.doc_id`,
    [appointmentId],
  );
  return camelRows<DocStatus>(rows);
}
