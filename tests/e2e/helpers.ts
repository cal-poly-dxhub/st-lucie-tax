/**
 * Shared helpers for e2e specs. Drives the bot via the public HTTP API
 * AND takes Playwright screenshots at key moments. Mixed approach: API
 * for deterministic state advancement, Playwright for UX assertion.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type Page, expect } from "@playwright/test";

export const ARTIFACT_DIR = resolve(".cache/test-pass/2-playwright");
mkdirSync(ARTIFACT_DIR, { recursive: true });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value)
    throw new Error(
      `${name} environment variable is required. Set it in .env.test or your CI environment.`,
    );
  return value;
}

export const BACKEND = requireEnv("BACKEND");
export const FRONTEND = requireEnv("PLAYWRIGHT_FRONTEND_URL");

const API_KEY = process.env.API_KEY;

import { CognitoUserPool, CognitoUser, AuthenticationDetails } from "amazon-cognito-identity-js";

const TEST_USER_COUNT = 1;

// Each Playwright worker is a separate process, so a module-level cache is
// naturally per-worker — no cross-worker collision risk.
function workerTestEmail(baseEmail: string): string {
  const workerIndex = Number(process.env.TEST_WORKER_INDEX ?? "0") % TEST_USER_COUNT;
  const [local, domain] = baseEmail.split("@");
  return `${local}+pw${workerIndex}@${domain}`;
}

let _idToken: string | null = null;

async function getCognitoToken(): Promise<string | null> {
  if (_idToken) return _idToken;
  const baseEmail = process.env.BETA_EMAIL;
  const password = process.env.BETA_PASSWORD;
  const frontendUrl = process.env.PLAYWRIGHT_FRONTEND_URL;
  if (!baseEmail || !password || !frontendUrl) return null;
  const email = workerTestEmail(baseEmail);

  const origin = new URL(frontendUrl).origin;
  const configRes = await fetch(`${origin}/config.json`);
  if (!configRes.ok) return null;
  const config = (await configRes.json()) as {
    userPoolId: string;
    userPoolClientId: string;
  };

  const pool = new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
  });
  const user = new CognitoUser({ Username: email, Pool: pool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });

  _idToken = await new Promise<string | null>((resolve) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(session.getIdToken().getJwtToken()),
      onFailure: () => resolve(null),
      newPasswordRequired: () => resolve(null),
    });
  });
  return _idToken;
}

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  if (API_KEY) headers["x-api-key"] = API_KEY;
  const token = await getCognitoToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

export interface SessionState {
  sessionId: string;
  state: string;
  transactions: string[];
  facts: Record<string, { value: string; confidence: string }>;
  resolvedBuckets?: {
    bringIns: Array<{ itemId: string; label: string }>;
    optionalUploads: Array<{ itemId: string; label: string }>;
    forms: Array<{ itemId: string; label: string }>;
  };
}

export async function createSession(): Promise<string> {
  const r = await fetch(`${BACKEND}/chatbot/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ channel: "web" }),
  });
  if (!r.ok) throw new Error(`createSession HTTP ${r.status}`);
  const j = await r.json();
  return j.sessionId;
}

export async function sendMessage(
  sid: string,
  msg: string,
): Promise<{ state: string; assistantMsg: string }> {
  const r = await fetch(`${BACKEND}/chatbot/sessions/${sid}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ message: msg }),
  });
  if (!r.ok) throw new Error(`sendMessage HTTP ${r.status}`);
  const j = await r.json();
  return { state: j.state, assistantMsg: j.message };
}

export async function getSessionState(sid: string): Promise<SessionState> {
  const r = await fetch(`${BACKEND}/chatbot/sessions/${sid}/rehydrate`, {
    headers: await authHeaders(),
  });
  if (!r.ok) throw new Error(`rehydrate HTTP ${r.status}`);
  const j = await r.json();
  const ctx = j.session.structuredContext;
  return {
    sessionId: j.session.sessionId,
    state: j.session.currentState,
    transactions: (ctx.transactions || []).map((t: { txnTypeId: string }) => t.txnTypeId),
    facts: Object.fromEntries(
      Object.entries(ctx.facts || {}).map(([k, v]) => {
        const fv = v as { value: string; confidence: string };
        return [k, { value: fv.value, confidence: fv.confidence }];
      }),
    ),
    resolvedBuckets: ctx.resolvedBuckets,
  };
}

export async function confirmIdentity(
  sid: string,
  identity = {
    name: "Test User",
    dob: "01/01/1980",
    dlNumber: "X123-456-78-901-0",
    address: "123 Test St, Fort Pierce, FL 34950",
  },
) {
  // Backend returns HTTP 400 if the session isn't in verify-identity state
  // (e.g., the flow skipped past identity for a non-DL transaction). Make
  // this call a no-op in that case so test specs can call it unconditionally
  // without worrying about which state the bot reached.
  const st = await getSessionState(sid);
  if (st.state !== "verify-identity") {
    return { skipped: true, currentState: st.state };
  }
  const r = await fetch(`${BACKEND}/chatbot/sessions/${sid}/confirm-identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(identity),
  });
  if (!r.ok) throw new Error(`confirmIdentity HTTP ${r.status}`);
  return r.json();
}

export interface FlowOutcome {
  txnTypeId: string;
  opener: string;
  sessionId: string;
  finalState: string;
  finalTransactions: string[];
  identifiedTxnMatches: boolean; // did the bot find this txn?
  reachedConfirmFacts: boolean;
  resolvedBucketCounts: { bringIns: number; optionalUploads: number; forms: number } | null;
  messageCount: number;
  errorReason?: string;
  screenshotPaths: string[];
  notes: string[];
}

/**
 * Walk a transaction from URL load → opener → eligibility yes/yes/yes →
 * skip identity (via API) → first resolve-facts question → answer with the
 * first valid value → continue until confirm-facts OR cap reached. Records
 * screenshots at: initial load, post-opener, post-eligibility, confirm-facts.
 */
export async function walkTransaction(
  page: Page,
  txnTypeId: string,
  opener: string,
  options: { extraTurns?: string[] } = {},
): Promise<FlowOutcome> {
  const outcome: FlowOutcome = {
    txnTypeId,
    opener,
    sessionId: "",
    finalState: "",
    finalTransactions: [],
    identifiedTxnMatches: false,
    reachedConfirmFacts: false,
    resolvedBucketCounts: null,
    messageCount: 0,
    screenshotPaths: [],
    notes: [],
  };

  try {
    // 1. Open landing page
    await page.goto(FRONTEND);
    const ssLanding = resolve(ARTIFACT_DIR, `flow-${txnTypeId}-1-landing.png`);
    await page.screenshot({ path: ssLanding });
    outcome.screenshotPaths.push(ssLanding);

    // 2. Send opener via API (so we control timing)
    const sid = await createSession();
    outcome.sessionId = sid;
    await sendMessage(sid, opener);
    outcome.messageCount += 1;
    let st = await getSessionState(sid);
    outcome.identifiedTxnMatches = st.transactions.includes(txnTypeId);
    if (!outcome.identifiedTxnMatches && st.transactions.length === 0) {
      outcome.notes.push(
        `bot did not confirm any transaction; sometimes asks a clarifying Q first — sending followup`,
      );
      // Try to push it: confirm with the txn name
      await sendMessage(sid, `Yes, I want ${txnTypeId.replace(/-/g, " ")}`);
      outcome.messageCount += 1;
      st = await getSessionState(sid);
      outcome.identifiedTxnMatches = st.transactions.includes(txnTypeId);
    } else if (!outcome.identifiedTxnMatches && st.transactions.length > 0) {
      outcome.notes.push(`bot confirmed wrong txn(s): ${st.transactions.join(", ")}`);
    }

    // Reload UI on the active session so banner+side-panel reflect server state
    await page.goto(`${FRONTEND}/?s=${sid}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const ssOpener = resolve(ARTIFACT_DIR, `flow-${txnTypeId}-2-opener.png`);
    await page.screenshot({ path: ssOpener });
    outcome.screenshotPaths.push(ssOpener);

    // 3. Eligibility check (universal-blockers): answer No / Yes / Yes
    if (st.state === "universal-blockers") {
      await sendMessage(sid, "No"); // license suspended? no
      await sendMessage(sid, "Yes"); // in FL? yes
      await sendMessage(sid, "Yes"); // photo ID? yes
      outcome.messageCount += 3;
      st = await getSessionState(sid);
    }

    // 4. Skip identity verification via direct confirm-identity endpoint
    if (st.state === "verify-identity") {
      await confirmIdentity(sid);
      st = await getSessionState(sid);
    }
    const ssEligibility = resolve(ARTIFACT_DIR, `flow-${txnTypeId}-3-post-eligibility.png`);
    await page.goto(`${FRONTEND}/?s=${sid}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.screenshot({ path: ssEligibility });
    outcome.screenshotPaths.push(ssEligibility);

    // 5. resolve-facts: pick the first non-unknown valueLabel for whichever
    //    fact the bot is currently asking about. Falls back to a deterministic
    //    rotation when we can't determine the next-fact (e.g. universal-blockers
    //    cascade or transitional states).
    const MAX_TURNS = 14;
    let turn = 0;
    while (st.state === "resolve-facts" && turn < MAX_TURNS) {
      const reply = await pickSmartReply(sid, st, turn);
      await sendMessage(sid, reply);
      outcome.messageCount += 1;
      st = await getSessionState(sid);
      turn += 1;
    }

    // 6. Custom extra turns (for multi-tx scenarios that need specific answers)
    for (const extra of options.extraTurns ?? []) {
      await sendMessage(sid, extra);
      outcome.messageCount += 1;
      st = await getSessionState(sid);
    }

    outcome.finalState = st.state;
    outcome.finalTransactions = st.transactions;
    outcome.reachedConfirmFacts =
      st.state === "confirm-facts" ||
      st.state === "upload-docs" ||
      st.state === "checkout-check" ||
      st.state === "schedule";
    if (st.resolvedBuckets) {
      outcome.resolvedBucketCounts = {
        bringIns: st.resolvedBuckets.bringIns.length,
        optionalUploads: st.resolvedBuckets.optionalUploads.length,
        forms: st.resolvedBuckets.forms.length,
      };
    }

    await page.goto(`${FRONTEND}/?s=${sid}`);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const ssFinal = resolve(ARTIFACT_DIR, `flow-${txnTypeId}-4-final.png`);
    await page.screenshot({ path: ssFinal });
    outcome.screenshotPaths.push(ssFinal);
  } catch (err) {
    outcome.errorReason = err instanceof Error ? err.message : String(err);
  }

  // Persist trace
  writeFileSync(
    resolve(ARTIFACT_DIR, `flow-${txnTypeId}.json`),
    JSON.stringify(outcome, null, 2) + "\n",
  );
  return outcome;
}

/**
 * Smart-reply picker: hits the unresolved-facts endpoint to find what the bot
 * is currently asking about, then returns the first non-`unknown` valueLabel
 * for that fact. The label text matches what chips display, which is what the
 * bot's prompt instructs it to use verbatim, so the LLM can map it back
 * deterministically. Catches the failure mode where rotating Yes/No/1/Not-sure
 * answers don't satisfy the current question and the test stalls in
 * resolve-facts. Falls back to a generic answer rotation when the API is
 * unavailable or returns nothing.
 */
async function pickSmartReply(sid: string, st: SessionState, turn: number): Promise<string> {
  if (turn === 0 && st.state === "resolve-facts") {
    // First turn primer — let the bot ask its first question
    return "What's next?";
  }
  try {
    const r = await fetch(`${BACKEND}/chatbot/sessions/${sid}/unresolved-facts`, {
      headers: await authHeaders(),
    });
    if (r.ok) {
      const j = await r.json();
      const next = (
        j.unresolvedFacts as
          | Array<{
              factKey: string;
              allowedValues: string[];
              valueLabels?: Record<string, string>;
            }>
          | undefined
      )?.[0];
      if (next) {
        const firstReal = next.allowedValues.find((v) => v !== "unknown");
        if (firstReal) {
          return next.valueLabels?.[firstReal] ?? firstReal;
        }
      }
    }
  } catch {
    // fall through
  }
  // Fallback rotation
  const replies = ["Yes", "No", "1", "Not sure"];
  return replies[turn % replies.length];
}

export { expect };
