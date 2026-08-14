/**
 * Web scraper for tcslc.com content -> Bedrock Knowledge Base S3 bucket.
 *
 * Reads the sitemap, fetches each page, extracts text content,
 * and uploads to the KB data source S3 bucket.
 *
 * Usage: AWS_REGION=us-east-1 npx tsx scripts/scrape-kb-content.ts
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const S3_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const SITEMAP_URL = 'https://www.tcslc.com/sitemap.xml';
const CONCURRENCY = 5; // Parallel fetches
const DELAY_MS = 500; // Polite delay between batches

/**
 * Supplemental URLs — live tcslc pages that aren't in sitemap.xml but contain
 * material the chatbot needs. Discovered via an ID-sweep audit (IDs 1-400)
 * April 2026. Re-run the audit yearly; add anything new here.
 */
const SUPPLEMENTAL_URLS = [
  // /101/Services is ~26 chars of useful text after extraction (mostly a
  // visual menu of sub-pages); we already have every sub-page it links to.
  // /328/Real-Estate-Change-of-Address and /329/Tourist-Development-Tax-...
  // are JotForm interactive embeds with no static content. All three skipped.
  'https://www.tcslc.com/172/Newsroom',
  'https://www.tcslc.com/312/Titles',
  'https://www.tcslc.com/315/Driver-License-IDs',
  'https://www.tcslc.com/316/Exams',
  'https://www.tcslc.com/318/Vehicle-Registration',
  'https://www.tcslc.com/319/Parking-Permits',
  'https://www.tcslc.com/325/Home-2025-Redesign',
  'https://www.tcslc.com/330/Dealer-Application',
  'https://www.tcslc.com/331/Concealed-Weapon-Permits',
];

/**
 * Non-customer / non-content URLs to skip. Legal boilerplate, admin-UI,
 * staff-auth, duplicate, or external-redirect pages. See tcslc KB gap audit notes.
 */
const SKIP_URL_PATHS = new Set<string>([
  '/4', '/4/',                         // duplicate of /1 home
  '/9', '/9/Careers',                  // jobs listing
  '/27', '/27/Online-Payments',        // duplicate of /166
  '/64', '/64/Emergency-Alert',        // site infra
  '/72', '/72/', '/73', '/73/',        // staff auth
  '/79', '/79/Social-Networking',
  '/83', '/83/About-Share',
  '/84', '/84/Thank-You',
  '/124', '/124/Privacy-Policy',
  '/125', '/125/Disclaimer',
  '/141',                              // CivicEngage "Loading" shell — no static content
  '/170',                              // external FWC hunting/fishing redirect
  '/178', '/179',                      // external charity landing pages
  '/231',                              // external FLHSMV forms redirect — covered by flhsmv- prefixes
  '/242', '/242/', '/243', '/243/',    // duplicates of /241/Make-an-Appointment
  '/244', '/245', '/246', '/247', '/248', '/249', '/250',  // staff auth
  '/254', '/255', '/256', '/294', '/295',                   // staff auth
  '/281',                              // HTML shell wrapping a PDF
  '/284',                              // external FLHSMV handbooks redirect
  '/314',                              // towCalc JS widget, no prose
  // Legacy aspx UIs (calendar/directory/archive — not customer transactions)
  '/Activities', '/AgendaCenter', '/Facilities', '/FormCenter', '/DocumentCenter',
  '/CivicAlerts.aspx', '/Calendar.aspx', '/AlertCenter.aspx', '/Directory.aspx',
  '/BusinessDirectoryii.aspx', '/Archive.aspx', '/Jobs.aspx', '/Gallery.aspx',
  '/RealEstate.aspx', '/Bids.aspx', '/Blog.aspx', '/list.aspx', '/Forms.aspx',
  '/156/Meet-the-Team',                // staff directory, not taxpayer services
  '/158/Job-Postings',                 // duplicate of /9
  '/160/Christian-Medina',             // individual staff profile
  '/239/Customer-Satisfaction-Surveys', // survey widget landing, no service info
  '/272/Public-Records-Requests',      // admin workflow not taxpayer service content
]);

function shouldSkipUrl(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    const path = u.pathname;
    if (SKIP_URL_PATHS.has(path)) return true;
    // Also handle trailing-slash variants
    if (SKIP_URL_PATHS.has(path.replace(/\/$/, ''))) return true;
    return false;
  } catch {
    return false;
  }
}

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

interface PageContent {
  url: string;
  title: string;
  text: string;
  slug: string;
}

async function main() {
  console.log('=== tcslc.com Knowledge Base Scraper ===\n');

  // Step 1: Parse sitemap + merge with supplemental URLs, then apply skip filter
  console.log('Fetching sitemap...');
  const sitemapXml = await fetch(SITEMAP_URL).then(r => r.text());
  const sitemapUrls = [...sitemapXml.matchAll(/<loc>(.*?)<\/loc>/g)].map(m => m[1]);
  const combined = new Set<string>([...sitemapUrls, ...SUPPLEMENTAL_URLS]);
  const urls = [...combined].filter(u => !shouldSkipUrl(u));
  console.log(`Sitemap: ${sitemapUrls.length}, supplemental: ${SUPPLEMENTAL_URLS.length}, after skip filter: ${urls.length}\n`);

  // Step 2: Fetch and extract text from each page
  const pages: PageContent[] = [];
  let fetched = 0;
  let errors = 0;

  for (let i = 0; i < urls.length; i += CONCURRENCY) {
    const batch = urls.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(url => fetchAndExtract(url))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        pages.push(result.value);
        fetched++;
      } else {
        errors++;
        if (result.status === 'rejected') {
          console.error(`  Error: ${result.reason}`);
        }
      }
    }

    process.stdout.write(`  Fetched ${fetched}/${urls.length} (${errors} errors)\r`);

    if (i + CONCURRENCY < urls.length) {
      await sleep(DELAY_MS);
    }
  }
  console.log(`\nFetched ${fetched} pages, ${errors} errors\n`);

  // Step 3: Upload to S3
  console.log(`Uploading to s3://${S3_BUCKET}/...`);
  let uploaded = 0;

  for (const page of pages) {
    if (page.text.length < 50) {
      // Skip nearly-empty pages
      continue;
    }

    const key = `tcslc/${page.slug}.txt`;
    const content = formatForKB(page);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: content,
      ContentType: 'text/plain; charset=utf-8',
      Metadata: {
        'source-url': page.url,
        'page-title': page.title.replace(/[^\x20-\x7E]/g, '').substring(0, 200),
      },
    }));

    uploaded++;
    process.stdout.write(`  Uploaded ${uploaded} files\r`);
  }

  console.log(`\nDone! Uploaded ${uploaded} files to s3://${S3_BUCKET}/tcslc/`);
  console.log('\nNext steps:');
  console.log('  1. Create a Bedrock Knowledge Base pointing to this S3 bucket');
  console.log('  2. Set BEDROCK_KB_ID in the Lambda environment');
  console.log('  3. The chatbot will use it for general Q&A fallback (FR-CHAT-15)');
}

async function fetchAndExtract(url: string): Promise<PageContent | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'StLucieTaxBot/1.0 (Knowledge Base Builder)',
        'Accept': 'text/html',
      },
    });

    if (!res.ok) return null;

    const html = await res.text();
    const title = extractTitle(html);
    const text = htmlToText(html);
    const slug = urlToSlug(url);

    return { url, title, text, slug };
  } catch {
    return null;
  }
}

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/is);
  return match ? cleanText(match[1]) : 'Untitled';
}

function htmlToText(html: string): string {
  let text = html;

  // Remove script and style blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove navigation, header, footer if identifiable
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');

  // Try to extract main content area
  const mainMatch = text.match(/<main[\s\S]*?<\/main>/i) ||
                    text.match(/<article[\s\S]*?<\/article>/i) ||
                    text.match(/<div[^>]*class="[^"]*content[^"]*"[\s\S]*?<\/div>/i);

  if (mainMatch) {
    text = mainMatch[0];
  }

  // Convert common elements to text with structure
  text = text.replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n');
  text = text.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)');

  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&#\d+;/g, '');

  // Clean up whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n');
  text = text.trim();

  return text;
}

function formatForKB(page: PageContent): string {
  return [
    `Title: ${page.title}`,
    `Source: ${page.url}`,
    `---`,
    '',
    page.text,
  ].join('\n');
}

function urlToSlug(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

function cleanText(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error('Scraper failed:', err);
  process.exit(1);
});
