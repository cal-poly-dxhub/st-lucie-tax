/**
 * Full-site FLHSMV + Florida Statutes KB scraper.
 *
 * Drives off the published Yoast sitemap index (~1,900 URLs across three
 * sub-sitemaps), filters down to the English-language service content that is
 * actually relevant to St. Lucie customers, fetches each page, harvests the
 * linked HSMV form PDFs, and uploads everything to the Bedrock KB S3 bucket:
 *
 *   s3://{bucket}/flhsmv-pages/{slug}.txt            — procedure/reference pages
 *   s3://{bucket}/flhsmv-forms/{formNumber}.pdf      — form PDFs (numbered)
 *   s3://{bucket}/flhsmv-statutes/{chapter}-{section}.txt  — Florida Statutes text
 *
 * We respect the site's robots.txt — skip:
 *   /frip/            (unrelated — Financial Responsibility Insurance Program UI)
 *   /forms/           (not the PDF path; this is a CMS collection)
 *   /pdf/frmanual/    (internal procedure manuals — explicitly disallowed)
 *
 * After uploads complete, the script prints the AWS CLI command to run the
 * Bedrock KB ingestion job. Ingestion is NOT triggered automatically — re-run
 * cost matters; operator confirms.
 *
 * Usage:
 *   AWS_REGION=us-east-1 npx tsx scripts/scrape-kb-flhsmv.ts
 *
 * Flags (env):
 *   FLHSMV_SCRAPE_DRY_RUN=1     print the URL plan, skip uploads
 *   FLHSMV_SCRAPE_LIMIT=N       cap pages fetched (smoke test)
 *   FLHSMV_SCRAPE_CONCURRENCY=N override concurrency (default 4)
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const S3_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const DRY_RUN = process.env.FLHSMV_SCRAPE_DRY_RUN === '1';
const LIMIT = Number(process.env.FLHSMV_SCRAPE_LIMIT || 0) || Infinity;
const CONCURRENCY = Number(process.env.FLHSMV_SCRAPE_CONCURRENCY || 4);
const DELAY_MS = 400;
const USER_AGENT = 'StLucieTaxBot/1.0 (scrape-kb-flhsmv; contact: dev@dxhub)';

const SITEMAP_INDEX = 'https://www.flhsmv.gov/sitemap_index.xml';

/**
 * Top-level path segments we treat as "relevant to customer-facing service".
 * Anything else (press releases, FHP memorials, annual reports, Spanish pages)
 * is dropped. Order: driver-license work first, then vehicle, then shared.
 */
const RELEVANT_PATH_PREFIXES = [
  '/driver-licenses-id-cards/',
  '/motor-vehicles-tags-titles/',
  '/insurance/',
  '/fees/',
  '/military/',
  '/new-resident/',
  '/traffic-citations/',
  '/ppos/',              // processing-partners offices / online-services
  '/locations/',         // office locator — narrowed below to St. Lucie only
];

/**
 * Sub-trees inside RELEVANT_PATH_PREFIXES that are business-facing / operator-
 * facing rather than consumer-facing. These pollute retrieval for St. Lucie
 * customer questions (CDL third-party tester bond requirements appearing when
 * a customer asks about CDL fees, etc.). Dropped after the prefix match.
 */
const EXCLUDED_PATH_PREFIXES = [
  // CDL operator programs, not CDL holders:
  '/driver-licenses-id-cards/commercial-motor-vehicle-drivers/commercial-driver-license-third-party-testing/',
  '/driver-licenses-id-cards/commercial-motor-vehicle-drivers/international-fuel-tax-agreement/',
  '/driver-licenses-id-cards/commercial-motor-vehicle-drivers/international-registration-plan/',
  // Course providers, not people taking courses:
  '/driver-licenses-id-cards/education-courses/',
  // Dealer/installer/manufacturer-facing content:
  '/motor-vehicles-tags-titles/dealers-installers-manufacturers-distributors-importers/',
  // Internal staff bulletins and procedure manuals:
  '/motor-vehicles-tags-titles/motor-vehicle-bulletins/',
  '/motor-vehicles-tags-titles/motor-vehicle-procedure-manual/',
];

/**
 * For /locations/, keep ONLY the landing page + the local county. Other-
 * county pages just pollute the retrieval with unrelated address data.
 */
const LOCATIONS_KEEP = new Set<string>([
  '/locations/',
  '/locations/st-lucie/',
]);

/**
 * Top-level landing pages worth ingesting even though they sit above the
 * prefix list above. These are deep-linked from many places.
 */
const EXTRA_LANDING_URLS = [
  'https://www.flhsmv.gov/',
];

/**
 * Florida Statutes — authoritative sections cited by pilot trees, plus the
 * broader set the content sprint is likely to reference. Fetched from
 * flsenate.gov; NOT discovered from the sitemap crawl.
 */
const MANUAL_STATUTES: Array<{ chapter: string; section: string }> = [
  // License issuance / renewal / surrender
  { chapter: '322', section: '031' }, // New-resident licensing
  { chapter: '322', section: '17' },  // Duplicate license
  { chapter: '322', section: '21' },  // License fees
  { chapter: '322', section: '18' },  // Renewals
  { chapter: '322', section: '53' },  // CDL — issuance / cancellation
  { chapter: '322', section: '54' },  // CDL — exam waiver
  { chapter: '322', section: '142' }, // Color photograph on DL
  { chapter: '322', section: '19' },  // Change of name / address
  // Vehicle titles / registration
  { chapter: '319', section: '23' },  // Title application
  { chapter: '319', section: '14' },  // Odometer disclosure
  { chapter: '320', section: '02' },  // Registration required
  { chapter: '320', section: '03' },  // Registration of vehicles
  { chapter: '320', section: '0609' }, // Transfer of registration
  { chapter: '320', section: '072' }, // Initial-registration fee
  { chapter: '320', section: '27' },  // Dealer licensing (referenced by title flows)
  { chapter: '320', section: '0848' }, // Disabled parking permits
  // Insurance & PIP
  { chapter: '627', section: '733' }, // Automobile insurance requirements
  // Property tax (for property-tax transaction)
  { chapter: '197', section: '222' }, // Installment plan
  { chapter: '197', section: '252' }, // Homestead tax deferral
  // Hunting / fishing / vessel (for those transactions)
  { chapter: '379', section: '354' }, // Licenses to take wild animal life / freshwater fish
  { chapter: '328', section: '72' },  // Vessel registration
  // DL sanctions / reinstatement (for dl-sanctions-lift transaction)
  { chapter: '322', section: '28' },   // Period of suspension / revocation
  { chapter: '322', section: '2615' }, // DUI administrative suspension
  { chapter: '322', section: '291' },  // Advanced Driver Improvement course
  { chapter: '322', section: '34' },   // Driving while license suspended / revoked
];

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// -----------------------------------------------------------------------------

async function main() {
  console.log('=== FLHSMV Full-Site KB Scraper ===\n');
  if (DRY_RUN) console.log('** DRY RUN — no uploads will happen **\n');

  const rawUrls = await collectSitemapUrls();
  console.log(`Sitemap raw URL count: ${rawUrls.length}`);

  const pageUrls = filterPageUrls(rawUrls);
  console.log(`Relevant English page URLs: ${pageUrls.length}`);

  const pagesToFetch = pageUrls.slice(0, LIMIT);
  console.log(`Will fetch: ${pagesToFetch.length}${pagesToFetch.length < pageUrls.length ? ` (LIMIT=${LIMIT})` : ''}\n`);

  if (DRY_RUN) {
    for (const u of pagesToFetch.slice(0, 30)) console.log('  ', u);
    console.log(pagesToFetch.length > 30 ? `  … and ${pagesToFetch.length - 30} more` : '');
  }

  const harvestedForms = new Set<string>();
  const pageResults = await runBatched(pagesToFetch, async url => {
    return fetchAndUploadPage(url, harvestedForms);
  });
  printResults('Pages', pageResults);

  const catalogForms = collectFormNumbersFromCatalog();
  for (const n of catalogForms) harvestedForms.add(n);

  const formNumbers = [...harvestedForms].sort();
  console.log(`\nHarvested ${formNumbers.length} form PDFs (${catalogForms.length} from catalog, rest discovered via page crawl).`);

  const formResults = await runBatched(formNumbers, uploadForm);
  printResults('Forms', formResults);

  console.log('\nUploading Florida Statutes...');
  const statuteResults = await runBatched(MANUAL_STATUTES, uploadStatute);
  printResults('Statutes', statuteResults);

  console.log('\n=== Done ===');
  console.log(`Bucket: s3://${S3_BUCKET}/flhsmv-pages/, /flhsmv-forms/, /flhsmv-statutes/`);
  console.log('\nNext step — start the Bedrock KB ingestion job:');
  console.log('  aws bedrock-agent start-ingestion-job \\');
  console.log('    --knowledge-base-id DREJTMKWRM \\');
  console.log('    --data-source-id   UHCEFZRCSW');
}

// -----------------------------------------------------------------------------
// Sitemap walking

async function collectSitemapUrls(): Promise<string[]> {
  const indexXml = await fetchText(SITEMAP_INDEX);
  const subSitemaps = extractLocs(indexXml);
  console.log(`Sitemap index -> ${subSitemaps.length} sub-sitemaps:`);
  for (const s of subSitemaps) console.log('  ', s);

  const urls = new Set<string>();
  for (const sm of subSitemaps) {
    try {
      const xml = await fetchText(sm);
      for (const u of extractLocs(xml)) urls.add(u);
    } catch (err) {
      console.warn(`  sitemap ${sm} failed: ${(err as Error).message}`);
    }
  }
  for (const u of EXTRA_LANDING_URLS) urls.add(u);
  return [...urls];
}

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1].trim());
}

/**
 * Keep the URLs that look like customer-facing English service pages.
 * Drop Spanish variants, dated news posts, FHP fluff, and robots-disallowed paths.
 */
function filterPageUrls(urls: string[]): string[] {
  const keep = new Set<string>();
  for (const raw of urls) {
    let u: URL;
    try { u = new URL(raw); } catch { continue; }
    if (u.hostname !== 'www.flhsmv.gov' && u.hostname !== 'flhsmv.gov') continue;

    const path = u.pathname;
    if (path.endsWith('-es/') || path.includes('-es/')) continue;        // Spanish
    if (/^\/\d{4}\/\d{2}\/\d{2}\//.test(path)) continue;                  // news posts
    if (path.startsWith('/frip/')) continue;                              // robots
    if (path.startsWith('/pdf/frmanual/')) continue;                      // robots
    if (path.startsWith('/florida-highway-patrol/')) continue;            // FHP org stuff
    if (path.startsWith('/privacy-statement')) continue;
    if (path.startsWith('/resources/crash-citation-reports')) continue;
    if (path.startsWith('/category/')) continue;
    if (path.startsWith('/tag/')) continue;
    if (path.startsWith('/author/')) continue;
    if (path.startsWith('/tribe_events/')) continue;
    if (path.startsWith('/2019/') || path.startsWith('/2020/') || path.startsWith('/2021/')) continue;
    if (path.startsWith('/2022/') || path.startsWith('/2023/') || path.startsWith('/2024/')) continue;
    if (path.startsWith('/2025/') || path.startsWith('/2026/')) continue;

    const isHomepage = path === '/' || path === '';
    const matchesPrefix = RELEVANT_PATH_PREFIXES.some(p => path.startsWith(p));
    if (!isHomepage && !matchesPrefix) continue;

    // Business/operator sub-trees — keep the parent landing page but drop
    // everything below it (see EXCLUDED_PATH_PREFIXES comment).
    if (EXCLUDED_PATH_PREFIXES.some(p => path.startsWith(p))) continue;

    // For /locations/* keep only St. Lucie + the landing page.
    if (path.startsWith('/locations/')) {
      const normalized = path.replace(/\/$/, '') + '/';
      if (!LOCATIONS_KEEP.has(normalized)) continue;
    }

    u.hash = '';
    u.search = '';
    keep.add(u.toString().replace(/\/$/, '') + (path === '/' ? '' : '/'));
  }
  return [...keep].sort();
}

// -----------------------------------------------------------------------------
// Page fetch + upload

async function fetchAndUploadPage(
  url: string,
  harvestedForms: Set<string>,
): Promise<'uploaded' | 'skipped' | 'error'> {
  try {
    const html = await fetchText(url);
    harvestFormLinks(html, harvestedForms);

    const text = htmlToText(html);
    if (text.length < 200) return 'skipped';

    const slug = urlToSlug(url);
    if (DRY_RUN) return 'uploaded';

    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `flhsmv-pages/${slug}.txt`,
        Body: text,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: { 'source-url': url, slug },
      }),
    );
    return 'uploaded';
  } catch (err) {
    console.warn(`  page ${url}: ${(err as Error).message}`);
    return 'error';
  }
}

function harvestFormLinks(html: string, into: Set<string>) {
  // href="https://www.flhsmv.gov/pdf/forms/82040.pdf" (or relative /pdf/forms/…)
  const rx = /href\s*=\s*["']([^"']*\/pdf\/forms\/([0-9A-Za-z_-]+)\.pdf)["']/gi;
  for (const m of html.matchAll(rx)) {
    if (!m[1].includes('/pdf/frmanual/')) {
      into.add(m[2]);
    }
  }
}

/**
 * Flhsmv URL -> flhsmv-pages slug. Uses a double-dash separator for path
 * segments so mapS3ToSource() can reverse it back into a browsable URL.
 * e.g. /driver-licenses-id-cards/commercial-driver-license/
 *   -> driver-licenses-id-cards--commercial-driver-license
 */
function urlToSlug(raw: string): string {
  const u = new URL(raw);
  const segs = u.pathname.replace(/^\/|\/$/g, '').split('/').filter(Boolean);
  if (segs.length === 0) return 'home';
  return segs.join('--').replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 180);
}

/**
 * Readability-ish HTML-to-text. Prefers <main>/<article>/content div; strips
 * scripts/styles/nav/header/footer; preserves h1-h6, <li>, <p>, <br>. Kept
 * identical in spirit to scrape-kb-content.ts so both sources produce a
 * consistent text format the KB chunker can handle.
 */
function htmlToText(html: string): string {
  let text = html;

  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  const main =
    text.match(/<main[\s\S]*?<\/main>/i) ||
    text.match(/<article[\s\S]*?<\/article>/i) ||
    text.match(/<div[^>]*class="[^"]*(?:entry-content|page-content|site-content)[^"]*"[\s\S]*?<\/div>/i);
  if (main) text = main[0];

  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, '\n## $2\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');

  text = text.replace(/<[^>]+>/g, ' ');

  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));

  text = text.replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  return text;
}

// -----------------------------------------------------------------------------
// Form PDF upload

async function uploadForm(formNumber: string): Promise<'uploaded' | 'skipped' | 'error'> {
  const url = `https://www.flhsmv.gov/pdf/forms/${formNumber}.pdf`;
  try {
    if (!DRY_RUN) {
      // Skip if already uploaded — PDFs don't change often; saves bandwidth on re-runs.
      try {
        await s3.send(
          new HeadObjectCommand({ Bucket: S3_BUCKET, Key: `flhsmv-forms/${formNumber}.pdf` }),
        );
        return 'skipped';
      } catch { /* not present, continue */ }
    }

    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) {
      console.warn(`  form ${formNumber}: HTTP ${res.status}`);
      return 'skipped';
    }
    const body = await res.arrayBuffer();
    if (body.byteLength < 500) return 'skipped';

    if (DRY_RUN) return 'uploaded';
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `flhsmv-forms/${formNumber}.pdf`,
        Body: Buffer.from(body),
        ContentType: 'application/pdf',
        Metadata: { 'source-url': url, 'form-number': formNumber },
      }),
    );
    return 'uploaded';
  } catch (err) {
    console.warn(`  form ${formNumber}: ${(err as Error).message}`);
    return 'error';
  }
}

function collectFormNumbersFromCatalog(): string[] {
  const forms = new Set<string>();
  const dataDir = resolve(process.cwd(), 'services/chatbot/src/data');

  try {
    const catalog = JSON.parse(readFileSync(resolve(dataDir, 'item-catalog.json'), 'utf-8')) as Array<{
      source?: string;
    }>;
    for (const item of catalog) {
      const m = item.source?.match(/flhsmv\.gov\/pdf\/forms\/([0-9A-Za-z_-]+)\.pdf/i);
      if (m) forms.add(m[1]);
    }
  } catch { /* no catalog yet */ }

  try {
    const treeDir = resolve(dataDir, 'decision-trees');
    for (const file of readdirSync(treeDir)) {
      if (!file.endsWith('.json')) continue;
      const tree = JSON.parse(readFileSync(resolve(treeDir, file), 'utf-8')) as {
        sources?: { flhsmvVerified?: string[] };
      };
      for (const url of tree.sources?.flhsmvVerified ?? []) {
        const m = url.match(/flhsmv\.gov\/pdf\/forms\/([0-9A-Za-z_-]+)\.pdf/i);
        if (m) forms.add(m[1]);
      }
    }
  } catch { /* no trees yet */ }

  return [...forms].sort();
}

// -----------------------------------------------------------------------------
// Statute upload

async function uploadStatute(s: { chapter: string; section: string }): Promise<'uploaded' | 'skipped' | 'error'> {
  const url = `https://www.flsenate.gov/Laws/Statutes/2024/${s.chapter}.${s.section}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow' });
    if (!res.ok) {
      console.warn(`  statute ${s.chapter}.${s.section}: HTTP ${res.status}`);
      return 'skipped';
    }
    const html = await res.text();
    const text = htmlToText(html);
    if (text.length < 200) return 'skipped';

    if (DRY_RUN) return 'uploaded';
    await s3.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `flhsmv-statutes/${s.chapter}-${s.section.replace('.', '-')}.txt`,
        Body: text,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: { 'source-url': url, statute: `${s.chapter}.${s.section}` },
      }),
    );
    return 'uploaded';
  } catch (err) {
    console.warn(`  statute ${s.chapter}.${s.section}: ${(err as Error).message}`);
    return 'error';
  }
}

// -----------------------------------------------------------------------------
// Plumbing

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/xml;q=0.9,*/*;q=0.5' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

async function runBatched<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
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
    process.stdout.write(`  progress ${Math.min(i + CONCURRENCY, items.length)}/${items.length}\r`);
    if (i + CONCURRENCY < items.length) await sleep(DELAY_MS);
  }
  process.stdout.write('\n');
  return results;
}

function printResults(label: string, results: string[]) {
  const uploaded = results.filter(r => r === 'uploaded').length;
  const skipped = results.filter(r => r === 'skipped').length;
  const errors = results.filter(r => r === 'error').length;
  console.log(`  ${label}: ${uploaded} uploaded, ${skipped} skipped, ${errors} errors`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

main().catch(err => {
  console.error('FLHSMV scraper failed:', err);
  process.exit(1);
});
