/**
 * Bedrock Knowledge Base query for general Q&A fallback.
 * built from tcslc.com content. Also used during exception resolution
 * in pre-screening (GAP-2 resolution).
 *
 * Uses Bedrock RetrieveAndGenerate API for managed RAG.
 */

import {
  BedrockAgentRuntimeClient,
  RetrieveAndGenerateCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";

function createClient(): BedrockAgentRuntimeClient {
  const region = process.env.AWS_REGION || "us-east-1";
  // In Lambda, default credential chain works. Locally with SSO profiles, we
  // may need explicit fromSSO(). Detect by checking if running in Lambda.
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return new BedrockAgentRuntimeClient({ region });
  }
  // Local dev: try loading SSO credentials if profile is set
  try {
    // Dynamic import to avoid bundling issues in Lambda
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { fromSSO } = require("@aws-sdk/credential-providers");
    const profile = process.env.AWS_PROFILE;
    return new BedrockAgentRuntimeClient({
      region,
      ...(profile && { credentials: fromSSO({ profile }) }),
    });
  } catch {
    return new BedrockAgentRuntimeClient({ region });
  }
}

let _client: BedrockAgentRuntimeClient | null = null;
function getClient(): BedrockAgentRuntimeClient {
  if (!_client) _client = createClient();
  return _client;
}

const KB_ID = process.env.BEDROCK_KB_ID || "";
const REGION = process.env.AWS_REGION || "us-east-1";
const ACCOUNT_ID = process.env.AWS_ACCOUNT_ID || "522814693903";
// Model ARN for RetrieveAndGenerate — needs inference profile ARN for cross-region models
const rawModelId = process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-6";
const MODEL_ARN = rawModelId.startsWith("us.")
  ? `arn:aws:bedrock:${REGION}:${ACCOUNT_ID}:inference-profile/${rawModelId}`
  : `arn:aws:bedrock:${REGION}::foundation-model/${rawModelId}`;

export interface KBSource {
  title: string;
  /**
   * Optional outbound link. Omitted for sources whose only canonical location
   * is an auth-walled internal system (e.g. the FLHSMV Driver License
   * Operations Manual on SharePoint) — the customer sees the policy code/title
   * as a non-clickable citation instead of a broken link.
   */
  url?: string;
  type: "page" | "pdf";
}

export interface KBQueryResult {
  answer: string;
  sources: KBSource[];
  hasResult: boolean;
}

/**
 * Query the Bedrock Knowledge Base for general Q&A.
 * Returns a generated answer with source citations.
 * Falls back gracefully if KB is not configured.
 */
export async function queryKnowledgeBase(query: string): Promise<KBQueryResult> {
  if (!KB_ID) {
    return {
      answer:
        "I don't have detailed information about that topic right now. For the most up-to-date information, please visit the St. Lucie County Tax Collector's website at tcslc.com or call our office.",
      sources: [],
      hasResult: false,
    };
  }

  try {
    const response = await getClient().send(
      new RetrieveAndGenerateCommand({
        input: { text: query },
        retrieveAndGenerateConfiguration: {
          type: "KNOWLEDGE_BASE",
          knowledgeBaseConfiguration: {
            knowledgeBaseId: KB_ID,
            modelArn: MODEL_ARN,
            retrievalConfiguration: {
              vectorSearchConfiguration: {
                numberOfResults: 5,
              },
            },
          },
        },
      }),
    );

    const answer = response.output?.text || "";
    const citations = response.citations || [];

    // Extract unique sources and map S3 URIs to tcslc.com URLs.
    // Dedupe by URL when present; otherwise by title (ops-manual codes are
    // unique per section, so title dedupe is safe for urlless entries).
    const seen = new Set<string>();
    const sources: KBSource[] = [];

    for (const citation of citations) {
      for (const ref of citation.retrievedReferences || []) {
        const s3Uri = ref.location?.s3Location?.uri || "";
        const mapped = mapS3ToSource(s3Uri);
        if (!mapped) continue;
        const dedupeKey = mapped.url ?? `title:${mapped.title}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        sources.push(mapped);
      }
    }

    return {
      answer:
        answer ||
        "I couldn't find specific information about that. Please visit tcslc.com or contact our office.",
      sources,
      hasResult: !!answer,
    };
  } catch (err) {
    console.error("Knowledge Base query failed:", err);
    return {
      answer:
        "I'm having trouble looking that up right now. For the most current information, please visit tcslc.com or call the St. Lucie County Tax Collector's office.",
      sources: [],
      hasResult: false,
    };
  }
}

/**
 * Map an S3 URI from the KB to a human-readable source link.
 *
 * S3 keys follow these patterns:
 *   tcslc/www-tcslc-com-196-Contact-Us.txt                 → https://www.tcslc.com/196/Contact-Us
 *   tcslc-docs/477-What-are-the-fees-...pdf                → https://www.tcslc.com/DocumentCenter/View/477
 *   flhsmv-forms/82040.pdf                                 → https://www.flhsmv.gov/pdf/forms/82040.pdf
 *   flhsmv-pages/driver-licenses-id-cards.txt              → https://www.flhsmv.gov/driver-licenses-id-cards/
 *   flhsmv-statutes/322-21.txt                             → https://www.flsenate.gov/Laws/Statutes/2024/322.21
 */
/**
 * tcslc DocumentCenter IDs whose PDFs are still retrieved from our KB but whose
 * live URLs now 404. Each entry redirects the citation to a live authoritative
 * replacement so the customer doesn't click a broken link.
 *
 * Audit (2026-04-28): 25 of 172 stored tcslc PDFs have dead DocumentCenter
 * URLs. See /tmp/redirect-plan.txt for the rationale per entry. Regenerate by
 * running the cross-reference script in scripts/audit-tcslc-docs.ts.
 */
const DEAD_TCSLC_DOC_REDIRECTS: Record<
  string,
  { title: string; url: string; type: "page" | "pdf" }
> = {
  "180": {
    title: "Delinquent Property Taxes (tcslc)",
    url: "https://www.tcslc.com/205/Delinquent-Property-Taxes",
    type: "page",
  },
  "201": {
    title: "Delinquent Property Taxes (tcslc)",
    url: "https://www.tcslc.com/205/Delinquent-Property-Taxes",
    type: "page",
  },
  "203": {
    title: "Delinquent Property Taxes (tcslc)",
    url: "https://www.tcslc.com/205/Delinquent-Property-Taxes",
    type: "page",
  },
  "206": {
    title: "Delinquent Property Taxes (tcslc)",
    url: "https://www.tcslc.com/205/Delinquent-Property-Taxes",
    type: "page",
  },
  "207": {
    title: "IRS Form W-9 (authoritative)",
    url: "https://www.irs.gov/pub/irs-pdf/fw9.pdf",
    type: "pdf",
  },
  "208": {
    title: "Property Tax Deed Application (tcslc)",
    url: "https://www.tcslc.com/208/Property-Tax-Deed-Application",
    type: "page",
  },
  "497": {
    title: "Tourist Development Tax (tcslc)",
    url: "https://www.tcslc.com/233/Tourist-Development",
    type: "page",
  },
  "501": {
    title: "Tourist Development Tax (tcslc)",
    url: "https://www.tcslc.com/233/Tourist-Development",
    type: "page",
  },
  "535": {
    title: "Local Business Tax (tcslc)",
    url: "https://www.tcslc.com/227/Local-Business-Tax",
    type: "page",
  },
  "563": {
    title: "Local Business Tax (tcslc)",
    url: "https://www.tcslc.com/227/Local-Business-Tax",
    type: "page",
  },
  "575": {
    title: "Local Business Tax (tcslc)",
    url: "https://www.tcslc.com/227/Local-Business-Tax",
    type: "page",
  },
  "576": {
    title: "Local Business Tax (tcslc)",
    url: "https://www.tcslc.com/227/Local-Business-Tax",
    type: "page",
  },
  "577": {
    title: "Local Business Tax (tcslc)",
    url: "https://www.tcslc.com/227/Local-Business-Tax",
    type: "page",
  },
  "578": {
    title: "Local Business Tax (tcslc)",
    url: "https://www.tcslc.com/227/Local-Business-Tax",
    type: "page",
  },
  "579": {
    title: "Dealers Corner (tcslc)",
    url: "https://www.tcslc.com/216/Dealers-Corner",
    type: "page",
  },
  "581": {
    title: "Dealers Corner (tcslc)",
    url: "https://www.tcslc.com/216/Dealers-Corner",
    type: "page",
  },
  "700": {
    title: "Dealers Corner (tcslc)",
    url: "https://www.tcslc.com/216/Dealers-Corner",
    type: "page",
  },
  "740": {
    title: "FWC Commercial Saltwater Products License",
    url: "https://myfwc.com/license/saltwater/commercial/",
    type: "page",
  },
  "741": {
    title: "FWC Commercial Saltwater Products License",
    url: "https://myfwc.com/license/saltwater/commercial/",
    type: "page",
  },
  "742": {
    title: "FWC Wildlife License",
    url: "https://myfwc.com/license/wildlife/",
    type: "page",
  },
  "977": {
    title: "FLHSMV Form 83039 (Disabled Person Parking Permit)",
    url: "https://www.flhsmv.gov/pdf/forms/83039.pdf",
    type: "pdf",
  },
  "992": {
    title: "About the St. Lucie County Tax Collector",
    url: "https://www.tcslc.com/35/About-Us",
    type: "page",
  },
  "1078": {
    title: "Contact the St. Lucie County Tax Collector",
    url: "https://www.tcslc.com/196/Contact-Us",
    type: "page",
  },
  "1095": { title: "St. Lucie County Tax Collector", url: "https://www.tcslc.com/", type: "page" },
  "1125": {
    title: "FLHSMV Form 83146 (Lost/Stolen Plate)",
    url: "https://www.flhsmv.gov/pdf/forms/83146.pdf",
    type: "pdf",
  },
};

/**
 * tcslc topic pages that moved or were retired. Keeps KB content retrievable
 * but redirects the clickable citation to the live parent page.
 */
const DEAD_TCSLC_PAGE_REDIRECTS: Record<string, { title: string; url: string; type: "page" }> = {
  "1019": { title: "Taxes (tcslc)", url: "https://www.tcslc.com/165/Taxes", type: "page" },
  "1117": { title: "Taxes (tcslc)", url: "https://www.tcslc.com/165/Taxes", type: "page" },
};

export function mapS3ToSource(s3Uri: string): KBSource | null {
  if (!s3Uri) return null;

  // Extract the key from s3://bucket/key
  const keyMatch = s3Uri.match(/s3:\/\/[^/]+\/(.+)/);
  if (!keyMatch) return null;
  const key = keyMatch[1];

  // Pattern 1: tcslc-docs/{docId}-{label}.pdf → DocumentCenter PDF
  const pdfMatch = key.match(/tcslc-docs\/(\d+)-(.+)\.pdf$/);
  if (pdfMatch) {
    const docId = pdfMatch[1];
    // If this ID is in the dead-redirect table, surface the live alternative
    // instead of a 404. Preserves the KB content (we still retrieve/cite the
    // document) but the clickable link goes somewhere real.
    const redirect = DEAD_TCSLC_DOC_REDIRECTS[docId];
    if (redirect) return { ...redirect };
    const label = pdfMatch[2].replace(/-/g, " ");
    return {
      title: label,
      url: `https://www.tcslc.com/DocumentCenter/View/${docId}`,
      type: "pdf",
    };
  }

  // Pattern 2: tcslc/www-tcslc-com-{id}-{slug}.txt → website page
  const pageMatch = key.match(/tcslc\/www-tcslc-com-(\d+)-(.+)\.txt$/);
  if (pageMatch) {
    const pageId = pageMatch[1];
    const slug = pageMatch[2];
    // Known-dead topic pages get redirected to the live equivalent.
    const pageRedirect = DEAD_TCSLC_PAGE_REDIRECTS[pageId];
    if (pageRedirect) return { ...pageRedirect };
    return {
      title: slug.replace(/-/g, " "),
      url: `https://www.tcslc.com/${pageId}/${slug}`,
      type: "page",
    };
  }

  // Pattern 3: other tcslc/ files
  const otherTcslcMatch = key.match(/tcslc\/(.+)\.txt$/);
  if (otherTcslcMatch) {
    const name = otherTcslcMatch[1].replace(/www-tcslc-com-/, "").replace(/-/g, " ");
    return {
      title: name,
      url: "https://www.tcslc.com",
      type: "page",
    };
  }

  // Pattern 4: flhsmv-forms/{formNumber}.pdf → official HSMV form PDF
  const flhsmvFormMatch = key.match(/flhsmv-forms\/([0-9a-zA-Z_-]+)\.pdf$/);
  if (flhsmvFormMatch) {
    const formNumber = flhsmvFormMatch[1];
    return {
      title: `FLHSMV Form ${formNumber}`,
      url: `https://www.flhsmv.gov/pdf/forms/${formNumber}.pdf`,
      type: "pdf",
    };
  }

  // Pattern 5: flhsmv-pages/{slug}.txt → procedure/manual page on flhsmv.gov
  const flhsmvPageMatch = key.match(/flhsmv-pages\/(.+)\.txt$/);
  if (flhsmvPageMatch) {
    const slug = flhsmvPageMatch[1];
    return {
      title: `FLHSMV: ${slug.replace(/-/g, " ")}`,
      url: `https://www.flhsmv.gov/${slug.replace(/--/g, "/")}/`,
      type: "page",
    };
  }

  // Pattern 6: flhsmv-statutes/{chapter}-{section}.txt → Florida Statutes
  const statuteMatch = key.match(/flhsmv-statutes\/(\d+)-(\d+)(?:\.(\d+))?\.txt$/);
  if (statuteMatch) {
    const chapter = statuteMatch[1];
    const section = statuteMatch[2] + (statuteMatch[3] ? `.${statuteMatch[3]}` : "");
    return {
      title: `Florida Statutes §${chapter}.${section}`,
      url: `https://www.flsenate.gov/Laws/Statutes/2024/${chapter}.${section}`,
      type: "page",
    };
  }

  // Pattern 7: fdacs-pages/{slug}.txt → FDACS Concealed Weapon License pages.
  // Slug encodes the path segments joined with dashes; we reconstruct the
  // canonical URL by re-joining on slashes after the trailing segment.
  const fdacsPageMatch = key.match(/fdacs-pages\/(.+)\.txt$/);
  if (fdacsPageMatch) {
    const slug = fdacsPageMatch[1];
    // Slugs like 'Applying-for-a-Concealed-Weapon-License-Eligibility-Requirements'
    // map back to the FDACS path. For the top-level 'home' slug, link to the
    // CCW landing page.
    const url =
      slug === "home"
        ? "https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License"
        : `https://www.fdacs.gov/Consumer-Resources/Concealed-Weapon-License/${slug}`;
    return {
      title: `FDACS: ${slug.replace(/-/g, " ")}`,
      url,
      type: "page",
    };
  }

  // Pattern 8: fdacs-forms/{slug}.pdf → FDACS CCW PDFs (instructions, application)
  const fdacsFormMatch = key.match(/fdacs-forms\/(.+)\.pdf$/);
  if (fdacsFormMatch) {
    const slug = fdacsFormMatch[1];
    return {
      title: `FDACS Form: ${slug.replace(/-/g, " ")}`,
      url: `https://www.fdacs.gov/content/download/${slug}.pdf`,
      type: "pdf",
    };
  }

  // Pattern 9: fwc-pages/{slug}.txt → FWC recreational license pages
  const fwcPageMatch = key.match(/fwc-pages\/(.+)\.txt$/);
  if (fwcPageMatch) {
    const slug = fwcPageMatch[1];
    const url =
      slug === "home"
        ? "https://myfwc.com/license/recreational/"
        : `https://myfwc.com/${slug.replace(/-/g, "/")}/`;
    return {
      title: `FWC: ${slug.replace(/-/g, " ")}`,
      url,
      type: "page",
    };
  }

  // Pattern 10: flhsmv-ops-manual/{CODE}__{sectionPath}[__pN][__dupN].txt →
  // section-scoped FLHSMV Driver License Operations Manual chunk.
  //
  // Key shapes we accept:
  //   flhsmv-ops-manual/CI06__10_6.txt             -> CI06 §10.6
  //   flhsmv-ops-manual/CI06__10_6__p2.txt         -> CI06 §10.6 (piece 3 of N)
  //   flhsmv-ops-manual/CI06__preamble.txt         -> CI06 preamble
  //   flhsmv-ops-manual/CI06.txt                   -> legacy whole-doc key (fallback)
  const opsManualMatch = key.match(/flhsmv-ops-manual\/(.+)\.txt$/);
  if (opsManualMatch) {
    const raw = opsManualMatch[1];
    const parsed = parseOpsManualKey(raw);
    const entry = getOpsManualEntry(parsed.code);
    const base = entry?.title ?? `FLHSMV Operations Manual: ${parsed.code}`;
    const title = parsed.sectionLabel ? `${base} §${parsed.sectionLabel}` : base;
    // The ops manual lives on an auth-walled SharePoint that customers can't
    // access. Cite by code/section name only — no URL, no broken link.
    return { title, type: "pdf" };
  }

  return null;
}

interface ParsedOpsManualKey {
  code: string; // doc code, e.g. "CI06"
  sectionLabel: string | null; // "10.6", "preamble", or null if whole-doc key
  splitIndex: number | null; // piece index if section was paragraph-split
}

/**
 * Parse a {CODE}__{sectionPath}[__pN][__dupN] key into its components.
 *
 * Section paths use underscores in place of dots (S3 key safety):
 *   "CI06__10_6__p2" -> code=CI06, sectionLabel="10.6", splitIndex=2
 *   "CI06"           -> code=CI06, sectionLabel=null, splitIndex=null
 */
export function parseOpsManualKey(raw: string): ParsedOpsManualKey {
  const parts = raw.split("__");
  const code = parts[0];
  if (parts.length === 1) {
    return { code, sectionLabel: null, splitIndex: null };
  }
  const section: string | null = parts[1] ?? null;
  let splitIndex: number | null = null;
  for (let i = 2; i < parts.length; i++) {
    const p = parts[i];
    const pMatch = p.match(/^p(\d+)$/);
    if (pMatch) {
      splitIndex = Number(pMatch[1]);
      continue;
    }
    // Ignore duplicate-disambiguation suffixes ("dup1", "dup2")
    if (/^dup\d+$/.test(p)) continue;
  }
  // "10_6" -> "10.6"; "preamble" -> "preamble"
  const sectionLabel = section ? section.replace(/_/g, ".") : null;
  return { code, sectionLabel, splitIndex };
}

// Lazy-load the Claude-generated ops-manual index. The file ships with the
// service (it's committed at services/chatbot/src/data/flhsmv-ops-manual-index.json)
// so we resolve it relative to this module at cold start.
interface OpsManualEntry {
  code: string;
  title: string;
  sourceUrl: string;
}

let opsManualCache: Map<string, OpsManualEntry> | null = null;

function getOpsManualEntry(code: string): OpsManualEntry | null {
  if (!opsManualCache) {
    opsManualCache = new Map();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require("node:path");
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require("node:fs");
      const indexPath = path.resolve(__dirname, "..", "data", "flhsmv-ops-manual-index.json");
      if (fs.existsSync(indexPath)) {
        const idx = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
        for (const entry of idx.entries ?? []) {
          opsManualCache.set(entry.code, {
            code: entry.code,
            title: entry.title,
            sourceUrl: entry.sourceUrl,
          });
        }
      }
    } catch {
      // Cache stays empty; fallback pattern in caller handles the miss.
    }
  }
  return opsManualCache.get(code) ?? null;
}
