/**
 * Dev harness for the document pass/reject screen (upload/validate-document.ts).
 *
 * Uploads a LOCAL file (JPEG/PNG/GIF/WEBP, PDF, or HEIC) to the doc bucket under
 * a throwaway prefix, then runs the exact production validator against it and
 * prints the verdict + any observed dates — so you can confirm the AI accepts a
 * real document, rejects obvious junk, screens PDFs/HEIC, and reads printed
 * dates, all WITHOUT deploying.
 *
 * Usage:
 *   export AWS_PROFILE=AdministratorAccess-111122223333
 *   export DOC_BUCKET_NAME=$(aws ssm get-parameter --name /stlucie/doc-bucket-name \
 *     --query Parameter.Value --output text --profile AdministratorAccess-111122223333)
 *   npx tsx scripts/try-doc-validation.ts ./real-license.jpg  fl-insurance-proof
 *   npx tsx scripts/try-doc-validation.ts ./registration.pdf  oos-registration
 *   npx tsx scripts/try-doc-validation.ts ./iphone-photo.heic address-proof-1
 *   npx tsx scripts/try-doc-validation.ts ./selfie.jpg        fl-insurance-proof
 *
 * Notes:
 *   - documentType is a catalog itemId (defaults to fl-insurance-proof). It only
 *     shapes the "expected document" prompt; any itemId works for a smoke test.
 *   - Keep the file UNDER ~3.75 MB — larger files fail-open ('too-large') and
 *     skip the model entirely (you'll see that in the printed reason).
 *   - PDFs are screened as Bedrock DocumentBlocks; HEIC is transcoded to JPEG
 *     first. Only unreadable bytes pass through un-screened.
 *   - observedDates/datesLegible are Phase 1 OBSERVATION only — reported here so
 *     you can eyeball extraction accuracy; no expiry decision acts on them yet.
 *   - Uploaded objects are left in the bucket (bucket TTL clears them).
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const TENANT = process.env.TENANT_ID || "stlucie";
const REGION = process.env.AWS_REGION || "us-east-1";

async function main(): Promise<void> {
  const imagePath = process.argv[2];
  const documentType = process.argv[3] || "fl-insurance-proof";
  if (!imagePath) {
    console.error("Usage: npx tsx scripts/try-doc-validation.ts <imagePath> [documentType]");
    process.exit(2);
  }
  const bucket = process.env.DOC_BUCKET_NAME;
  if (!bucket) {
    console.error(
      "Set DOC_BUCKET_NAME first, e.g.\n" +
        "  export DOC_BUCKET_NAME=$(aws ssm get-parameter --name /stlucie/doc-bucket-name " +
        "--query Parameter.Value --output text --profile AdministratorAccess-111122223333)",
    );
    process.exit(2);
  }

  const bytes = readFileSync(imagePath);
  const name = basename(imagePath);
  const sessionId = `try-${process.pid}-${process.hrtime.bigint()}`;
  const s3Key = `uploads/${TENANT}/${sessionId}/${documentType}/${name}`;
  const sizeMb = (bytes.length / 1024 / 1024).toFixed(2);

  const ext = name.toLowerCase().split(".").pop() ?? "";
  const contentType =
    ext === "png"
      ? "image/png"
      : ext === "pdf"
        ? "application/pdf"
        : ext === "heic" || ext === "heif"
          ? "image/heic"
          : ext === "webp"
            ? "image/webp"
            : ext === "gif"
              ? "image/gif"
              : "image/jpeg";

  console.log(`\nUploading ${name} (${sizeMb} MB, ${contentType}) → s3://${bucket}/${s3Key}`);
  const s3 = new S3Client({ region: REGION });
  await s3.send(
    new PutObjectCommand({ Bucket: bucket, Key: s3Key, Body: bytes, ContentType: contentType }),
  );

  // Import the validator AFTER DOC_BUCKET_NAME is set (it reads the env at load).
  const { validateDocument } = await import("../services/chatbot/src/upload/validate-document.js");

  console.log(`Screening as expected document type: ${documentType} ...`);
  const verdict = await validateDocument({
    tenantId: TENANT,
    sessionId,
    documentType,
    s3Key,
    filename: name,
  });

  console.log("\n--- VERDICT ---");
  console.log(JSON.stringify(verdict, null, 2));

  if (verdict.observedDates || verdict.datesLegible !== undefined) {
    console.log("\n--- OBSERVED DATES (Phase 1: reported only, no decision yet) ---");
    console.log(`  datesLegible: ${verdict.datesLegible}`);
    console.log(`  observedDates: ${JSON.stringify(verdict.observedDates ?? {})}`);
  }

  if (verdict.verdict === "reject") {
    console.log("\n=> HARD REJECT (would block this upload; resident re-picks).");
  } else if (verdict.failOpen) {
    console.log(
      `\n=> ACCEPT (fail-open: "${verdict.reason}"). The model did NOT screen this — ` +
        `size/format/transcode/error path. A JPEG/PNG/PDF/HEIC under 3.75 MB should reach the model.`,
    );
  } else {
    console.log("\n=> ACCEPT (model looked and approved).");
  }
}

main().catch((err) => {
  console.error("\nHarness error:", err);
  process.exit(1);
});
