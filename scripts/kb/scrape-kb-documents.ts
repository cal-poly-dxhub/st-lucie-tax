/**
 * Document scraper: downloads linked PDFs from tcslc.com pages
 * and uploads them to the KB S3 bucket.
 *
 * Bedrock Knowledge Bases natively support PDF ingestion — no text
 * extraction needed. The KB will chunk and embed the PDF content.
 *
 * Usage: AWS_REGION=us-east-1 npx tsx scripts/scrape-kb-documents.ts
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

const S3_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const SITEMAP_URL = 'https://www.tcslc.com/sitemap.xml';
const BASE_URL = 'https://www.tcslc.com';
const CONCURRENCY = 3;
const DELAY_MS = 500;

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

async function main() {
  console.log('=== tcslc.com Document Scraper (PDFs + linked files) ===\n');

  // Step 1: Fetch all pages from sitemap
  console.log('Fetching sitemap...');
  const sitemapXml = await fetch(SITEMAP_URL).then(r => r.text());
  const pageUrls = [...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  console.log(`Found ${pageUrls.length} pages\n`);

  // Step 2: Crawl each page for document links
  console.log('Scanning pages for document links...');
  const docLinks = new Map<string, { url: string; pageSource: string; label: string }>();

  for (let i = 0; i < pageUrls.length; i += CONCURRENCY) {
    const batch = pageUrls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(url => extractDocumentLinks(url))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const link of result.value) {
          // Deduplicate by document ID
          const docId = extractDocId(link.url);
          if (docId && !docLinks.has(docId)) {
            docLinks.set(docId, link);
          }
        }
      }
    }
    process.stdout.write(`  Scanned ${Math.min(i + CONCURRENCY, pageUrls.length)}/${pageUrls.length} pages, found ${docLinks.size} unique docs\r`);
    if (i + CONCURRENCY < pageUrls.length) await sleep(DELAY_MS);
  }
  console.log(`\nFound ${docLinks.size} unique document links\n`);

  // Step 3: Download each document and upload to S3
  console.log('Downloading and uploading documents...');
  let uploaded = 0;
  let skipped = 0;
  let errors = 0;

  const entries = Array.from(docLinks.entries());
  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(([docId, link]) => downloadAndUpload(docId, link))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value === 'uploaded') uploaded++;
        else if (result.value === 'skipped') skipped++;
      } else {
        errors++;
      }
    }
    process.stdout.write(`  Processed ${Math.min(i + CONCURRENCY, entries.length)}/${entries.length} (${uploaded} uploaded, ${skipped} skipped, ${errors} errors)\r`);
    if (i + CONCURRENCY < entries.length) await sleep(DELAY_MS);
  }

  console.log(`\n\nDone!`);
  console.log(`  Uploaded: ${uploaded} documents`);
  console.log(`  Skipped:  ${skipped} (non-PDF or too small)`);
  console.log(`  Errors:   ${errors}`);
  console.log(`  Bucket:   s3://${S3_BUCKET}/tcslc-docs/`);
}

async function extractDocumentLinks(pageUrl: string): Promise<Array<{ url: string; pageSource: string; label: string }>> {
  try {
    const html = await fetch(pageUrl, {
      headers: { 'User-Agent': 'StLucieTaxBot/1.0' },
    }).then(r => r.text());

    const links: Array<{ url: string; pageSource: string; label: string }> = [];

    // Match /DocumentCenter/View/NNN patterns (with optional slug)
    const docPattern = /href=["']([^"']*\/DocumentCenter\/View\/\d+[^"']*)["'][^>]*>([^<]*)/gi;
    let match;
    while ((match = docPattern.exec(html)) !== null) {
      let href = match[1];
      const label = match[2].trim() || 'Unknown Document';

      // Make absolute URL
      if (href.startsWith('/')) {
        href = `${BASE_URL}${href}`;
      }

      // Clean up URL — remove query params that don't affect content
      href = href.split('?')[0];

      links.push({ url: href, pageSource: pageUrl, label });
    }

    // Also match plain /DocumentCenter/View/ URLs in text (not in href)
    const textPattern = /(?:https?:\/\/(?:www\.)?tcslc\.com)?\/DocumentCenter\/View\/(\d+)(?:\/[^\s\)"<]+)?/gi;
    while ((match = textPattern.exec(html)) !== null) {
      let href = match[0];
      if (href.startsWith('/')) {
        href = `${BASE_URL}${href}`;
      }
      href = href.split('?')[0];
      const docId = match[1];
      if (!links.some(l => extractDocId(l.url) === docId)) {
        links.push({ url: href, pageSource: pageUrl, label: `Document ${docId}` });
      }
    }

    return links;
  } catch {
    return [];
  }
}

function extractDocId(url: string): string | null {
  const match = url.match(/\/DocumentCenter\/View\/(\d+)/);
  return match ? match[1] : null;
}

async function downloadAndUpload(
  docId: string,
  link: { url: string; pageSource: string; label: string },
): Promise<'uploaded' | 'skipped'> {
  const res = await fetch(link.url, {
    headers: { 'User-Agent': 'StLucieTaxBot/1.0' },
    redirect: 'follow',
  });

  if (!res.ok) return 'skipped';

  const contentType = res.headers.get('content-type') || '';
  const body = await res.arrayBuffer();

  // Skip very small files (likely error pages)
  if (body.byteLength < 500) return 'skipped';

  // Determine file extension from content type
  let ext = 'pdf';
  if (contentType.includes('pdf')) ext = 'pdf';
  else if (contentType.includes('word') || contentType.includes('docx')) ext = 'docx';
  else if (contentType.includes('excel') || contentType.includes('xlsx')) ext = 'xlsx';
  else if (contentType.includes('html')) ext = 'html';
  else if (contentType.includes('image')) return 'skipped'; // Skip images
  else if (contentType.includes('text/plain')) ext = 'txt';

  // Create a descriptive filename
  const safeLabel = link.label
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .substring(0, 80);
  const key = `tcslc-docs/${docId}-${safeLabel}.${ext}`;

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: Buffer.from(body),
    ContentType: contentType || `application/${ext}`,
    Metadata: {
      'source-url': link.url.replace(/[^\x20-\x7E]/g, ''),
      'source-page': link.pageSource.replace(/[^\x20-\x7E]/g, ''),
      'doc-id': docId,
    },
  }));

  return 'uploaded';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
