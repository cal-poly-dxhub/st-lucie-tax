/**
 * Narrow supplementary scrape for the dl-sanctions-lift decision tree.
 *
 * Adds:
 *   s3://{bucket}/flhsmv-pages/<slug>.txt  — 2 FLHSMV sub-pages not yet in KB
 *   s3://{bucket}/flhsmv-statutes/<c>-<s>.txt — 4 sanction / reinstatement statutes
 *
 * Why narrow: the existing scrape-kb-flhsmv.ts already captured the main
 * /driver-license-suspensions-revocations tree (4 pages). We only need the
 * DUI/IID sub-folder and the medical-visual-problems page, plus 4 statutes
 * (§322.28, §322.2615, §322.34, §322.291) that the sanctions tree will cite.
 *
 * Usage:
 *   AWS_REGION=us-east-1 npx tsx scripts/scrape-kb-sanctions-supplement.ts
 */

import 'dotenv/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const S3_BUCKET = process.env.KB_DATA_BUCKET || 'st-lucie-kb-data-<ACCOUNT_ID>';
const USER_AGENT = 'StLucieTaxBot/1.0 (scrape-sanctions-supplement)';

const FLHSMV_PAGES = [
  {
    url: 'https://www.flhsmv.gov/driver-licenses-id-cards/education-courses/dui-and-iid/',
    slug: 'driver-licenses-id-cards--education-courses--dui-and-iid',
  },
  {
    url: 'https://www.flhsmv.gov/driver-licenses-id-cards/general-information/medical-visual-problems/',
    slug: 'driver-licenses-id-cards--general-information--medical-visual-problems',
  },
];

const STATUTES = [
  { chapter: '322', section: '28' },    // Period of suspension / revocation
  { chapter: '322', section: '2615' },  // DUI administrative suspension
  { chapter: '322', section: '291' },   // ADI (advanced driver improvement) course
  { chapter: '322', section: '34' },    // Driving while license suspended / revoked
];

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    redirect: 'follow',
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

function htmlToText(html: string): string {
  let t = html;
  for (const tag of ['script', 'style', 'noscript', 'nav', 'header', 'footer', 'aside']) {
    t = t.replace(new RegExp(`<${tag}[\\s\\S]*?</${tag}>`, 'gi'), '');
  }
  const m =
    t.match(/<main[\s\S]*?<\/main>/i) ||
    t.match(/<article[\s\S]*?<\/article>/i) ||
    t.match(/<div[^>]*class="[^"]*(?:entry-content|page-content|site-content)[^"]*"[\s\S]*?<\/div>/i);
  if (m) t = m[0];
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

async function main() {
  console.log('=== Sanctions supplement scraper ===\n');

  console.log('FLHSMV pages...');
  for (const page of FLHSMV_PAGES) {
    try {
      const html = await fetchText(page.url);
      const text = htmlToText(html);
      if (text.length < 200) {
        console.warn(`  skip ${page.slug} (body too short)`);
        continue;
      }
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: `flhsmv-pages/${page.slug}.txt`,
        Body: `Title: ${page.slug.replace(/--/g, ' / ')}\nSource: ${page.url}\n---\n\n${text}`,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: { 'source-url': page.url, slug: page.slug },
      }));
      console.log(`  ok   ${page.slug}`);
    } catch (err) {
      console.warn(`  fail ${page.slug}: ${(err as Error).message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\nFlorida Statutes...');
  for (const s of STATUTES) {
    const url = `https://www.flsenate.gov/Laws/Statutes/2024/${s.chapter}.${s.section}`;
    const key = `flhsmv-statutes/${s.chapter}-${s.section.replace('.', '-')}.txt`;
    try {
      const html = await fetchText(url);
      const text = htmlToText(html);
      if (text.length < 200) {
        console.warn(`  skip §${s.chapter}.${s.section} (empty)`);
        continue;
      }
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: `Title: Florida Statutes §${s.chapter}.${s.section}\nSource: ${url}\n---\n\n${text}`,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: { 'source-url': url, statute: `${s.chapter}.${s.section}` },
      }));
      console.log(`  ok   §${s.chapter}.${s.section}`);
    } catch (err) {
      console.warn(`  fail §${s.chapter}.${s.section}: ${(err as Error).message}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('\n=== Done ===');
  console.log('Next step — trigger Bedrock KB ingestion:');
  console.log('  aws bedrock-agent start-ingestion-job \\');
  console.log('    --knowledge-base-id DREJTMKWRM \\');
  console.log('    --data-source-id   UHCEFZRCSW');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
