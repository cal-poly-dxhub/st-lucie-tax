/**
 * Presigned URL generation for document uploads.
 * Uses presigned S3 URLs to avoid API Gateway 10MB limit.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const s3Client = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
const BUCKET_NAME = process.env.DOC_BUCKET_NAME || "";
const URL_EXPIRY_SECONDS = 300; // 5 minutes

export interface UploadUrlResult {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export async function generateUploadUrl(
  tenantId: string,
  sessionId: string,
  documentType: string,
  filename: string,
): Promise<UploadUrlResult> {
  if (!BUCKET_NAME) {
    throw new Error("DOC_BUCKET_NAME environment variable is required");
  }

  // S3 key structure: uploads/{tenantId}/{sessionId}/{documentType}/{filename}
  const s3Key = `uploads/${tenantId}/${sessionId}/${documentType}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    ContentType: getContentType(filename),
    Metadata: {
      "session-id": sessionId,
      "tenant-id": tenantId,
      "document-type": documentType,
    },
  });

  const uploadUrl = await getSignedUrl(s3Client, command, {
    expiresIn: URL_EXPIRY_SECONDS,
  });

  return {
    uploadUrl,
    s3Key,
    expiresIn: URL_EXPIRY_SECONDS,
  };
}

function getContentType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop();
  const types: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    pdf: "application/pdf",
    heic: "image/heic",
    heif: "image/heif",
  };
  return types[ext || ""] || "application/octet-stream";
}
