/**
 * Testable, side-effect-free helpers for the /authid-result flow.
 *
 * The Express route (local-server-app.ts) owns the I/O — DDB reads/writes,
 * Bedrock autoGreet, and state-machine advance. These helpers hold the
 * branching + session-mutation logic so it can be unit-tested with plain
 * objects and injected functions (no live AuthID, no DynamoDB, no Bedrock).
 *
 * NON-BLOCKING CONTRACT: the whole AuthID flow is skippable, so nothing here
 * may trap the resident. The poll budget is deliberately SHORT (well under the
 * 29s API-Gateway integration timeout) — when AuthID isn't terminal yet the
 * poll returns `pending` and the frontend re-polls, rather than the request
 * blocking past the gateway ceiling and surfacing a spurious 504. No outcome
 * produced here changes `currentState`, so `POST /skip-verify` and a fresh
 * `start_authid_proof` retry both stay reachable after any failure/reject.
 */
import type { Session } from "@st-lucie/shared-types";
import type { Decision, ExtractedIdentity, ProofResultRaw } from "./types.js";
import { decide, extractIdentity, type DecideOptions } from "./decision.js";

export type PollOutcome =
  | { outcome: "ready" }
  | { outcome: "failed"; status: number }
  | { outcome: "pending" };

export interface PollDeps {
  getOperationStatus: (operationId: string) => Promise<{ Status: number }>;
  /** Injected so tests run instantly; the route passes a real setTimeout wrapper. */
  sleep: (ms: number) => Promise<void>;
  maxAttempts: number;
  intervalMs: number;
}

/**
 * Short-budget poll of an AuthID operation's status.
 * - `Status === 1` → `ready` (result is fetchable).
 * - `Status > 1`   → `failed` (terminal transport failure; carries the status).
 * - budget exhausted while still `Status 0` → `pending` (NOT an error — the
 *   op is still processing; the caller returns 200 {status:'pending'} and the
 *   frontend re-polls).
 *
 * Sleeps only BETWEEN attempts (never after the last), so total wall-clock is
 * ≈ (maxAttempts - 1) * intervalMs — keep that under the gateway ceiling.
 */
export async function pollProofStatus(operationId: string, deps: PollDeps): Promise<PollOutcome> {
  for (let i = 0; i < deps.maxAttempts; i += 1) {
    const { Status } = await deps.getOperationStatus(operationId);
    if (Status === 1) return { outcome: "ready" };
    if (Status > 1) return { outcome: "failed", status: Status };
    if (i < deps.maxAttempts - 1) await deps.sleep(deps.intervalMs);
  }
  return { outcome: "pending" };
}

export interface ProofClassification {
  decision: Decision;
  extracted: ExtractedIdentity;
  /** True iff the decision holds the session in verify-identity (reject). */
  holdsSession: boolean;
}

/** Pure wrapper: run the (hardened, fail-closed) decision matrix + extraction. */
export function classifyProof(raw: ProofResultRaw, options?: DecideOptions): ProofClassification {
  const decision = decide(raw, options);
  const extracted = extractIdentity(raw);
  return { decision, extracted, holdsSession: decision.outcome === "reject" };
}

/**
 * Apply a proof CLASSIFICATION to the session (pure mutation; caller persists).
 * Byte-identical to the pre-refactor route: writes the proof summary, clears
 * the in-flight fields, and on a NON-reject outcome writes the extracted
 * identity. On reject, identity is left untouched. Does NOT advance state,
 * infer facts, or greet — the route keeps those.
 */
export function applyProofOutcomeToSession(
  session: Session,
  classification: ProofClassification,
  opts: { matchedAt: string },
): void {
  const { decision, extracted } = classification;
  session.authIdProofResult = {
    operationId: session.authIdOperationId ?? "",
    decision: decision.outcome,
    failureReasons: decision.reasons,
    matchedAt: opts.matchedAt,
  };
  session.authIdOperationId = undefined;
  session.pendingAuthIdProof = undefined;

  if (decision.outcome === "reject") return;

  session.structuredContext.identity = {
    name: extracted.fullName ?? "",
    dob: extracted.dateOfBirth ?? "",
    address: extracted.address ?? "",
    confirmed: true,
  };
}

/**
 * Apply a transport-level AuthID FAILURE (operation status > 1) to the session
 * (pure mutation; caller persists). Symmetric with a reject: records a durable
 * `failed` summary and clears the in-flight fields, but leaves `currentState`
 * as verify-identity and never writes an identity — so Skip and a fresh
 * start_authid_proof retry both stay available. Fixes the prior fail-open path
 * where authid-failed returned without persisting anything.
 */
export function applyAuthIdFailureToSession(
  session: Session,
  opts: { status: number; matchedAt: string },
): void {
  session.authIdProofResult = {
    operationId: session.authIdOperationId ?? "",
    decision: "failed",
    failureReasons: [`authid-status-${opts.status}`],
    matchedAt: opts.matchedAt,
  };
  session.authIdOperationId = undefined;
  session.pendingAuthIdProof = undefined;
}
