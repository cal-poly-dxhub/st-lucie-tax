/**
 * Ingest the FLHSMV Driver License Operations Manual into our Bedrock KB.
 *
 * Source: s3://<vendor-source-bucket>/HLSMV/*.json — vendor-delivered chunks JSON (one
 * per PDF) with pre-extracted text in { chunks: [{ index, content }] } shape.
 *
 * We skip the `*.pdf` (no retrieval value beyond the chunks) and skip the
 * `*.lookup.json` (GPT-generated metadata; we regenerate with Claude in a
 * separate step — see scripts/build-ops-manual-index.ts).
 *
 * Also skips the language-line reference sheets ("Language Line Solutions",
 * "State and TC Language Line Codes") which are telephone-translation
 * references, not customer-facing DL content.
 *
 * Destination: s3://{KB_DATA_BUCKET}/flhsmv-ops-manual/{CODE}.txt
 *   one concatenated text blob per doc, ready for Bedrock KB chunking.
 *
 * Usage:
 *   AWS_PROFILE=AdministratorAccess-<ACCOUNT_ID> AWS_REGION=us-east-1 \
 *     npx tsx scripts/ingest-flhsmv-ops-manual.ts
 *
 * Then kick ingestion:
 *   aws bedrock-agent start-ingestion-job \
 *     --knowledge-base-id DREJTMKWRM --data-source-id UHCEFZRCSW
 */

import 'dotenv/config';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const VENDOR_BUCKET = '<vendor-source-bucket>';
const VENDOR_PREFIX = 'HLSMV/';
const KB_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const KB_PREFIX = 'flhsmv-ops-manual/';

// Skip these entirely — telephone translation references, not DL content.
const SKIP_CODES = new Set([
  'Language Line Solutions - Point to Your Language',
  'State and TC Language Line Codes - Master',
]);

// Vendor bucket is in us-west-2; our KB bucket is in us-east-1.
const vendorS3 = new S3Client({ region: 'us-west-2' });
const kbS3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

interface Chunk {
  index: number;
  content: string;
}

interface VendorDoc {
  id: string;
  sourcePath: string;
  relPath: string;
  sha256: string;
  chunks: Chunk[];
}

async function listVendorChunksFiles(): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await vendorS3.send(
      new ListObjectsV2Command({
        Bucket: VENDOR_BUCKET,
        Prefix: VENDOR_PREFIX,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      // Accept *.json but not *.lookup.json and not the PDFs.
      if (!obj.Key.endsWith('.json')) continue;
      if (obj.Key.endsWith('.lookup.json')) continue;
      keys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function extractCode(key: string): string {
  // HLSMV/IR09.json -> IR09
  // HLSMV/AcceptableDocuments.json -> AcceptableDocuments
  const m = key.match(/HLSMV\/(.+)\.json$/);
  if (!m) return key;
  return m[1];
}

async function readVendorDoc(key: string): Promise<VendorDoc> {
  const resp = await vendorS3.send(new GetObjectCommand({ Bucket: VENDOR_BUCKET, Key: key }));
  const body = await resp.Body?.transformToString();
  if (!body) throw new Error(`empty body: ${key}`);
  return JSON.parse(body) as VendorDoc;
}

async function alreadyIngested(code: string, sha256: string): Promise<boolean> {
  try {
    const resp = await kbS3.send(
      new GetObjectCommand({
        Bucket: KB_BUCKET,
        Key: `${KB_PREFIX}${code}.txt`,
      }),
    );
    const stored = resp.Metadata?.['vendor-sha256'];
    return stored === sha256;
  } catch {
    return false;
  }
}

function buildTextBlob(doc: VendorDoc): string {
  const header = `# ${extractCode(doc.relPath)}\n\nSource: ${doc.relPath}\nSHA256: ${doc.sha256}\n\n---\n\n`;
  const body = (doc.chunks ?? [])
    .sort((a, b) => a.index - b.index)
    .map(c => c.content)
    .join('\n\n');
  return header + body;
}

async function uploadBlob(code: string, text: string, sha256: string): Promise<void> {
  await kbS3.send(
    new PutObjectCommand({
      Bucket: KB_BUCKET,
      Key: `${KB_PREFIX}${code}.txt`,
      Body: text,
      ContentType: 'text/plain; charset=utf-8',
      Metadata: { 'vendor-sha256': sha256 },
    }),
  );
}

async function main(): Promise<void> {
  console.log(`Listing vendor chunks in s3://${VENDOR_BUCKET}/${VENDOR_PREFIX}...`);
  const keys = await listVendorChunksFiles();
  console.log(`  found ${keys.length} JSON files`);

  let skippedSkipList = 0;
  let skippedUnchanged = 0;
  let uploaded = 0;
  let errored = 0;

  for (const key of keys) {
    const code = extractCode(key);
    if (SKIP_CODES.has(code)) {
      skippedSkipList += 1;
      continue;
    }
    try {
      const doc = await readVendorDoc(key);
      if (!doc.chunks || doc.chunks.length === 0) {
        console.warn(`  [skip] ${code} — no chunks`);
        continue;
      }
      if (await alreadyIngested(code, doc.sha256)) {
        skippedUnchanged += 1;
        continue;
      }
      const text = buildTextBlob(doc);
      await uploadBlob(code, text, doc.sha256);
      console.log(`  [ok]   ${code} (${doc.chunks.length} chunks, ${text.length} chars)`);
      uploaded += 1;
    } catch (err) {
      console.error(`  [err]  ${code}: ${(err as Error).message}`);
      errored += 1;
    }
  }

  console.log('\n=== Done ===');
  console.log(`Uploaded: ${uploaded}`);
  console.log(`Unchanged (skipped): ${skippedUnchanged}`);
  console.log(`Skipped (skip-list): ${skippedSkipList}`);
  console.log(`Errored: ${errored}`);
  console.log(`\nDestination: s3://${KB_BUCKET}/${KB_PREFIX}`);
  console.log('\nNext — kick Bedrock KB ingestion:');
  console.log('  aws bedrock-agent start-ingestion-job \\');
  console.log('    --knowledge-base-id DREJTMKWRM \\');
  console.log('    --data-source-id   UHCEFZRCSW');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
