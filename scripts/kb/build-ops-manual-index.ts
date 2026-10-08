/**
 * Regenerate metadata for every FLHSMV Operations Manual doc via Claude.
 *
 * Why not consume the vendor's `*.lookup.json`: GPT wrote it from an internal
 * staff perspective (ORION UI mechanics, correspondence codes, batching). Our
 * customer-facing bot needs metadata keyed to OUR transaction/fact taxonomy.
 *
 * Output: services/chatbot/src/data/flhsmv-ops-manual-index.json
 *
 * Usage:
 *   AWS_PROFILE=AdministratorAccess-<ACCOUNT_ID> AWS_REGION=us-east-1 \
 *     npx tsx scripts/build-ops-manual-index.ts
 *
 * Idempotent — only re-generates entries whose vendor SHA has changed since
 * the last index write.
 */

import 'dotenv/config';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { S3Client, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';

const VENDOR_BUCKET = '<vendor-source-bucket>';
const VENDOR_PREFIX = 'HLSMV/';
const INDEX_PATH = resolve('services/chatbot/src/data/flhsmv-ops-manual-index.json');
const MODEL_ID = 'us.anthropic.claude-sonnet-4-20250514-v1:0';

const SKIP_CODES = new Set([
  'Language Line Solutions - Point to Your Language',
  'State and TC Language Line Codes - Master',
]);

const vendorS3 = new S3Client({ region: 'us-west-2' });
const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TXN_IDS = JSON.parse(
  readFileSync(resolve('src/data/transaction-types.json'), 'utf-8'),
).map((t: { txnTypeId: string }) => t.txnTypeId) as string[];

const FACT_KEYS = JSON.parse(
  readFileSync(resolve('services/chatbot/src/data/fact-definitions.json'), 'utf-8'),
).map((d: { factKey: string }) => d.factKey) as string[];

const DOC_TYPES = [
  'cashiering',
  'customer-inquiry',
  'cross-functional',
  'eligible-operation',
  'home-page',
  'issuance-requirement',
  'misc-policy',
  'reference',
  'reports',
] as const;

interface VendorDoc {
  id: string;
  relPath: string;
  sha256: string;
  chunks: Array<{ index: number; content: string }>;
}

interface ManualEntry {
  code: string;
  title: string;
  summary: string;
  docType: typeof DOC_TYPES[number];
  relatedTxnTypeIds: string[];
  relatedFactKeys: string[];
  keyFacts: Array<{ claim: string; chunkIndex: number }>;
  feeAmounts: Array<{ label: string; amount: string; statuteRef?: string }>;
  sourceUrl: string;
  vendorSha256: string;
}

interface ManualIndex {
  generatedAt: string;
  entries: ManualEntry[];
}

async function listVendorChunks(): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const resp = await vendorS3.send(
      new ListObjectsV2Command({
        Bucket: VENDOR_BUCKET,
        Prefix: VENDOR_PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      if (!obj.Key.endsWith('.json')) continue;
      if (obj.Key.endsWith('.lookup.json')) continue;
      keys.push(obj.Key);
    }
    token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

async function readVendorDoc(key: string): Promise<VendorDoc> {
  const resp = await vendorS3.send(new GetObjectCommand({ Bucket: VENDOR_BUCKET, Key: key }));
  const body = await resp.Body?.transformToString();
  if (!body) throw new Error(`empty body: ${key}`);
  return JSON.parse(body) as VendorDoc;
}

async function readVendorLookup(key: string): Promise<{ sourceWebUrl?: string }> {
  // The vendor also provides a lookup.json per doc. We use ONE field from it:
  // sourceWebUrl. Everything else is regenerated.
  const lookupKey = key.replace(/\.json$/, '.lookup.json');
  try {
    const resp = await vendorS3.send(new GetObjectCommand({ Bucket: VENDOR_BUCKET, Key: lookupKey }));
    const body = await resp.Body?.transformToString();
    if (!body) return {};
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function extractCode(key: string): string {
  const m = key.match(/HLSMV\/(.+)\.json$/);
  return m ? m[1] : key;
}

function buildPrompt(code: string, fullText: string, chunkCount: number): string {
  const fullTextTrimmed = fullText.length > 60000 ? fullText.slice(0, 60000) + '\n\n[...truncated for prompt length]' : fullText;
  return `You are extracting metadata for the FLHSMV Driver License Operations Manual section **${code}** so our customer-facing chatbot can decide when to cite it.

The manual has ${chunkCount} chunks (indexed 0..${chunkCount - 1}). A customer-facing bot helps ST LUCIE COUNTY TAX COLLECTOR customers plan their visit. DO NOT write metadata from a staff/ORION perspective — the customer never interacts with ORION, cashier queues, or correspondence codes. Write for customer-facing retrieval.

OUR TRANSACTION TYPE IDs (pick from this exact list for relatedTxnTypeIds):
${TXN_IDS.join(', ')}

OUR FACT KEYS (pick from this exact list for relatedFactKeys — leave empty if none apply):
${FACT_KEYS.join(', ')}

DOC TYPES (pick exactly one):
${DOC_TYPES.join(', ')}

DOCUMENT CONTENT:
${fullTextTrimmed}

Return STRICT JSON — no markdown, no code fence, no prose before or after. Schema:
{
  "title": string — short cite-friendly title, no '.pdf' extension, no 'Driver License Operations Manual' prefix. e.g. "Identity & Legal Presence (IR09)"
  "summary": string — ≤ 280 chars, customer-adjacent. Describe WHAT this doc rules (rights, eligibility, fees, required documents) NOT how staff enter it in ORION.
  "docType": one of the DOC TYPES above
  "relatedTxnTypeIds": string[] — which of our transactions does this directly inform? empty list if none
  "relatedFactKeys": string[] — which of our fact keys does this refine or substantiate? empty list if none
  "keyFacts": Array of 3-6 atomic claims from the text our bot could cite in branch notes. Each: { "claim": "<one-sentence claim, customer-adjacent>", "chunkIndex": <0..${chunkCount - 1}> }
  "feeAmounts": Array of concrete fee-dollar-amount entries ONLY if this doc contains a fee table. Each: { "label": "<what the fee is for>", "amount": "<dollar amount like '$48.00' or '$6.25'>", "statuteRef": "<F.S. section if mentioned>" }. Empty array if no fees.
}

Constraints:
- "relatedTxnTypeIds" must only contain IDs from the transaction list above.
- "relatedFactKeys" must only contain keys from the fact-keys list above.
- "docType" must be one of the listed values exactly.
- Prefer 3-5 keyFacts over 1-2; each should be independently citable.
- No commentary. No explanation. Just the JSON object.`;
}

async function classifyDoc(code: string, doc: VendorDoc): Promise<Omit<ManualEntry, 'code' | 'sourceUrl' | 'vendorSha256'>> {
  const fullText = (doc.chunks ?? [])
    .sort((a, b) => a.index - b.index)
    .map(c => c.content)
    .join('\n\n');
  const prompt = buildPrompt(code, fullText, doc.chunks.length);

  const resp = await bedrock.send(
    new ConverseCommand({
      modelId: MODEL_ID,
      messages: [{ role: 'user', content: [{ text: prompt }] }],
      inferenceConfig: { maxTokens: 1500, temperature: 0.1 },
    }),
  );

  const textBlocks = resp.output?.message?.content?.filter((b: { text?: string }) => b.text).map((b: { text?: string }) => b.text!) ?? [];
  const raw = textBlocks.join('\n').trim();

  // Extract JSON even if the model fenced it.
  const jsonStart = raw.indexOf('{');
  const jsonEnd = raw.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) {
    throw new Error(`no JSON in response for ${code}: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));

  // Validate enums.
  if (!DOC_TYPES.includes(parsed.docType)) {
    throw new Error(`${code}: bad docType "${parsed.docType}"`);
  }
  const badTxn = (parsed.relatedTxnTypeIds ?? []).filter((id: string) => !TXN_IDS.includes(id));
  if (badTxn.length) {
    console.warn(`  [warn] ${code}: unknown txnTypeIds pruned: ${badTxn.join(',')}`);
    parsed.relatedTxnTypeIds = parsed.relatedTxnTypeIds.filter((id: string) => TXN_IDS.includes(id));
  }
  const badFact = (parsed.relatedFactKeys ?? []).filter((k: string) => !FACT_KEYS.includes(k));
  if (badFact.length) {
    console.warn(`  [warn] ${code}: unknown factKeys pruned: ${badFact.join(',')}`);
    parsed.relatedFactKeys = parsed.relatedFactKeys.filter((k: string) => FACT_KEYS.includes(k));
  }

  return {
    title: String(parsed.title ?? code),
    summary: String(parsed.summary ?? ''),
    docType: parsed.docType,
    relatedTxnTypeIds: parsed.relatedTxnTypeIds ?? [],
    relatedFactKeys: parsed.relatedFactKeys ?? [],
    keyFacts: parsed.keyFacts ?? [],
    feeAmounts: parsed.feeAmounts ?? [],
  };
}

function loadExistingIndex(): ManualIndex {
  if (!existsSync(INDEX_PATH)) {
    return { generatedAt: '', entries: [] };
  }
  try {
    return JSON.parse(readFileSync(INDEX_PATH, 'utf-8'));
  } catch {
    return { generatedAt: '', entries: [] };
  }
}

async function main(): Promise<void> {
  const keys = await listVendorChunks();
  console.log(`Found ${keys.length} vendor chunks JSON files.`);

  const existing = loadExistingIndex();
  const existingByCode = new Map(existing.entries.map(e => [e.code, e] as const));

  const results: ManualEntry[] = [];
  let regenerated = 0;
  let reused = 0;
  let errors = 0;

  for (const key of keys) {
    const code = extractCode(key);
    if (SKIP_CODES.has(code)) continue;

    try {
      const doc = await readVendorDoc(key);
      if (!doc.chunks?.length) continue;

      const prior = existingByCode.get(code);
      if (prior && prior.vendorSha256 === doc.sha256) {
        results.push(prior);
        reused += 1;
        continue;
      }

      const lookup = await readVendorLookup(key);
      console.log(`  classifying ${code} (${doc.chunks.length} chunks)...`);
      const meta = await classifyDoc(code, doc);
      const entry: ManualEntry = {
        code,
        ...meta,
        sourceUrl: lookup.sourceWebUrl ?? '',
        vendorSha256: doc.sha256,
      };
      results.push(entry);
      regenerated += 1;
    } catch (err) {
      console.error(`  [err] ${code}: ${(err as Error).message}`);
      errors += 1;
      // Keep the prior entry if we have one, so we don't regress on a transient failure.
      const prior = existingByCode.get(code);
      if (prior) results.push(prior);
    }
  }

  results.sort((a, b) => a.code.localeCompare(b.code));

  const out: ManualIndex = {
    generatedAt: new Date().toISOString(),
    entries: results,
  };
  writeFileSync(INDEX_PATH, JSON.stringify(out, null, 2) + '\n');

  console.log('\n=== Done ===');
  console.log(`Regenerated: ${regenerated}`);
  console.log(`Reused (unchanged SHA): ${reused}`);
  console.log(`Errors: ${errors}`);
  console.log(`Index: ${INDEX_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
