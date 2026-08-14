# KB scraper suite (ARCHIVED — reference only)

> ⚠️ **These scripts are OLD.** They were lifted **verbatim** from the original
> prototype (`_ARCHIVED_st-lucie-chatbot`) and are **not maintained** to this
> repo's lint/type/format bar (that's why `scripts/kb/` is ignored by ESLint and
> Prettier). They are St.-Lucie- and Florida-specific, and their account/bucket
> defaults have been scrubbed to placeholders (`<ACCOUNT_ID>`,
> `<vendor-source-bucket>`) that you must set. Treat them as a **worked
> example of how the Knowledge Base corpus was built**, not turnkey tooling.
> Read this whole file before running anything.

## What this is

The Bedrock Knowledge Base ships **empty** on a fresh deploy (see
`infra/DEPLOY.md` §8). These scripts are how the original corpus was assembled:
they fetch public content from the Tax Collector + Florida agency sites, convert
it to text/PDF, and upload it to the KB data-source S3 bucket under **specific
key prefixes**. Those prefixes are one half of a contract — the runtime decodes
them back into clickable citations in
`services/chatbot/src/knowledge-base/query.ts` (`mapS3ToSource`). **If you
change a key prefix here, you must change `mapS3ToSource` too, or citations
break.**

## The scripts

| Script | Fetches | Writes to S3 key |
| --- | --- | --- |
| `scrape-kb-content.ts` | tcslc.com pages via `sitemap.xml` + a curated `SUPPLEMENTAL_URLS` list | `tcslc/www-tcslc-com-{id}-{slug}.txt` |
| `scrape-kb-documents.ts` / `scrape-kb-documents-full.ts` | tcslc `/DocumentCenter/View/{id}` PDFs (harvested from page links) | `tcslc-docs/{id}-{slug}.pdf` |
| `scrape-kb-flhsmv.ts` | flhsmv.gov pages/forms + a hardcoded `MANUAL_STATUTES` list from flsenate.gov | `flhsmv-pages/{slug}.txt`, `flhsmv-forms/{n}.pdf`, `flhsmv-statutes/{ch}-{sec}.txt` |
| `scrape-kb-fdacs-fwc.ts` | fdacs.gov (Concealed Weapon License) + myfwc.com | `fdacs-pages/{slug}.txt`, `fdacs-forms/{slug}.pdf`, `fwc-pages/{slug}.txt` |
| `scrape-kb-sanctions-supplement.ts` | 2 FLHSMV sub-pages + 4 sanction/reinstatement statutes for the `dl-sanctions-lift` tree | `flhsmv-pages/…`, `flhsmv-statutes/…` |
| `ingest-flhsmv-ops-manual.ts` | FLHSMV Driver License Operations Manual — **vendor-delivered chunk JSON** (auth-walled; supplied out-of-band, not scraped) | `flhsmv-ops-manual/{CODE}.txt` |
| `build-ops-manual-index.ts` | reads the ingested ops-manual chunks from S3 and uses Bedrock to (re)generate the code→title index | writes `flhsmv-ops-manual-index.json` (already committed at `services/chatbot/src/data/`) |

Method: plain `fetch()` with a `User-Agent`, a regex-based `htmlToText()` (strips
nav/header/footer/script; **no headless browser**), polite `CONCURRENCY`/`DELAY_MS`
throttling, and `@aws-sdk/client-s3` `PutObjectCommand` straight to the bucket.
Each script prints the `aws bedrock-agent start-ingestion-job` command to run
afterward.

## Running them (if you must)

1. **Install the S3 SDK** — it is **not** a dependency of this repo:
   `npm i -D @aws-sdk/client-s3`. (`build-ops-manual-index.ts` also uses
   `@aws-sdk/client-bedrock-runtime`, which is already present.)
2. **Point at the right bucket.** Set `KB_DATA_BUCKET` to the deploy's
   `KbDataBucketName` CloudFormation output. **The scripts default to a
   placeholder bucket** (`st-lucie-kb-data-<ACCOUNT_ID>`) — if you don't
   override it, uploads go nowhere useful.
3. Run a scraper: `KB_DATA_BUCKET=<bucket> AWS_REGION=us-east-1 npx tsx scripts/kb/scrape-kb-content.ts`
   (repeat per source you want).
4. Trigger ingestion (the KB id / data-source id are **not** CFN outputs — look
   them up per `infra/DEPLOY.md` §8), then wait for the job to reach `COMPLETE`.

## Known-stale bits to fix before real use

- **Placeholder account/bucket/profile values** (scrubbed from the original
  account) — the default `KB_DATA_BUCKET=st-lucie-kb-data-<ACCOUNT_ID>`,
  `ingest-flhsmv-ops-manual.ts`'s source `s3://<vendor-source-bucket>/HLSMV/`,
  and the `AWS_PROFILE=AdministratorAccess-<ACCOUNT_ID>` example. Set all of
  these before running.
- **The ops manual is auth-walled** (SharePoint). Its content is supplied
  out-of-band as vendor chunk JSON; these scripts do not (and cannot) scrape it.
  It is cited by code only — no public URL.
- **A different county must rewrite the source lists** (`sitemap.xml` host,
  `SUPPLEMENTAL_URLS`, `MANUAL_STATUTES`, DocumentCenter IDs) **and the
  `mapS3ToSource` patterns** in `services/chatbot/src/knowledge-base/query.ts` —
  everything here is specific to St. Lucie County + Florida state agencies.
- Source-site HTML changes over time; the regex `htmlToText()` and link patterns
  may need updating if a site is redesigned.
