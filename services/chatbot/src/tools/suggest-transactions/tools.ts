/**
 * Life-event cluster matcher.
 *
 * RULE OF THE FILE:
 * Clusters fall into three buckets:
 *   1. Specific clusters (e.g., commercial-driving) — match clear language,
 *      route directly.
 *   2. Disambiguators (id ending in "-ambiguous") — match broad language
 *      that could split into multiple paths. They have an empty txnTypeIds
 *      and `requiresClarification: true`. The handler returns a
 *      clarification question + child options; the prompt forces the bot
 *      to ASK before confirming.
 *   3. Children of disambiguators (e.g., vehicle-purchase-new-dealer) —
 *      match TIGHTER language and route directly.
 *
 * When adding a new cluster, ask: "could this customer's words plausibly
 * mean two different transactions?" If yes, build a disambiguator + two
 * children. The cost of one extra question is much lower than the cost
 * of routing to the wrong tree.
 */

/**
 * suggest_transactions tool.
 *
 * Replaces the flat `search_transactions` first-turn flow. Given the
 * customer's description, returns candidate transactions grouped by
 * life-event cluster so Claude can present a multi-select for the
 * relevant cluster (e.g., "I just moved here" → new-resident cluster).
 *
 * Clusters are defined locally so the first-turn UX does not depend on
 * authoring work in the transaction catalog. Transaction metadata is
 * read from DynamoDB the same way as identify-transaction/tools.ts
 * (keywords + commonPhrases + summary).
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session, TransactionType, TransactionTypeMetadata } from "@st-lucie/shared-types";
const DEFAULT_METADATA: TransactionTypeMetadata = {
  summary: "",
  keywords: [],
  commonPhrases: [],
  requiredDocumentSummary: "",
  requiredDocuments: [],
  onlineEligible: false,
  relatedTransactionIds: [],
  relatedPrompts: {},
  notes: "",
};

function parseDescriptionJson(raw: string | null): TransactionTypeMetadata {
  if (!raw) return DEFAULT_METADATA;
  try {
    return { ...DEFAULT_METADATA, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_METADATA, summary: raw };
  }
}

export interface LifeEventCluster {
  id: string;
  label: string;
  triggerPatterns: RegExp[];
  txnTypeIds: string[];
  rationale: string;
  /**
   * When true, the customer's wording matched a cluster but the cluster
   * itself represents an ambiguous category. The bot MUST present the
   * options to the customer and wait for them to pick before calling
   * confirm_selections. The prompt enforces this; this flag is the
   * machine-readable signal.
   */
  requiresClarification?: boolean;
}

export const LIFE_EVENT_CLUSTERS: LifeEventCluster[] = [
  {
    id: "new-resident",
    label: "New Florida resident",
    triggerPatterns: [
      /\b(just )?moved (here|to (florida|fl))\b/i,
      /\bnew (to |in )?(florida|fl|resident)\b/i,
      /\brelocat(ed|ing)\b/i,
      /\bnew resident\b/i,
    ],
    txnTypeIds: ["dl-transfer", "vehicle-title-transfer", "vehicle-registration"],
    rationale:
      "New Florida residents typically need a DL transfer within 30 days plus title + registration transfer for any vehicles they brought with them.",
  },
  {
    // TIGHT CHILD of 'new-resident' (not a disambiguator — it has txnTypeIds and
    // no requiresClarification). Fires ONLY when a relocation cue AND a
    // commercial cue co-occur, so a plain Class E new resident never matches it.
    // When it co-fires with the parent, the handler strips dl-transfer from the
    // parent and drops the redundant standalone 'commercial-driving' cluster, so
    // a commercial new resident routes to the cdl tree (cdl_origin=oos-transfer),
    // never silently to Class E dl-transfer. CDL is a standalone credential.
    id: "new-resident-commercial",
    label: "New Florida resident transferring a commercial (CDL) license",
    triggerPatterns: [
      /\b((just )?moved (here|to (florida|fl))|relocat(ed|ing)|new (florida|fl) resident|new resident)\b.*\b(cdl|commercial (driver'?s?|licen[sc]e)|class [ab]\b|semi\b|tractor.?trailer|big rig|truck.?driv)/i,
      /\b(cdl|commercial (driver'?s?|licen[sc]e)|class [ab]\b|semi\b|tractor.?trailer|big rig|truck.?driv)\b.*\b((just )?moved (here|to (florida|fl))|relocat(ed|ing)|new (florida|fl) resident|new resident)\b/i,
    ],
    txnTypeIds: ["cdl", "vehicle-title-transfer", "vehicle-registration"],
    rationale:
      "A new Florida resident transferring an out-of-state COMMERCIAL license is an out-of-state CDL transfer (cdl tree, cdl_origin=oos-transfer), NOT a Class E dl-transfer. CDL is a standalone credential with its own medical-certificate and federal vision standards, so substitute cdl for dl-transfer; vehicles they brought still need title + registration transfer.",
  },
  {
    id: "vehicle-purchase-ambiguous",
    label: "I got a vehicle — which scenario?",
    triggerPatterns: [
      /\bI (just )?(bought|purchased|got) (a|an|my)( [a-z-]+)? (car|truck|vehicle|motorcycle|suv)\b/i,
      /\bgifted (a|me)( [a-z-]+)? (car|truck|vehicle)\b/i,
      /\binherited (a|my)( [a-z-]+)? (car|truck|vehicle)\b/i,
      /\bput (the|my) (car|truck|vehicle) in my name\b/i,
    ],
    // Empty txn list — this cluster's purpose is to fork into the two below.
    // The bot must ask the clarification question.
    txnTypeIds: [],
    rationale:
      "Vehicle acquisitions follow different paths depending on whether the customer is a new dealer purchase (MCO + first title) or a private-party / gift / inherited transfer (existing title + transfer). The first-step transaction differs; ALWAYS ask the customer which scenario applies.",
    requiresClarification: true,
  },
  {
    id: "vehicle-purchase-new-dealer",
    label: "I bought a new car from a dealer",
    triggerPatterns: [
      /\b(bought|purchased|got|buying) (a |my )?new\s+(car|truck|vehicle|suv|motorcycle)\b.*\b(dealer|dealership|lot)\b/i,
      /\bnew\s+(car|truck|vehicle|suv|motorcycle)\b.*\b(dealer|dealership|lot)\b/i,
      /\b(dealer|dealership) (purchase|sale)\b/i,
      /\bMCO\b/,
      /\bmanufacturer'?s?\s+certificate\s+of\s+origin\b/i,
    ],
    txnTypeIds: ["new-vehicle-title", "vehicle-registration"],
    rationale:
      "New dealer-purchase customers receive a Manufacturer Certificate of Origin (no prior title exists); use the new-vehicle-title flow rather than vehicle-title-transfer.",
  },
  {
    id: "vehicle-purchase-used-private",
    label: "I got a used vehicle (private party / gift / inheritance)",
    triggerPatterns: [
      /\b(bought|purchased|got|buying) (a |my )?used\s+(car|truck|vehicle|suv|motorcycle)\b/i,
      /\bprivate (sale|seller|party)\b/i,
      /\bgifted (a|me)\b/i,
      /\binherited (a|my|the)\b/i,
      /\bput (the|my) (car|truck|vehicle) in my name\b/i,
      /\btransfer (the|my) title\b/i,
    ],
    txnTypeIds: ["vehicle-title-transfer", "vehicle-registration"],
    rationale:
      "Used or private-party purchases (gift, inheritance, family transfer) start with vehicle-title-transfer to put the existing title in the customer's name.",
  },
  {
    id: "trailer-registration",
    label: "Register a trailer",
    triggerPatterns: [
      /\b(register|registering|registration) (a |my |this |that |our )?(homemade|diy|home-?built|shop-?built|utility|motorcycle|cargo|boat|car-?hauler)( [a-z-]+)? trailer\b/i,
      /\b(register|registering|registration) (a |my |this |that |our )?trailer\b/i,
      /\b(homemade|diy|home-?built|shop-?built|utility|motorcycle|cargo|boat|car-?hauler) trailer\b/i,
      /\bI (just )?(built|welded|made|assembled)( together)? (a|my|this)( [a-z-]+)? trailer\b/i,
      /\btrailer (I built|I made|I welded together)\b/i,
    ],
    txnTypeIds: ["trailer-registration"],
    rationale:
      "Trailers — homemade or manufactured, any weight — go through the trailer-registration tree. The 2,000-lb cutoff is decided by the certified weight slip; sub-2,000-lb trailers are registration-only.",
  },
  {
    id: "license-maintenance",
    label: "Driver license renewal / update",
    triggerPatterns: [
      /\b(renew|renewal|renewing) (my )?(license|dl|id)\b/i,
      /\b(license|dl) (is )?expir(ed|ing)\b/i,
      /\b(change|update) (my )?(address|name) on (my )?(license|dl|id)\b/i,
      /\bgot married\b/i,
      /\breal id\b/i,
    ],
    txnTypeIds: ["dl-renewal", "dl-address-change", "dl-name-change", "real-id-upgrade"],
    rationale:
      "License renewals, name / address changes, and REAL ID upgrades share identity + residency docs and are often batched in one visit.",
  },
  {
    id: "commercial-driving",
    label: "Commercial driving (CDL)",
    triggerPatterns: [
      /\bCDL\b/,
      /\bcommercial (driver|license)\b/i,
      /\bhazmat\b/i,
      /\bdrive (a )?truck( commercially)?\b/i,
      /\bschool bus\b/i,
    ],
    txnTypeIds: ["cdl"],
    rationale:
      "CDL applicants have distinct residency, medical-certificate, and testing requirements — keep this cluster separate from Class E work.",
  },
  {
    id: "business-setup",
    label: "Start or run a business in St. Lucie County",
    triggerPatterns: [
      /\b(start|starting|open|opening|run(ning)?) (a |my )?(business|company|shop|store)\b/i,
      /\bnew business\b/i,
      /\b(business|occupational) (license|tax( receipt)?)\b/i,
      /\bBTR\b/,
      /\bself.?employed\b/i,
      /\b(short.?term|vacation) rental\b/i,
      /\b(airbnb|vrbo)\b/i,
      /\btourist (development )?tax\b/i,
      /\bTDT\b/,
    ],
    txnTypeIds: [
      "business-tax-receipt",
      "tourist-development-tax",
      "tangible-personal-property-tax",
    ],
    rationale:
      "New business owners in St. Lucie County typically need a Local Business Tax Receipt; short-term rental operators also need Tourist Development Tax registration; anyone with business equipment as of January 1 must file a Tangible Personal Property return.",
  },
  {
    id: "property-owner",
    label: "I own property in St. Lucie County",
    triggerPatterns: [
      /\b(pay(ing)?|owe) (my )?property tax(es)?\b/i,
      /\bproperty tax bill\b/i,
      /\btax (bill|certificate|deed)\b/i,
      /\bdelinquent (tax|property)\b/i,
      /\b(just )?(bought|purchased) (a )?(house|home|property)\b/i,
      /\bnew homeowner\b/i,
      /\btangible personal property\b/i,
      /\bTPP\b/,
      /\bgot a (tpp|tangible) bill\b/i,
      /\bDR.?405\b/i,
      /\bbusiness equipment tax\b/i,
    ],
    txnTypeIds: ["property-tax", "tangible-personal-property-tax"],
    rationale:
      "Property owners pay real-property tax annually; owners with business equipment on the property (rental furnishings, etc.) also file a Tangible Personal Property return.",
  },
  {
    id: "outdoors-recreation",
    label: "Outdoor recreation — boating, hunting, fishing",
    triggerPatterns: [
      /\b(hunt|hunting|fish|fishing) (license|permit)\b/i,
      /\b(got|bought|buying|buy) (a )?(boat|vessel)\b/i,
      /\b(register|registering) (my |a )?(boat|vessel)\b/i,
      /\bsaltwater\b/i,
      /\bfreshwater fish\b/i,
      /\bFWC\b/,
      /\bmyfwc\b/i,
    ],
    txnTypeIds: ["hunting-fishing", "vessel-registration"],
    rationale:
      "FWC recreational licenses and Florida vessel registrations are commonly handled in the same visit; boat owners frequently also hold fishing licenses.",
  },
  {
    id: "new-driver",
    label: "First-time driver or teen getting started",
    triggerPatterns: [
      /\b(first.?time|new|brand.?new) driver\b/i,
      /\b(my |his |her )?teen(ager)? (is )?(driving|getting a (license|permit))\b/i,
      /\blearner'?s? permit\b/i,
      /\bwritten (test|exam|knowledge test)\b/i,
      /\bdrug and alcohol (traffic |awareness )?(course|education)?\b/i,
      /\bTLSAE\b/,
      /\bDETS\b/,
      /\b(taking|schedule|book) (the |my )?(road|driving) test\b/i,
    ],
    txnTypeIds: ["learner-permit", "written-test", "road-test", "id-card"],
    rationale:
      "First-time drivers progress through the written test, learner permit, and road test; many teens hold an ID card before they have a DL.",
  },
  {
    id: "lost-replace",
    label: "Lost, stolen, or damaged credentials",
    triggerPatterns: [
      /\b(lost|stole|stolen|damaged|can'?t find) (my )?(license|ID|tag|plate|decal|title|registration)\b/i,
      /\breplace(ment)? (my )?(license|ID|tag|plate|decal|title)\b/i,
      /\bduplicate (title|license)\b/i,
      /\bmissing (my )?(title|license|plate)\b/i,
    ],
    txnTypeIds: ["dl-replacement", "duplicate-title", "tag-replacement"],
    rationale:
      'Replacement flows share a common "lost/stolen" framing but differ by credential (DL vs title vs plate); offering all three keeps the customer from re-stating the problem.',
  },
  {
    id: "sell-vehicle",
    label: "Selling or disposing of a vehicle",
    triggerPatterns: [
      /\b(sold|selling|sell) (my )?(car|truck|vehicle|motorcycle)\b/i,
      /\b(surrender|return|turn in|cancel) (my )?(plate|tag|registration)\b/i,
      /\b(totaled|junk|scrap(ped)?) (my |a )?(car|vehicle)\b/i,
      /\b(repo|repossessed)\b/i,
      /\bmove(d|ing) out of (state|florida|fl)\b/i,
    ],
    txnTypeIds: ["plate-surrender", "vehicle-title-transfer"],
    rationale:
      "Selling a vehicle typically pairs title transfer (new owner) with plate surrender (old owner keeps the plate in FL); also applies to out-of-state moves.",
  },
  {
    id: "mobile-home",
    label: "Mobile home owner",
    triggerPatterns: [
      /\bmobile home\b/i,
      /\bmanufactured home\b/i,
      /\bMH (title|decal|registration)\b/i,
      /\bretire (a |my )?mobile home (title)?\b/i,
      /\bconvert mobile home to (real property|deed|land)\b/i,
    ],
    txnTypeIds: ["mobile-home-title", "mobile-home-retire"],
    rationale:
      "Mobile-home owners may title/register a unit or retire an existing title when the home is permanently affixed to owned land; both workflows share identity + proof-of-ownership docs.",
  },
  {
    id: "dealer-dropoff",
    label: "Licensed dealer / runner dropping off paperwork",
    triggerPatterns: [
      /\b(I'?m |we'?re )?(a |the )?dealer\b.*\b(drop(ping)? off|titles?|paperwork|bundle)\b/i,
      /\b(drop(ping)? off|delivering) (a )?(batch|bundle|stack|several|multiple) (of )?titles\b/i,
      /\bdealer (title )?(drop[- ]?off|reassignment|relinquish)\b/i,
      /\bdealer runner\b/i,
      /\b(franchise|independent) dealer\b.*\b(titles|paperwork)\b/i,
      /\bclosing (the |my )?dealership\b/i,
      /\b(temp|temporary)[- ]plate stock\b/i,
      /\b(82091|83090|82012|86060)\b/i,
    ],
    txnTypeIds: ["dealer-title-dropoff"],
    rationale:
      "Dealer drop-offs are a niche but distinct workflow — dealers bring batches of titles for processing rather than walk-in owner transactions. Keep this cluster separate so the bot does not confuse dealer paperwork with regular vehicle-title-transfer.",
  },
];

let cachedTypes: TransactionType[] | null = null;

async function loadTransactionTypes(): Promise<TransactionType[]> {
  if (cachedTypes) return cachedTypes;

  const { getPool } = await import("@st-lucie/data-access");
  const pool = getPool();
  const result = await pool.query<{
    txn_type_id: string;
    name: string;
    description: string | null;
    avg_duration_min: number;
    available_from: string | null;
    available_until: string | null;
    status: string;
  }>(
    `SELECT txn_type_id, name, description, avg_duration_min, available_from, available_until, status
     FROM transaction_types
     WHERE office_id IS NULL
     ORDER BY name`,
  );

  cachedTypes = result.rows.map((row) => ({
    txnTypeId: row.txn_type_id,
    name: row.name,
    description: parseDescriptionJson(row.description),
    averageDurationMinutes: row.avg_duration_min,
    serviceHours:
      row.available_from && row.available_until
        ? { start: row.available_from, end: row.available_until }
        : undefined,
    status: row.status as TransactionType["status"],
  }));

  return cachedTypes;
}

export const suggestTransactionsTools: Tool[] = [
  {
    toolSpec: {
      name: "suggest_transactions",
      description:
        "Suggest candidate transactions for the customer's description. Returns either one or more life-event CLUSTERS (each with its own transaction list) or individual direct matches when the description is specific. " +
        "Use this INSTEAD of search_transactions as the default first-turn suggester. When a cluster matches, present the cluster to the customer as a multi-select so they can pick which items apply.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            description: {
              type: "string",
              description: "The customer's description of what they need.",
            },
          },
          required: ["description"],
        },
      },
    },
  },
];

interface SuggestionResult {
  content: ToolResultContentBlock[];
  [key: string]: unknown;
}

export async function handleSuggestTransactionsTool(
  toolName: string,
  input: Record<string, unknown>,
  session?: Session,
): Promise<SuggestionResult> {
  if (toolName !== "suggest_transactions") {
    return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }

  const description = String(input.description ?? "").trim();
  if (!description) {
    return {
      content: [
        { text: JSON.stringify({ status: "empty-query", clusters: [], directMatches: [] }) },
      ],
    };
  }

  const types = await loadTransactionTypes();
  const activeById = new Map(
    types.filter((t) => t.status === "active").map((t) => [t.txnTypeId, t] as const),
  );

  // 1) Cluster matching
  const matchedClusters = LIFE_EVENT_CLUSTERS.filter((c) =>
    c.triggerPatterns.some((p) => p.test(description)),
  ).map((c) => ({
    clusterId: c.id,
    label: c.label,
    rationale: c.rationale,
    transactions: c.txnTypeIds
      .map((id) => activeById.get(id))
      .filter((t): t is TransactionType => !!t)
      .map((t) => ({
        txnTypeId: t.txnTypeId,
        name: t.name,
        summary: t.description.summary,
        durationMinutes: t.averageDurationMinutes,
      })),
  }));

  // New-resident commercial de-confliction. When the commercial child
  // ('new-resident-commercial') fired alongside the Class E parent
  // ('new-resident'), the customer is transferring a CDL, not a Class E
  // license. (1) Strip dl-transfer from the parent so we never route a
  // commercial holder to the Class E tree (the child carries 'cdl').
  // (2) The standalone 'commercial-driving' cluster (txnTypeIds=['cdl']) also
  // fires on the word "CDL"/"commercial license"; it is fully subsumed by the
  // child here, so drop it to keep the multi-select to two clean clusters.
  // matchedClusters[*].transactions are freshly built per request (the .map
  // above), so mutating/splicing here never touches module-level
  // LIFE_EVENT_CLUSTERS. Net surviving sets for a commercial mover:
  // new-resident=[vehicle-title-transfer,vehicle-registration],
  // new-resident-commercial=[cdl,vehicle-title-transfer,vehicle-registration].
  const nrCommercial = matchedClusters.some((c) => c.clusterId === "new-resident-commercial");
  if (nrCommercial) {
    const nrParent = matchedClusters.find((c) => c.clusterId === "new-resident");
    if (nrParent) {
      nrParent.transactions = nrParent.transactions.filter((t) => t.txnTypeId !== "dl-transfer");
    }
    const cdIdx = matchedClusters.findIndex((c) => c.clusterId === "commercial-driving");
    if (cdIdx !== -1) matchedClusters.splice(cdIdx, 1);
  }

  // Disambiguation: if the ambiguous parent fired and neither child fired,
  // surface the children as choice options for the bot to ask about — DO
  // NOT confirm anything yet.
  const ambiguous = matchedClusters.find((c) => c.clusterId === "vehicle-purchase-ambiguous");
  const childMatched = matchedClusters.some(
    (c) =>
      c.clusterId === "vehicle-purchase-new-dealer" ||
      c.clusterId === "vehicle-purchase-used-private",
  );
  if (ambiguous && !childMatched) {
    const options = [
      {
        label: "New from a dealer",
        clusterId: "vehicle-purchase-new-dealer",
        txnTypeIds: ["new-vehicle-title", "vehicle-registration"],
      },
      {
        label: "Used from a private party",
        clusterId: "vehicle-purchase-used-private",
        txnTypeIds: ["vehicle-title-transfer", "vehicle-registration"],
      },
      {
        label: "Gift or inheritance",
        clusterId: "vehicle-purchase-used-private",
        txnTypeIds: ["vehicle-title-transfer", "vehicle-registration"],
      },
      {
        label: "Trailer (homemade or purchased)",
        clusterId: "trailer-registration",
        txnTypeIds: ["trailer-registration"],
      },
    ];
    if (session) {
      session.structuredContext.suggestedReplies = options.map((o) => ({
        label: o.label,
        value: o.label,
      }));
    }
    return {
      content: [
        {
          text: JSON.stringify({
            status: "requires-clarification",
            clarification: {
              question:
                "Was this a new vehicle from a dealer, a used vehicle from a private party, or a trailer?",
              options,
            },
            guidance:
              "Present the three options to the customer and wait for their pick. Do NOT call confirm_selections until they choose. Reply with the question and a numbered list.",
            clusters: [],
            directMatches: [],
          }),
        },
      ],
    };
  }

  // 2) Direct keyword / commonPhrase matching (fallback when no cluster fires
  //    or to supplement clusters for specific language like "replace my plate").
  const lcDescription = description.toLowerCase();
  const directMatches = [...activeById.values()]
    .map((t) => {
      let score = 0;
      for (const kw of t.description.keywords ?? []) {
        if (lcDescription.includes(kw.toLowerCase())) score += 2;
      }
      for (const phrase of t.description.commonPhrases ?? []) {
        if (lcDescription.includes(phrase.toLowerCase())) score += 3;
      }
      return { txn: t, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((r) => ({
      txnTypeId: r.txn.txnTypeId,
      name: r.txn.name,
      summary: r.txn.description.summary,
      durationMinutes: r.txn.averageDurationMinutes,
      score: r.score,
    }));

  // Stash the candidate IDs on the session so confirm_selections can fall
  // back to them if the LLM later submits an empty selection list.
  if (session) {
    const stashed: string[] = [];
    for (const c of matchedClusters) for (const t of c.transactions) stashed.push(t.txnTypeId);
    for (const d of directMatches) stashed.push(d.txnTypeId);
    const dedup = Array.from(new Set(stashed));
    if (dedup.length > 0) {
      session.structuredContext.pendingSuggestedTxnIds = dedup;
    }
  }

  // If a single direct match dominates (top-1 score ≥2× top-2, or only one
  // direct match with no clusters firing), encourage immediate confirmation
  // rather than a multi-select. Catches the failure pattern where the LLM
  // shows "Which of these apply?" for a clearly-stated single-service ask.
  const top1 = directMatches[0];
  const top2 = directMatches[1];
  const dominantDirect =
    matchedClusters.length === 0 && top1 && (!top2 || top1.score >= top2.score * 2);

  // Single-cluster auto-confirm: when exactly ONE cluster matched and it
  // contains a small number of tightly-coupled txns (≤2), the customer's
  // language was specific enough that we can confirm everything in the
  // cluster without a multi-select. The customer can drop services later
  // in resolve-facts if they don't apply. Handles "I bought a used car
  // from a private seller" → vehicle-purchase cluster (title + reg) which
  // is ALWAYS the right answer for that phrasing.
  const singleClusterAutoConfirm =
    matchedClusters.length === 1 &&
    matchedClusters[0].transactions.length > 0 &&
    matchedClusters[0].transactions.length <= 2;

  const guidance = dominantDirect
    ? `Single dominant match (${top1.txnTypeId}, score=${top1.score}). The customer's description maps to ONE clear transaction. Confirm immediately via confirm_selections([${top1.txnTypeId}]) and stop — do NOT present a multi-select for a single-service request.`
    : singleClusterAutoConfirm
      ? `Single tight cluster matched (${matchedClusters[0].clusterId}, ${matchedClusters[0].transactions.length} txn). The customer's language maps unambiguously to this small group, and these services almost always go together for the situation described. Confirm ALL cluster members immediately via confirm_selections([${matchedClusters[0].transactions.map((t) => t.txnTypeId).join(", ")}]) — do NOT present a multi-select. If the customer realizes they don't actually need one of them, they can drop it in the next state.`
      : matchedClusters.length > 0
        ? "Present the cluster(s) as a multi-select. Ask the customer which items apply. Do NOT call confirm_selections until the customer picks."
        : directMatches.length > 0
          ? "No cluster match — present these direct matches as candidates and ask the customer to confirm."
          : "No matches. Ask the customer to describe their situation, or suggest calling query_knowledge_base for general inquiries.";

  // Auto-populate suggestedReplies so the frontend renders tappable chips
  // matching whatever the LLM is about to present. Only when there are
  // options to choose from (not auto-confirm cases where the bot skips ahead).
  if (session && !dominantDirect && !singleClusterAutoConfirm) {
    const replies: Array<{ label: string; value: string }> = [];
    for (const c of matchedClusters) {
      for (const t of c.transactions) {
        replies.push({ label: t.name, value: t.name });
      }
    }
    for (const d of directMatches) {
      if (!replies.some((r) => r.label === d.name)) {
        replies.push({ label: d.name, value: d.name });
      }
    }
    if (replies.length > 0) {
      session.structuredContext.suggestedReplies = replies.slice(0, 8);
    }
  }

  return {
    content: [
      {
        text: JSON.stringify({
          status: "ok",
          clusters: matchedClusters,
          directMatches,
          guidance,
        }),
      },
    ],
  };
}
