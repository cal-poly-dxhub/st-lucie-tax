import { SESv2Client } from "@aws-sdk/client-sesv2";
import { S3Client } from "@aws-sdk/client-s3";

// Centralized runtime configuration + shared AWS clients.
// Reading env in one place keeps the routers free of process.env access and
// makes the Lambda packaging (env-driven) consistent with local dev.

export const REGION = process.env.AWS_REGION ?? "us-west-2";
export const EMAIL = process.env.EMAIL ?? "noreply@localhost";
export const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
// FRONTEND_URL is used for links to client-side routes (prescreen, queue-status).
// In production CloudFront serves the SPA from the same origin as the API, so
// BASE_URL works. Locally the Vite dev server is on a different port.
export const FRONTEND_URL =
  process.env.FRONTEND_URL ?? process.env.BASE_URL ?? "http://localhost:5173";
export const DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET ?? "";

// Default to today's date. Override with DEMO_DATE env var if needed.
export const DEFAULT_DATE = process.env.DEMO_DATE ?? new Date().toISOString().slice(0, 10);

// SERVICE selects which router(s) this process mounts. The same code is
// deployed as two Lambdas: SERVICE=appointment and SERVICE=queue. Unset (local
// dev) mounts both so a single `tsx server/index.ts` serves everything.
export type ServiceMode = "appointment" | "queue" | "all";
export const SERVICE: ServiceMode = (process.env.SERVICE as ServiceMode) ?? "all";

export const ses = new SESv2Client({ region: REGION });
export const s3 = new S3Client({ region: REGION });
