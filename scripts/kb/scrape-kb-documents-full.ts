/**
 * DocumentCenter full-sweep scraper.
 *
 * The existing scrape-kb-documents.ts only discovers PDFs that are linked from
 * sitemap-listed pages. DocumentCenter contains many PDFs that aren't linked
 * from any sitemap page (dated announcements, HSMV forms referenced only from
 * JS-rendered accordions, etc.). This script sweeps DocumentCenter/View/N for
 * N in [1..1600] and uploads every PDF that passes a keyword filter.
 *
 * Same output location (s3://{bucket}/tcslc-docs/) and naming convention
 * (`{docId}-{sanitized-title}.pdf`) as the incremental scraper.
 *
 * Usage:
 *   AWS_REGION=us-east-1 npx tsx scripts/scrape-kb-documents-full.ts
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';

const S3_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const BASE_URL = 'https://www.tcslc.com';
const ID_RANGE_MAX = Number(process.env.TCSLC_DOC_MAX_ID || 1600);
const CONCURRENCY = Number(process.env.TCSLC_DOC_CONCURRENCY || 10);
const USER_AGENT = 'StLucieTaxBot/1.0 (doc-full-sweep)';

// Exclude these in the filename (case-insensitive substring match). Everything
// else is treated as relevant to customer taxpayer services.
const EXCLUDE_KEYWORDS = [
  'Go Live',
  'PDF Documentation',
  'Dealer Training Invitation',
  'Bidder Application',
  'Dealer Update',
  'Social Media Comment Policy',
  'Power Outage',
  'Town Hall',
  'VanDuzer',
  'PR.pdf',
  'Approved Budget',
  'Envelope',
  'Kiosk Information',
  'Spanish',
  'SPANISH',
  'Espan',              // catches "Espanol"
  'Kreyogravel',        // catches Haitian Creole
  'Help Martin County',
  'Directions to Region',
  'Alarm Permit',
  '2019 Dealer',
  'Feb 28 2020',
  'Oct 2021',
  'Nov 30 2021',
  'Apr 2022',
  'Local Celebrity',
  'FY 2022-23',
  'FY23-24',
  '2025 HOLIDAY',
];

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

interface DocMeta {
  id: number;
  filename: string;
  size: number;
  contentType: string;
}

async function headDoc(id: number): Promise<DocMeta | null> {
  try {
    const r = await fetch(`${BASE_URL}/DocumentCenter/View/${id}`, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.includes('pdf') && !ct.includes('octet-stream')) return null;
    const size = parseInt(r.headers.get('content-length') || '0', 10);
    if (size < 500) return null;
    const cd = r.headers.get('content-disposition') || '';
    let filename = '';
    for (const bit of cd.split(';')) {
      const trimmed = bit.trim();
      if (trimmed.startsWith('filename=')) {
        filename = decodeURIComponent(trimmed.slice('filename='.length).replace(/^"|"$/g, ''));
      }
    }
    // Consume the body so the connection closes cleanly.
    await r.arrayBuffer();
    return { id, filename, size, contentType: ct };
  } catch {
    return null;
  }
}

function shouldKeep(filename: string): boolean {
  const lower = filename.toLowerCase();
  return !EXCLUDE_KEYWORDS.some(k => lower.includes(k.toLowerCase()));
}

function safeKey(id: number, filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '');
  const slug = stem
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 80);
  return `tcslc-docs/${id}-${slug}.pdf`;
}

async function alreadyUploaded(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function downloadAndUpload(meta: DocMeta): Promise<'uploaded' | 'skipped' | 'error'> {
  const key = safeKey(meta.id, meta.filename);
  if (await alreadyUploaded(key)) return 'skipped';
  try {
    const r = await fetch(`${BASE_URL}/DocumentCenter/View/${meta.id}`, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    if (!r.ok) return 'error';
    const body = await r.arrayBuffer();
    if (body.byteLength < 500) return 'skipped';
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: Buffer.from(body),
        ContentType: meta.contentType,
        Metadata: {
          'source-url': `${BASE_URL}/DocumentCenter/View/${meta.id}`,
          'doc-id': String(meta.id),
          'filename': meta.filename.replace(/[^\x20-\x7E]/g, '').substring(0, 200),
        },
      }),
    );
    return 'uploaded';
  } catch {
    return 'error';
  }
}

async function runBatched<T, R>(items: T[], fn: (item: T) => Promise<R>, label: string): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const batch = items.slice(i, i + CONCURRENCY);
    const res = await Promise.allSettled(batch.map(fn));
    for (const r of res) {
      if (r.status === 'fulfilled') {
        results.push(r.value);
      } else {
        results.push('error' as unknown as R);
      }
    }
    process.stderr.write(`\r  ${label}: ${Math.min(i + CONCURRENCY, items.length)}/${items.length}`);
    await new Promise(res => setTimeout(res, 100));
  }
  process.stderr.write('\n');
  return results;
}

async function main() {
  console.log('=== tcslc DocumentCenter Full-Sweep Scraper ===');
  console.log(`Bucket: s3://${S3_BUCKET}/tcslc-docs/`);
  console.log(`Scanning DocumentCenter/View/1..${ID_RANGE_MAX}\n`);

  // 1) Discover — HEAD every ID to find live PDFs and extract filenames.
  const ids = Array.from({ length: ID_RANGE_MAX }, (_, i) => i + 1);
  const metas: DocMeta[] = [];
  const heads = await runBatched(ids, headDoc, 'Discovering');
  for (const m of heads) if (m) metas.push(m);
  console.log(`Discovered ${metas.length} live PDFs.`);

  // 2) Filter by keyword.
  const kept = metas.filter(m => shouldKeep(m.filename));
  const excluded = metas.length - kept.length;
  console.log(`After keyword filter: ${kept.length} kept, ${excluded} excluded.\n`);

  // 3) Upload (or skip if already in S3).
  const results = await runBatched(kept, downloadAndUpload, 'Uploading');
  const uploaded = results.filter(r => r === 'uploaded').length;
  const skipped = results.filter(r => r === 'skipped').length;
  const errors = results.filter(r => r === 'error').length;
  console.log(`\nDone! ${uploaded} uploaded, ${skipped} already present, ${errors} errors.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
