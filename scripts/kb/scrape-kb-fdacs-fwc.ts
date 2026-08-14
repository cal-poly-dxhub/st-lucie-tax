/**
 * Narrow scraper — FDACS (Concealed Weapon License) + FWC (hunting/fishing)
 *
 * Unlike scrape-kb-flhsmv.ts which walks a sitemap, this script targets only
 * the pages and PDFs directly relevant to the two remaining decision trees
 * (concealed-weapon, hunting-fishing). No sitemap crawl, no breadth-first
 * harvest — just a handful of curated URLs.
 *
 * Output:
 *   s3://{bucket}/fdacs-pages/{slug}.txt       — FDACS CCW procedure pages
 *   s3://{bucket}/fdacs-forms/{slug}.pdf       — FDACS application/renewal PDFs
 *   s3://{bucket}/fwc-pages/{slug}.txt         — FWC license pages
 *   s3://{bucket}/flhsmv-statutes/{c}-{s}.txt  — Florida Statutes §790.06, §790.0655
 *                                                (adds to the existing statute prefix)
 *
 * Usage:
 *   AWS_REGION=us-east-1 npx tsx scripts/scrape-kb-fdacs-fwc.ts
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const S3_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const USER_AGENT = 'StLucieTaxBot/1.0 (scrape-fdacs-fwc)';
const DELAY_MS = 600;

/**
 * FDACS content lives behind a Next.js SPA — HTML is empty on first paint.
 * But every page ships a JSON snapshot at /_next/data/<buildId>/<path>.json
 * containing `pageData.description.html5` with the full static body.
 *
 * The buildId changes when FDACS redeploys; we fetch one page's HTML on the
 * fly to extract the current buildId before scraping the full set.
 */
const FDACS_HOME = 'https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License';

const FDACS_CCW_PATHS = [
  'Consumer-Resources/Concealed-Weapon-License',
  'Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License',
  'Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Eligibility-Requirements',
  'Consumer-Resources/Concealed-Weapon-License/Applying-for-a-Concealed-Weapon-License/Acceptable-Firearms-Training-Documentation',
  'Consumer-Resources/Concealed-Weapon-License/How-to-Apply-For-a-Florida-Concealed-Weapon-License',
  'Consumer-Resources/Concealed-Weapon-License/How-to-Apply-For-a-Florida-Concealed-Weapon-License/Apply-Online',
  'Consumer-Resources/Concealed-Weapon-License/How-to-Apply-For-a-Florida-Concealed-Weapon-License/Apply-in-Person',
  'Consumer-Resources/Concealed-Weapon-License/How-to-Apply-For-a-Florida-Concealed-Weapon-License/Apply-Through-a-Tax-Collector',
  'Consumer-Resources/Concealed-Weapon-License/How-to-Apply-For-a-Florida-Concealed-Weapon-License/Apply-by-Mail',
  'Consumer-Resources/Concealed-Weapon-License/Renewing-a-Concealed-Weapon-License',
  'Consumer-Resources/Concealed-Weapon-License/Concealed-Weapon-License-Application-Instructions',
  'Consumer-Resources/Concealed-Weapon-License/Forms-and-Publications',
];

/**
 * FWC is static HTML — direct scrape works. Ten pages cover every variant
 * (who needs a license, residency, fishing/hunting licenses, visitors,
 * military discount, lifetime, ordering).
 */
const FWC_RECREATIONAL_URLS = [
  'https://myfwc.com/license/recreational/',
  'https://myfwc.com/license/recreational/do-i-need-one/',
  'https://myfwc.com/license/recreational/florida-residency/',
  'https://myfwc.com/license/recreational/how-to-order/',
  'https://myfwc.com/license/recreational/saltwater-fishing/',
  'https://myfwc.com/license/recreational/freshwater-fishing/',
  'https://myfwc.com/license/recreational/hunting/',
  'https://myfwc.com/license/recreational/lifetime-licenses/',
  'https://myfwc.com/license/recreational/visitors/',
  'https://myfwc.com/license/recreational/military-gold/',
  'https://myfwc.com/license/recreational/faqs/',
];

/**
 * Florida Statutes specific to these two trees. §379.354 is already in the
 * FLHSMV scraper's MANUAL_STATUTES; we just need the two firearm statutes.
 */
const STATUTES_TO_ADD = [
  { chapter: '790', section: '06' },   // Concealed Weapons; license
  { chapter: '790', section: '0655' }, // Purchase/delivery of handguns; 3-day waiting period
];

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// ---------------------------------------------------------------------------
// HTTP helpers

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/json,*/*' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

async function fetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.arrayBuffer();
}

function sleep(ms: number): Promise<void> {
  return new Promise(res => setTimeout(res, ms));
}

// ---------------------------------------------------------------------------
// Minimal HTML → text

function htmlToText(html: string): string {
  let t = html;
  t = t.replace(/<script[\s\S]*?<\/script>/gi, '');
  t = t.replace(/<style[\s\S]*?<\/style>/gi, '');
  t = t.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  t = t.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  t = t.replace(/<header[\s\S]*?<\/header>/gi, '');
  t = t.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  t = t.replace(/<aside[\s\S]*?<\/aside>/gi, '');
  const main =
    t.match(/<main[\s\S]*?<\/main>/i) ||
    t.match(/<article[\s\S]*?<\/article>/i) ||
    t.match(/<div[^>]*class="[^"]*(?:entry-content|page-content|site-content)[^"]*"[\s\S]*?<\/div>/i);
  if (main) t = main[0];
  t = t.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, '\n## $2\n');
  t = t.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  t = t.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  t = t.replace(/<br\s*\/?>/gi, '\n');
  t = t.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');
  t = t.replace(/<[^>]+>/g, ' ');
  t = t
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
  return t.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

function slugify(s: string): string {
  return s.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').substring(0, 180);
}

// ---------------------------------------------------------------------------
// FDACS — extract Next.js buildId, then hit _next/data JSON for each CCW page

async function getFdacsBuildId(): Promise<string> {
  const html = await fetchText(FDACS_HOME);
  const m = html.match(/"buildId":"([^"]+)"/);
  if (!m) throw new Error('Could not extract FDACS Next.js buildId from homepage');
  return m[1];
}

interface FdacsPageResult {
  path: string;
  text: string;
  pdfsInBody: string[]; // relative URLs extracted from the body
  bodyLength: number;   // chars of raw html5 body; 0 for menu-only nodes
}

async function fetchFdacsPage(buildId: string, path: string): Promise<FdacsPageResult> {
  const url = `https://www.fdacs.gov/_next/data/${buildId}/${path}.json`;
  const raw = await fetchText(url);
  const json = JSON.parse(raw);
  const body: string =
    json?.pageProps?.pageData?.description?.html5 ??
    json?.pageProps?.pageData?.shortDescription?.html5 ??
    '';
  const name: string = json?.pageProps?.pageData?.name ?? path;
  const formatted = `Title: ${name}\nSource: https://www.fdacs.gov/${path}\n---\n\n${htmlToText(body)}`;

  // Harvest PDF links referenced in the body (relative /content/download/... paths).
  const pdfsInBody = [...body.matchAll(/href="([^"]+\.pdf[^"]*)"/gi)].map(m => m[1]);

  return { path, text: formatted, pdfsInBody, bodyLength: body.length };
}

// ---------------------------------------------------------------------------
// FWC — direct static HTML

interface FwcPageResult {
  url: string;
  text: string;
}

async function fetchFwcPage(url: string): Promise<FwcPageResult> {
  const html = await fetchText(url);
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;
  const text = htmlToText(html);
  return {
    url,
    text: `Title: ${title}\nSource: ${url}\n---\n\n${text}`,
  };
}

// ---------------------------------------------------------------------------
// Florida Statutes

async function fetchStatute(chapter: string, section: string): Promise<string> {
  const url = `https://www.flsenate.gov/Laws/Statutes/2024/${chapter}.${section}`;
  const html = await fetchText(url);
  const text = htmlToText(html);
  return `Title: Florida Statutes §${chapter}.${section}\nSource: ${url}\n---\n\n${text}`;
}

// ---------------------------------------------------------------------------
// S3 upload

async function uploadText(key: string, body: string, sourceUrl: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'text/plain; charset=utf-8',
    Metadata: { 'source-url': sourceUrl },
  }));
}

async function uploadPdf(key: string, body: Buffer, sourceUrl: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: 'application/pdf',
    Metadata: { 'source-url': sourceUrl },
  }));
}

// ---------------------------------------------------------------------------

async function main() {
  console.log('=== FDACS + FWC + Statutes narrow scraper ===\n');

  let fdacsPages = 0;
  let fdacsPdfs = 0;
  let fwcPages = 0;
  let statutes = 0;
  const pdfsToFetch = new Set<string>();

  // --- FDACS pages ---
  console.log('Fetching FDACS Next.js buildId...');
  const buildId = await getFdacsBuildId();
  console.log(`  buildId = ${buildId}\n`);

  console.log('Fetching FDACS CCW pages (skipping empty menu-only nodes)...');
  for (const path of FDACS_CCW_PATHS) {
    try {
      const { text, pdfsInBody, bodyLength } = await fetchFdacsPage(buildId, path);
      // Menu/folder nodes on FDACS have no description.html5 — they're purely
      // navigation. Skip anything with <200 chars of body content; the parent
      // or sibling leaf pages carry the actual text.
      if (bodyLength < 200) {
        console.log(`  skip ${path} (menu node, no body content)`);
        for (const pdf of pdfsInBody) pdfsToFetch.add(pdf.startsWith('http') ? pdf : `https://www.fdacs.gov${pdf}`);
        continue;
      }
      const slug = slugify(path.replace(/^Consumer-Resources\/Concealed-Weapon-License\/?/, '') || 'home');
      await uploadText(`fdacs-pages/${slug}.txt`, text, `https://www.fdacs.gov/${path}`);
      fdacsPages += 1;
      for (const pdf of pdfsInBody) pdfsToFetch.add(pdf.startsWith('http') ? pdf : `https://www.fdacs.gov${pdf}`);
      console.log(`  ok   ${path}`);
    } catch (err) {
      console.warn(`  fail ${path}: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  // --- FDACS PDFs discovered in bodies ---
  console.log('\nFetching FDACS PDFs referenced in page bodies...');
  for (const pdfUrl of pdfsToFetch) {
    try {
      const buf = await fetchArrayBuffer(pdfUrl);
      const filename = pdfUrl.split('/').pop() || 'document.pdf';
      const slug = slugify(filename.replace(/\.pdf$/i, ''));
      await uploadPdf(`fdacs-forms/${slug}.pdf`, Buffer.from(buf), pdfUrl);
      fdacsPdfs += 1;
      console.log(`  ok  ${pdfUrl}`);
    } catch (err) {
      console.warn(`  fail  ${pdfUrl}: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  // --- FWC pages ---
  console.log('\nFetching FWC recreational-license pages...');
  for (const url of FWC_RECREATIONAL_URLS) {
    try {
      const { text } = await fetchFwcPage(url);
      const path = new URL(url).pathname.replace(/^\/+|\/+$/g, '');
      const slug = slugify(path || 'home');
      await uploadText(`fwc-pages/${slug}.txt`, text, url);
      fwcPages += 1;
      console.log(`  ok  ${url}`);
    } catch (err) {
      console.warn(`  fail  ${url}: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  // --- Statutes ---
  console.log('\nFetching Florida Statutes (adds to flhsmv-statutes/)...');
  for (const s of STATUTES_TO_ADD) {
    try {
      const text = await fetchStatute(s.chapter, s.section);
      const key = `flhsmv-statutes/${s.chapter}-${s.section.replace('.', '-')}.txt`;
      await uploadText(
        key,
        text,
        `https://www.flsenate.gov/Laws/Statutes/2024/${s.chapter}.${s.section}`,
      );
      statutes += 1;
      console.log(`  ok  §${s.chapter}.${s.section}`);
    } catch (err) {
      console.warn(`  fail  §${s.chapter}.${s.section}: ${(err as Error).message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log('\n=== Done ===');
  console.log(`Uploaded: ${fdacsPages} FDACS pages, ${fdacsPdfs} FDACS PDFs, ${fwcPages} FWC pages, ${statutes} statutes.`);
  console.log(`\nNext step — trigger Bedrock KB ingestion:`);
  console.log('  aws bedrock-agent start-ingestion-job \\');
  console.log('    --knowledge-base-id DREJTMKWRM \\');
  console.log('    --data-source-id   UHCEFZRCSW');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
