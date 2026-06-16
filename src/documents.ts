import type { Pool, PoolClient } from "pg";
import { camelRows } from "./utils.js";

export interface UploadDocInput {
  countyId: string;
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
  db: Pool | PoolClient,
  input: UploadDocInput,
): Promise<UploadDocResult> {
  const s3Key = await uploadToS3(
    input.countyId,
    input.appointmentId,
    input.name,
    input.fileBuffer,
    input.contentType,
  );

  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO documents (county_id, appointment_id, doc_id, name, s3_key, ai_review_status, ai_review_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      input.countyId,
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
  countyId: string,
  appointmentId: number,
  fileName: string,
  _buffer: Buffer,
  _contentType: string,
): Promise<string> {
  const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${countyId}/appointments/${appointmentId}/${Date.now()}_${sanitized}`;
}

export interface DocStatus {
  docId: string;
  name: string;
  uploaded: boolean;
  aiReviewStatus: "accept" | "reject" | null;
}

export async function getRequiredDocsStatus(
  db: Pool | PoolClient,
  countyId: string,
  appointmentId: number,
): Promise<DocStatus[]> {
  const { rows } = await db.query(
    `SELECT dr.doc_id, dr.name,
            (d.id IS NOT NULL) AS uploaded,
            d.ai_review_status
     FROM appointments a
     CROSS JOIN LATERAL unnest(a.required_doc_ids) AS req(doc_id)
     JOIN document_registry dr
       ON dr.county_id = a.county_id AND dr.doc_id = req.doc_id
     LEFT JOIN documents d
       ON d.county_id = a.county_id
      AND d.appointment_id = a.id
      AND d.doc_id = req.doc_id
     WHERE a.county_id = $1 AND a.id = $2
     ORDER BY dr.doc_id`,
    [countyId, appointmentId],
  );
  return camelRows<DocStatus>(rows);
}
