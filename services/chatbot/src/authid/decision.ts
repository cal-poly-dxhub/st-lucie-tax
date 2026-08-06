/**
 * Decision logic for AuthID Proof results.
 *
 * Per https://developer.authid.ai/docs/the-onboarding-inspecting-results:
 * "authID does not automatically determine outcomes based on the Proof
 * process signals. Developers must code their own decision logic that
 * properly accounts for failed signals that indicate fraud."
 *
 * FAIL-CLOSED CONTRACT: this function classifies ANY input intentionally and
 * NEVER throws. AuthID's fraud signals are optional fields, so an ABSENT,
 * garbled, or non-explicit-`PASS` signal is treated as a failure — not a
 * silent pass. A malformed payload is a reject, not a 500. This is the inverse
 * of "assume OK unless told it's bad": a required signal must be present AND
 * explicitly good, or the resident does not pass. See the DecisionPolicy below
 * for the (env-overridable) severity of the fail-closed cases.
 *
 * Pure function — no I/O, no side effects (env is read once at module load).
 */
import type { Decision, ProofResultRaw, ExtractedIdentity } from "./types.js";

/**
 * The single config point for the fail-closed policy choices. Resolved once
 * from env at module load; `decide(result, { policy })` overrides per-call
 * (tests + future per-tenant tuning) without env coupling.
 */
export interface DecisionPolicy {
  /**
   * Absent / non-explicit-`PASS` / unrecognized REQUIRED signal.
   *   "reject" — fail closed (a missing signal blocks). Strictest.
   *   "review" — a missing signal downgrades to review (non-blocking).
   *   "ignore" — a missing signal contributes NOTHING; the scan is judged only
   *              on signals AuthID actually returned. Only an EXPLICIT `FAIL`
   *              (or `Matched:false`/`IsLive:false`/expired doc) rejects.
   * Default "ignore": our AuthID tenant's verification policy does not emit the
   * tamper signals (SelfieInjection/Barcode/PAD/DocumentInjection) for ANY scan,
   * so treating their absence as a failure rejected 100% of honest users. An
   * explicit failure signal still rejects regardless of this setting.
   */
  missingSignalOutcome: "reject" | "review" | "ignore";
  /** `documentInjectionAttackDetectionResult === 'FAIL'`. Default review (backward-compat). */
  documentInjectionOutcome: "reject" | "review";
  /** `Payload.Data` not a usable object / decide() cannot evaluate. Default reject. */
  malformedPayloadOutcome: "reject" | "review";
  /** Optional confidence floor beyond the boolean `Matched`. null = off (default). */
  minMatchScore: number | null;
}

function coerceMissing(v: string | undefined): "reject" | "review" | "ignore" {
  return v === "reject" || v === "review" || v === "ignore" ? v : "ignore";
}

function coerceOutcome(v: string | undefined, fallback: "reject" | "review"): "reject" | "review" {
  return v === "reject" || v === "review" ? v : fallback;
}

const DEFAULT_POLICY: DecisionPolicy = {
  missingSignalOutcome: coerceMissing(process.env.AUTHID_MISSING_SIGNAL_OUTCOME),
  documentInjectionOutcome: coerceOutcome(process.env.AUTHID_DOC_INJECTION_OUTCOME, "review"),
  malformedPayloadOutcome: "reject",
  minMatchScore:
    process.env.AUTHID_MIN_MATCH_SCORE &&
    Number.isFinite(Number(process.env.AUTHID_MIN_MATCH_SCORE))
      ? Number(process.env.AUTHID_MIN_MATCH_SCORE)
      : null,
};

export interface DecideOptions {
  policy?: Partial<DecisionPolicy>;
  /** Injectable clock for the expiry check; defaults to Date.now(). */
  now?: number;
}

/**
 * Read a signal that AuthID may emit under either camelCase or PascalCase.
 * The docs warn keys like `padResult`/`mismatchMrzOcr` may switch case in a
 * future release; without this a rename would silently drop the signal (a
 * fail-open regression). Returns the first alias that is actually present.
 */
function pickAlias(raw: Record<string, unknown>, aliases: string[]): unknown {
  for (const key of aliases) {
    if (raw[key] !== undefined) return raw[key];
  }
  return undefined;
}

/**
 * Evaluate a PASS/FAIL string signal fail-closed: only an explicit `'PASS'` is
 * clean. An explicit `'FAIL'` pushes `failReason` at its tier; ANYTHING else
 * (undefined, '', 'ERROR', a number, a drifted value) pushes `missingReason`
 * at the missing-signal tier — a bad actor cannot slip through a dropped or
 * garbled signal.
 */
function evalPassFail(
  value: unknown,
  opts: {
    failReason: string;
    failTier: string[];
    missingReason: string;
    missingTier: string[];
  },
): void {
  if (value === "PASS") return;
  if (value === "FAIL") {
    opts.failTier.push(opts.failReason);
    return;
  }
  opts.missingTier.push(opts.missingReason);
}

export function decide(result: ProofResultRaw, options?: DecideOptions): Decision {
  const policy: DecisionPolicy = { ...DEFAULT_POLICY, ...(options?.policy ?? {}) };
  const now = options?.now ?? Date.now();

  // A1 — shape validation, never throw. Anything we cannot read as an object
  // is unclassifiable → fail closed rather than crash (a 500 dumps the user at
  // the gate; a reject keeps them at the gate WITH a clear outcome + Skip).
  const data = (result as { Payload?: { Data?: unknown } } | null | undefined)?.Payload?.Data;
  if (!data || typeof data !== "object") {
    return { outcome: policy.malformedPayloadOutcome, reasons: ["malformed-result-payload"] };
  }

  const rejectReasons: string[] = [];
  const reviewReasons: string[] = [];
  // Where an ABSENT/unreadable required signal goes. "ignore" routes missing
  // reasons to a throwaway sink so they never affect the outcome — an explicit
  // FAIL still lands in rejectReasons regardless. reject/review keep the
  // fail-closed behavior for stricter tenants.
  const ignoredMissing: string[] = [];
  const missingTier =
    policy.missingSignalOutcome === "reject"
      ? rejectReasons
      : policy.missingSignalOutcome === "review"
        ? reviewReasons
        : ignoredMissing;
  const raw = data as Record<string, unknown>;

  // A4 — guarded Matched: explicit false → reject; explicit true → clean;
  // anything else (undefined / non-boolean) → missing-signal tier.
  const matched = raw.Matched;
  if (matched === false) rejectReasons.push("selfie-document-mismatch");
  else if (matched !== true) missingTier.push("match-signal-missing");

  // A5 — guarded liveness: never derefs an undefined LivenessDetectionResult.
  const liveness = raw.LivenessDetectionResult as { IsLive?: unknown } | undefined;
  const isLive = liveness?.IsLive;
  if (isLive === false) rejectReasons.push("liveness-failed");
  else if (isLive !== true) missingTier.push("liveness-signal-missing");

  // A3 — required PASS/FAIL signals, explicit-PASS-only + camel/Pascal tolerant.
  evalPassFail(
    pickAlias(raw, [
      "selfieInjectionAttackDetectionResult",
      "SelfieInjectionAttackDetectionResult",
    ]),
    {
      failReason: "selfie-injection-attack",
      failTier: rejectReasons,
      missingReason: "selfie-injection-signal-missing",
      missingTier,
    },
  );
  evalPassFail(pickAlias(raw, ["BarcodeSecurity", "barcodeSecurity"]), {
    failReason: "barcode-tampered",
    failTier: rejectReasons,
    missingReason: "barcode-signal-missing",
    missingTier,
  });
  evalPassFail(pickAlias(raw, ["padResult", "PadResult"]), {
    failReason: "document-replay-detected",
    failTier: reviewReasons,
    missingReason: "pad-signal-missing",
    missingTier,
  });
  evalPassFail(
    pickAlias(raw, [
      "documentInjectionAttackDetectionResult",
      "DocumentInjectionAttackDetectionResult",
    ]),
    {
      failReason: "document-injection-attack",
      failTier: policy.documentInjectionOutcome === "reject" ? rejectReasons : reviewReasons,
      missingReason: "document-injection-signal-missing",
      missingTier,
    },
  );

  // A6 — guarded expiry: read the Document.Data entry, else the top-level
  // field (AuthID's documented dual location). Missing OR unparseable fails
  // closed; only a well-formed FUTURE date is clean.
  const expiryValue = readExpiry(raw);
  if (expiryValue === undefined) {
    missingTier.push("expiry-missing");
  } else {
    const expiry = new Date(`${expiryValue}T23:59:59Z`).getTime();
    if (!Number.isFinite(expiry)) missingTier.push("expiry-unparseable");
    else if (expiry < now) rejectReasons.push("document-expired");
  }

  // A7 — mismatchMrzOcr: present only on mismatch, so it is NOT a required
  // signal (absence = no mismatch). Any present truthy-non-false → review.
  const mrz = pickAlias(raw, ["mismatchMrzOcr", "MismatchMrzOcr"]);
  if (mrz === true) reviewReasons.push("mrz-ocr-mismatch");

  // A8 — optional match-score floor (off unless configured).
  if (policy.minMatchScore !== null) {
    const score = raw.MatchScore;
    if (typeof score !== "number" || !Number.isFinite(score))
      missingTier.push("match-score-missing");
    else if (score < policy.minMatchScore) rejectReasons.push("match-score-below-floor");
  }

  // A9 — combine (precedence + reason-string shape unchanged from the original).
  if (rejectReasons.length > 0) {
    return { outcome: "reject", reasons: [...rejectReasons, ...reviewReasons] };
  }
  if (reviewReasons.length > 0) {
    return { outcome: "review", reasons: reviewReasons };
  }
  return { outcome: "pass", reasons: [] };
}

/** Expiry lives in the Document.Data KV list; fall back to a top-level field. */
function readExpiry(raw: Record<string, unknown>): string | undefined {
  const doc = raw.Document as { Data?: unknown } | undefined;
  const list = doc?.Data;
  if (Array.isArray(list)) {
    const entry = list.find(
      (kv): kv is { Key: string; Value: string } =>
        !!kv && typeof kv === "object" && (kv as { Key?: unknown }).Key === "DateOfExpiry",
    );
    if (entry && typeof entry.Value === "string") return entry.Value;
  }
  const topLevel = raw.DateOfExpiry;
  return typeof topLevel === "string" ? topLevel : undefined;
}

export function extractIdentity(result: ProofResultRaw): ExtractedIdentity {
  // A10 — guarded: never map over a missing Document.Data (fail-closed decide()
  // may run on a partial payload; extraction must not throw either).
  const list = (
    result as { Payload?: { Data?: { Document?: { Data?: unknown } } } } | null | undefined
  )?.Payload?.Data?.Document?.Data;
  const kv = new Map(
    Array.isArray(list)
      ? list
          .filter((e): e is { Key: string; Value: string } => !!e && typeof e === "object")
          .map((e) => [e.Key, e.Value] as const)
      : [],
  );
  return {
    fullName: kv.get("FullName"),
    dateOfBirth: kv.get("DateOfBirth"),
    address: kv.get("Address"),
  };
}
