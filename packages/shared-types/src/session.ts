/**
 * Session types for Chatbot Service.
 */

export type ConversationState =
  | "landing"
  | "identify-transaction"
  | "universal-blockers"
  | "verify-identity"
  | "resolve-facts"
  | "confirm-facts"
  | "upload-docs"
  | "pre-screen"
  | "checkout-check"
  | "schedule"
  | "confirm";

export interface IdentityContext {
  name?: string;
  dob?: string;
  address?: string;
  confirmed: boolean;
}

export type TransactionStatus = "active" | "dropped" | "blocked" | "parked" | "escalated";

/**
 * Structured blocker information attached to a transaction when a decision-tree
 * BLOCKED branch matches, or when a universal-blockers check hard-fails.
 * `severity: 'hard'` means the customer should not come in until resolved;
 * `'conditional'` means they may be redirected but can still attempt the visit.
 */
export interface BlockingInfo {
  severity: "hard" | "conditional";
  reason: string;
  customerMessage: string;
  nextSteps?: string;
  sourceRefs?: string[];
  origin: "decision-tree" | "universal-blockers" | "pre-screen";
}

export interface TransactionContext {
  txnTypeId: string;
  name: string;
  durationMinutes: number;
  status: TransactionStatus;
  blockedReason?: string;
  blockingInfo?: BlockingInfo;
}

export interface DocumentContext {
  documentType: string;
  txnTypeId: string;
  status: "pending" | "uploaded" | "validated" | "failed" | "skipped";
  s3Key?: string;
  validationResult?: string;
}

export interface PreScreeningAnswer {
  questionKey: string;
  answer: string;
  blocked: boolean;
  appliedToTxnTypes: string[];
  resolutionStatus?: "resolved" | "dropped" | "parked" | "escalated";
}

export interface PreScreeningContext {
  answers: Record<string, PreScreeningAnswer>;
  completedTxnTypes: string[];
}

export interface SchedulingPreference {
  timeOfDay: "morning" | "afternoon";
  day: string;
  locationId?: string;
  asap: boolean;
}

export interface AvailableSlot {
  slotId: string;
  locationId: string;
  locationName: string;
  date: string;
  startTime: string;
  endTime: string;
  clerkId?: string;
}

export interface SchedulingContext {
  preference?: SchedulingPreference;
  selectedSlot?: AvailableSlot;
  appointmentId?: string;
  qrCodeUrl?: string;
}

export type FactConfidence = "asserted" | "inferred" | "unknown";

export type FactSource = "user-message" | "prescreening" | "ocr" | "inference";

export interface FactValue {
  value: string;
  confidence: FactConfidence;
  source: FactSource;
  updatedAt: string;
}

export type FactScope = "global" | "transaction-specific";

export interface FactDefinition {
  factKey: string;
  label: string;
  valueType: "enum";
  allowedValues: string[];
  questionText: string;
  inferenceHints: string;
  scope: FactScope;
  relevantTransactions: string[];
  /**
   * Customer-facing labels for each enum value. Used as quick-reply chip
   * text AND injected into the resolve-facts system prompt so the bot's
   * prose matches the chip wording verbatim. Optional — when absent, the
   * frontend falls back to a `humanize()` rendering of the raw enum value.
   *
   * Keys must be in `allowedValues`; lint enforces this. Authors only need
   * to provide labels for values where the raw enum is ambiguous to a
   * customer (e.g. "yes"/"no" answering "current-year or past due?"). The
   * `unknown` value is conventionally rendered as "Not sure" and does not
   * need an entry.
   */
  valueLabels?: Record<string, string>;
}

export type ItemBucket = "bring_in" | "optional_upload" | "form";

/**
 * Which printed date on a document a validity rule reads + compares. Also the
 * key set the upload vision screen transcribes into ObservedDates.
 *   issued  — date the document was issued/printed
 *   dated   — the document's own effective date, if distinct from issued
 *   signed  — signature / certification date
 *   expires — printed expiration / valid-through date
 */
export type DocumentDateAnchor = "issued" | "dated" | "signed" | "expires";

/**
 * Dates the upload vision screen transcribed off a document, keyed by anchor.
 * All optional — a field is present only when a legible, well-formed date was
 * reported for that anchor. Observation only; the expiry decision consumes it.
 */
export type ObservedDates = Partial<Record<DocumentDateAnchor, string>>;

/**
 * Machine-readable recency/expiry rule for a document (uploaded copies).
 *   rule 'max-age'   — the `anchor` date must be within `days` of today.
 *   rule 'unexpired' — the printed `expires` date must be today or later.
 * `source` is REQUIRED: every rule must cite an FLHSMV/tcslc/statute basis,
 * mirroring the item `source`/`verified` governance convention. A malformed
 * rule is rejected by `npm run lint:trees`.
 */
/**
 * A content/status/eligibility check on an uploaded document — an attribute the
 * document must SHOW (e.g. a Sunbiz printout showing status "Active", a VA
 * letter stating "100% permanent and total"). Unlike a date rule, this is
 * ADVISORY ONLY: the vision screen judges whether the attribute is present and,
 * if it is clearly missing/wrong, the resident gets a soft warning to
 * self-correct — it NEVER hard-blocks the upload (model judgment is fuzzier than
 * a date compare, so it must not wrongly reject a valid resident).
 */
export interface ContentCheck {
  /** The visually-checkable attribute the document must show. */
  requiredAttribute: string;
  /** Official/tcslc/staff basis for requiring it. */
  source: string;
  /** Optional subtype scoping, same semantics as DocumentValidity.appliesWhen. */
  appliesWhen?: string[];
}

export interface DocumentValidity {
  /** Date rule. Optional — an item may carry only contentChecks and no date rule. */
  rule?: "max-age" | "unexpired";
  anchor?: DocumentDateAnchor;
  /** Required for rule 'max-age'; ignored for 'unexpired'. */
  days?: number;
  /** Required when a date `rule` is present; the date rule's citation. */
  source?: string;
  /**
   * Subtype scoping for MIXED-bucket items (e.g. address proof, whose one slot
   * accepts a 60-day utility bill AND a permanent deed). When present, the date
   * rule only fires if the vision screen's observed document description matches
   * one of these keywords (case-insensitive substring); otherwise the upload is
   * not date-screened (fail-open). Absent → the rule applies to the whole item.
   */
  appliesWhen?: string[];
  /**
   * Advisory content/status checks. Never block; surface a soft warning when the
   * model reports a required attribute is clearly missing/wrong. Independent of
   * the date rule — an item may have contentChecks with no date rule at all.
   */
  contentChecks?: ContentCheck[];
}

export interface CatalogItem {
  itemId: string;
  label: string;
  bucket: ItemBucket;
  source?: string;
  verified?: string;
  notes?: string;
  /** Number of upload slots this item needs (e.g. a two-sided permit = 2).
   * Defaults to 1 when absent. Only meaningful for optional_upload items. */
  uploadSides?: number;
  /** Recency/expiry rule for an uploaded copy. Absent → no date screening
   * (plausibility-only). Populated per item in the Phase 3 policy audit. */
  validity?: DocumentValidity;
}

export interface DecisionTreeBranch {
  when: Record<string, string>;
  addItems?: string[];
  removeItems?: string[];
  note?: string;
  /**
   * Official-source URLs (FLHSMV, statute, tcslc) that substantiate THIS
   * branch's rule. Audit-facing, not surfaced to the end user. Required on
   * every branch in new trees; optional on legacy pilot trees until backfilled.
   */
  sourceRefs?: string[];
  /**
   * Structured blocker metadata. When absent but `note` starts with "BLOCKED:",
   * the tree loader synthesizes a hard-severity BlockingInfo from the note so
   * legacy trees keep working without hand-editing. New branches should set
   * this explicitly.
   */
  blocking?: Omit<BlockingInfo, "origin">;
}

export interface DecisionTreeSources {
  spreadsheet?: string;
  flhsmvVerified?: string[];
  tcslcVerified?: string[];
  statutes?: string[];
  gpt?: string[];
}

export interface DecisionTree {
  txnTypeId: string;
  baseItems: string[];
  factsRequired: string[];
  branches: DecisionTreeBranch[];
  sources: DecisionTreeSources;
}

export interface ResolvedItemsByBucket {
  bringIns: CatalogItem[];
  optionalUploads: CatalogItem[];
  forms: CatalogItem[];
}

export interface StructuredContext {
  identity?: IdentityContext;
  transactions: TransactionContext[];
  documents: DocumentContext[];
  preScreening: PreScreeningContext;
  scheduling?: SchedulingContext;
  facts: Record<string, FactValue>;
  resolvedBuckets?: ResolvedItemsByBucket;
  /**
   * Most-recent suggestions from suggest_transactions, kept around so the
   * engine can fall back if the LLM later tries to confirm with an empty
   * list (a common failure mode when the customer answers "no" to a
   * multi-select prompt). Cleared after confirm_selections fires with a
   * non-empty list, or when the customer's intent shifts.
   */
  pendingSuggestedTxnIds?: string[];
  suggestedReplies?: Array<{ label: string; value: string }>;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

/**
 * A single structured debug-log event. One per significant backend action:
 * Bedrock request/response, tool invoke/result, state advance, error.
 * Stored under the session's PK with SK `LOG#<ISO8601>#<eventType>`. General
 * 3-year retention — audit-facing, not PII.
 */
export interface DebugLogEvent {
  sessionId: string;
  timestamp: string;
  eventType: string;
  payload: unknown;
}

export interface Session {
  tenantId: string;
  sessionId: string;
  currentState: ConversationState;
  structuredContext: StructuredContext;
  stateConversationTurns: ConversationTurn[];
  incompletePreWork: boolean;
  channel: "web" | "walkin" | "sms";
  walkInLocationId?: string;
  /**
   * Email of the beta tester who created this session, captured at login.
   * Used to lock rehydrate to the original tester (so a tester sharing the
   * session URL doesn't accidentally let another tester edit their state),
   * to tag debug-log events for triage, and to render at the top of the
   * "Submit Transcript" / "Download Transcript" artifacts. Optional because
   * sessions created before the auth flow landed don't have it.
   */
  betaTesterEmail?: string;
  /**
   * True when this session was created by an automated test or developer
   * smoke check (Playwright probe, curl health check, etc). Set at create
   * time when the request includes the `x-test-session: 1` header. Real
   * tester sessions never carry this flag, even if their email matches a
   * heuristic pattern. The admin dashboard hides flagged sessions by
   * default but exposes a toggle to show them.
   */
  isTestSession?: boolean;
  /**
   * AuthID stable account identifier — typically the customer's email
   * (used directly per the AuthID portal config). Set when a session
   * first creates a Proof transaction; persists so subsequent rehydrates
   * can trigger a Verified re-auth against the same account.
   */
  authIdAccountNumber?: string;
  /**
   * In-flight Proof OperationId. Set when the bot opens a Proof
   * transaction; cleared after the result is fetched and persisted.
   */
  authIdOperationId?: string;
  /**
   * Transient embed URL for the in-flight Proof or Verified transaction.
   * Set by start_authid_proof / Verified rehydrate; cleared by the
   * /authid-result handler. Lives on the session because OneTimeSecrets
   * are single-use, but the page must survive refresh between mount
   * and completion.
   */
  pendingAuthIdProof?: { embedUrl: string; operationId: string; mode: "proof" | "verified" };
  /**
   * Summary of the most recent Proof result for triage and rehydrate.
   * Full result lives in DDB only for the 72h AuthID retention window.
   */
  authIdProofResult?: AuthIdProofSummary;
  /**
   * Admin triage flag: set true when a reviewer has looked at this session's
   * feedback in the admin dashboard. Not set by the chatbot flow — only the
   * admin write route touches it. Absent/false = not yet reviewed.
   */
  reviewed?: boolean;
  createdAt: string;
  updatedAt: string;
  ttl?: number;
}

export interface AuthIdProofSummary {
  operationId: string;
  /**
   * `pass`/`review`/`reject` come from the decision matrix; `failed` records a
   * transport-level AuthID failure (operation status > 1 — the result was
   * never usable) so admin triage can tell "AuthID rejected the person" apart
   * from "AuthID couldn't complete the check." All non-pass/review outcomes
   * leave the session in verify-identity (Skip + retry stay available).
   */
  decision: "pass" | "review" | "reject" | "failed";
  failureReasons: string[];
  matchedAt: string;
}
