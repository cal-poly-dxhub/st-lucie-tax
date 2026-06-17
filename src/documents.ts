import { PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
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
  s3: S3Client,
  bucket: string,
  db: Queryable,
  input: UploadDocInput,
): Promise<UploadDocResult> {
  const s3Key = await uploadToS3(
    s3,
    bucket,
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

async function uploadToS3(
  s3: S3Client,
  bucket: string,
  appointmentId: number,
  fileName: string,
  buffer: Buffer,
  contentType: string,
): Promise<string> {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `appointments/${appointmentId}/${Date.now()}_${sanitized}`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return key;
}

export interface DocStatus {
  docId: string;
  name: string;
  uploaded: boolean;
  s3Key: string | null;
  aiReviewStatus: "accept" | "reject" | null;
  aiReviewNotes: string | null;
  clerkValidated: boolean;
}

export async function getRequiredDocsStatus(
  db: Queryable,
  appointmentId: number,
): Promise<DocStatus[]> {
  const { rows } = await db.query(
    `SELECT dr.doc_id, dr.name,
            (d.id IS NOT NULL) AS uploaded,
            d.s3_key,
            d.ai_review_status,
            d.ai_review_notes,
            COALESCE(d.clerk_validated, FALSE) AS clerk_validated
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

export async function validateDocument(db: Queryable, documentId: number): Promise<void> {
  const { rowCount } = await db.query(`UPDATE documents SET clerk_validated = TRUE WHERE id = $1`, [
    documentId,
  ]);
  if (rowCount === 0) {
    throw new Error(`Document ${documentId} not found`);
  }
}
