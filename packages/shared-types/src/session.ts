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

export interface CatalogItem {
  itemId: string;
  label: string;
  bucket: ItemBucket;
  source?: string;
  verified?: string;
  notes?: string;
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
  decision: "pass" | "review" | "reject";
  failureReasons: string[];
  matchedAt: string;
}
