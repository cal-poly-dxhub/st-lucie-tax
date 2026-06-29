/**
 * Shared Express app definition for the chatbot service.
 *
 * Contains every route + middleware but does NOT call `app.listen()`. Two
 * consumers import the exported `app`:
 *
 *   - local-server.ts — runs `app.listen(PORT)` for `npm run dev`
 *   - handlers/express-app.handler.ts — wraps `app` via @codegenie/serverless-express
 *     so the entire surface deploys as a single Lambda behind API Gateway
 *     {proxy+}.
 */

import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import type { HotButton } from "@st-lucie/shared-types";
import { getPool, getChatSession, getChatMessages } from "@st-lucie/data-access";
import { createSession } from "./session/create-session.js";
import { getSession } from "./session/get-session.js";
import { processMessage, runAutoGreet } from "./conversation/process-message.js";
import { skipState as doSkipState } from "./state-machine/skip-state.js";
import { updateSession } from "./session/update-session.js";
import { generateUploadUrl } from "./upload/generate-url.js";
import { advanceState, shouldAutoAdvance } from "./state-machine/transitions.js";
import { isTerminal } from "./state-machine/states.js";
import { inferFactsFromIdentity } from "./session/infer-facts-from-identity.js";
import { handleRecordFactsTool } from "./tools/record-facts/tools.js";
import {
  handleResolveFactsTool,
  collectRequiredFactKeysForActiveTxns,
} from "./tools/resolve-facts/tools.js";
import { sendTranscriptForSession } from "./email/transcript-sender.js";
import { appendMessageFeedback, appendSessionFeedback } from "./feedback/feedback-store.js";
import { buildTranscriptPdf } from "./feedback/pdf-builder.js";
import {
  getOperationStatus,
  getProofResult,
  createVerifiedTransaction,
  buildVerifiedEmbedUrl,
} from "./authid/client.js";
import { decide, extractIdentity } from "./authid/decision.js";
import { findSlot, book, schedulingEnabled } from "./scheduling/client.js";
import {
  isAuthEnabled,
  checkPassword,
  issueToken,
  verifyToken,
  isValidEmail,
  normalizeEmail,
} from "./auth/beta-auth.js";

export const app = express();

// Cascade through any states whose entry conditions are already met
// (bounded to prevent accidental infinite loops).
function cascadeAutoAdvance(session: Parameters<typeof shouldAutoAdvance>[0]): void {
  for (
    let i = 0;
    i < 10 && !isTerminal(session.currentState) && shouldAutoAdvance(session);
    i += 1
  ) {
    advanceState(session);
  }
}
const TENANT_ID = process.env.TENANT_ID || "stlucie";

app.use(express.json());

// CORS — required for the deployed CloudFront frontend to reach the Lambda
// behind API Gateway. The API Gateway preflight (OPTIONS) is handled by
// defaultCorsPreflightOptions, but for AWS_PROXY integrations the Lambda
// response IS the user-facing response, so we need to send the header
// ourselves on every actual response too.
//
// Open CORS for the beta — single tenant, no cookies, no auth state in the
// origin. Restrict to specific domains when we add Cognito or session cookies.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, X-Api-Key, x-test-session, X-Test-Session",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

// SEC-15 (NFR-SEC-07): application-level rate limiting on the abuse-prone
// public endpoints — session creation (each one allocates DDB state) and the
// message endpoint (each one is a paid Bedrock tool-loop). This is
// defence-in-depth BEHIND the CloudFront WAF rate limit (SEC-13), not a
// replacement.
//
// Keying: under @codegenie/serverless-express, API Gateway's real client IP
// (requestContext.identity.sourceIp) is mapped straight into req.ip — verified
// in node_modules/.../request.js — so a plain req.ip key is the true client IP
// in Lambda with NO `trust proxy` needed (which also avoids express-rate-limit
// v7's trust-proxy validation error).
//
// LIMITATION: the default MemoryStore is per-Lambda-container, so under high
// concurrency each warm container keeps its own counter — this throttles a
// single abusive client hammering one container, but is not a globally
// coordinated limit. The WAF (edge, global) remains the primary volumetric
// control; a shared store (e.g. DynamoDB/Redis) would be the production
// upgrade if app-level global limits are required.
const ipKey = (req: express.Request): string => req.ip ?? "unknown";

const sessionCreateLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 10, // ≤10 new sessions/min/IP — a human starts one
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: {
    error: "Too many new sessions from this address. Please wait a minute and try again.",
  },
});

const messageLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 40, // ≤40 turns/min/IP — generous for a fast typer
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKey,
  message: { error: "You are sending messages too quickly. Please slow down." },
});

// --- Beta auth ---
//
// Only active when BOTH BETA_PASSWORD and BETA_AUTH_SECRET env vars are set.
// In tsx-dev (no envs) this whole block is a no-op — the existing local
// development flow keeps working without anyone needing a token.
//
// POST /chatbot/auth/login validates the master password + a tester email.
// On success it returns an HMAC-signed token; the frontend stores it in
// localStorage and sends it as Authorization: Bearer <token> on every
// subsequent request. Middleware below parses the header and attaches
// req.betaEmail when valid; protected routes require it.

declare module "express-serve-static-core" {
  interface Request {
    betaEmail?: string;
  }
}

// POST /chatbot/auth/login
// Body: { email, password }
// Returns: { token, email } on success, 401 on invalid password.
app.post("/chatbot/auth/login", (req, res) => {
  if (!isAuthEnabled()) {
    // No-op in dev — return a token so the frontend's auth flow can still
    // exercise the UX path without needing to set the env vars.
    const email = normalizeEmail(req.body?.email ?? "dev@local");
    return res.json({ token: "dev-no-auth", email });
  }
  const email = normalizeEmail(req.body?.email ?? "");
  const password = String(req.body?.password ?? "");
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  if (!checkPassword(password)) {
    return res.status(401).json({ error: "Wrong password. Check the email Mason sent." });
  }
  const token = issueToken(email);
  return res.json({ token, email });
});

// Auth middleware — runs before every /chatbot/* request EXCEPT the login
// endpoint, the all-transactions catalog (public OK for fetching the menu),
// hot-buttons (legacy public), and OPTIONS preflights. Sets req.betaEmail
// when the token is valid; rejects with 401 when missing/invalid.
const PUBLIC_ROUTES = new Set([
  "/chatbot/auth/login",
  "/chatbot/all-transactions",
  "/chatbot/hot-buttons",
  "/api/hot-buttons",
]);

// SEC-16: the /chatbot/debug/* endpoints expose full Bedrock payloads (with
// citizen PII) and every decision-tree's internals — enough for a holder of a
// leaked beta token to reconstruct the system prompt + routing logic for
// targeted prompt injection. They are dev/ops tooling, never citizen-facing,
// so they are OFF by default in any deployed environment.
//
// Enabled only when EITHER:
//   - auth is disabled (local `npm run dev` — no BETA_* envs), where these
//     endpoints are the whole point of the debug panel, OR
//   - ENABLE_DEBUG_ENDPOINTS=1 is explicitly set (opt-in for an ops session).
// The deployed Lambda has auth ON and the flag unset → debug routes 404.
function debugEndpointsEnabled(): boolean {
  return !isAuthEnabled() || process.env.ENABLE_DEBUG_ENDPOINTS === "1";
}
function debugGate(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!debugEndpointsEnabled()) {
    // 404 (not 403) so the route is indistinguishable from "doesn't exist" —
    // don't advertise the surface to a token holder probing for it.
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

app.use((req, res, next) => {
  if (!isAuthEnabled()) return next(); // dev mode
  if (req.method === "OPTIONS") return next(); // CORS preflight
  if (PUBLIC_ROUTES.has(req.path)) return next();
  if (!req.path.startsWith("/chatbot/") && !req.path.startsWith("/api/")) return next();

  const auth = req.header("authorization") ?? req.header("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "Sign in to continue." });
  }
  const token = auth.slice(7).trim();
  const verified = verifyToken(token);
  if (!verified) {
    return res.status(401).json({ error: "Your session expired. Please sign in again." });
  }
  req.betaEmail = verified.email;
  // SEC-05 sliding expiry: once a still-valid token is past half-life, mint a
  // fresh one and hand it back via a response header. The SPA swaps it into
  // localStorage so an actively-used token never expires out from under a
  // tester, while an idle/stolen token still dies within its 30-day TTL.
  if (verified.needsRefresh) {
    res.setHeader("X-Refreshed-Token", issueToken(verified.email));
    res.setHeader("Access-Control-Expose-Headers", "X-Refreshed-Token");
  }
  next();
});

// --- API routes (mounted at /chatbot/* via API Gateway proxy) ---

// POST /chatbot/sessions — create session
app.post("/chatbot/sessions", sessionCreateLimiter, async (req, res) => {
  try {
    const { channel, walkInLocationId } = req.body;
    // Mark a session as a test/probe session when either:
    //   1. The request carries `x-test-session: 1` (works for direct curl /
    //      eval-script smoke checks; useless from the SPA because Chromium's
    //      CORS layer strips custom headers added post-preflight).
    //   2. The auth-captured email ends in @example.com — IETF-reserved
    //      "documentation only" domain that no real tester will ever own.
    //      This is the load-bearing path for browser-driven Playwright
    //      probes, which already use timestamped @example.com emails.
    // Real testers always have real-domain emails (.gov, .edu, .com), so
    // they never get accidentally flagged.
    const headerSays = req.header("x-test-session") === "1" || req.header("X-Test-Session") === "1";
    const emailSays = (req.betaEmail ?? "").toLowerCase().endsWith("@example.com");
    const isTestSession = headerSays || emailSays;
    const session = await createSession({
      tenantId: TENANT_ID,
      channel: channel || "web",
      walkInLocationId,
      betaTesterEmail: req.betaEmail,
      isTestSession,
    });
    const pool = getPool();
    const hbResult = await pool.query<{ label: string; prompt: string }>(
      `SELECT label, prompt FROM hotbuttons ORDER BY sort_order`,
    );
    const buttons: HotButton[] = hbResult.rows.map((r) => ({
      label: r.label,
      transactionTypeId: r.prompt,
    }));
    res.status(201).json({
      sessionId: session.sessionId,
      state: session.currentState,
      hotButtons: buttons,
    });
  } catch (err) {
    console.error("Create session error:", err);
    res.status(500).json({ error: "Failed to create session" });
  }
});

// POST /chatbot/sessions/:sessionId/messages — process message
app.post("/chatbot/sessions/:sessionId/messages", messageLimiter, async (req, res) => {
  try {
    // Adding route middleware widens req.params to string|string[] in the
    // Express types; pin to a string once for the handler.
    const sessionId = String(req.params.sessionId);
    const { message } = req.body;
    if (!message?.trim()) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const result = await processMessage(TENANT_ID, sessionId, message);

    // Backfill the session's betaTesterEmail from the verified bearer if the
    // create-session request didn't capture it. We've seen real-tester
    // sessions land with no email even though the user logged in — patch
    // every active conversation here so the admin dashboard can attribute
    // every session that gets past landing. Done AFTER processMessage so
    // its updateSession() write doesn't clobber the backfill (it loads its
    // own copy of the session and spreads it back into PutItem).
    // Cheap: one extra read + conditional write on the turn that fills it
    // in, no-op on every subsequent turn.
    if (req.betaEmail) {
      const existing = await getSession(TENANT_ID, sessionId);
      if (existing && !existing.betaTesterEmail) {
        existing.betaTesterEmail = req.betaEmail;
        await updateSession(existing);
      }
    }

    const activeTransactions = result.structuredContext.transactions
      .filter((t: { status: string }) => t.status === "active")
      .map((t: { txnTypeId: string; name: string; durationMinutes: number }) => ({
        txnTypeId: t.txnTypeId,
        name: t.name,
        durationMinutes: t.durationMinutes,
      }));
    const totalDuration = activeTransactions.reduce(
      (sum: number, t: { durationMinutes: number }) => sum + t.durationMinutes,
      0,
    );
    const seen = new Set<string>();
    const combinedDocuments: string[] = [];
    for (const doc of result.structuredContext.documents) {
      if (!seen.has(doc.documentType)) {
        seen.add(doc.documentType);
        combinedDocuments.push(doc.documentType);
      }
    }

    res.json({
      sessionId,
      message: result.message,
      state: result.state,
      structuredContext: result.structuredContext,
      identifiedTransactions: activeTransactions,
      combinedDocuments,
      totalDurationMinutes: totalDuration,
      ...(result.kbSources && { kbSources: result.kbSources }),
      ...(result.messageId && { messageId: result.messageId }),
    });
  } catch (error) {
    console.error("Chat error:", error);
    const isDev = process.env.NODE_ENV !== "production";
    const detail =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { value: String(error) };
    res.status(500).json({
      error: "An error occurred processing your message.",
      ...(isDev ? { detail } : {}),
    });
  }
});

// GET /chatbot/session-state/:sessionId — polling endpoint
// Per spec: returns session state including OCR results for async update detection
app.get("/chatbot/session-state/:sessionId", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json({
      sessionId: session.sessionId,
      state: session.currentState,
      structuredContext: session.structuredContext,
      incompletePreWork: session.incompletePreWork,
      pendingAuthIdProof: session.pendingAuthIdProof,
    });
  } catch (err) {
    console.error("Session fetch error:", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// GET /chatbot/sessions/:sessionId/rehydrate
// Returns everything the frontend needs to resume a bookmarked session:
// the session row (state + structuredContext + channel) AND the full
// conversation history rebuilt from HISTORY# items.
app.get("/chatbot/sessions/:sessionId/rehydrate", async (req, res) => {
  try {
    const sid = req.params.sessionId;
    const session = await getSession(TENANT_ID, sid);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Lock rehydrate to the original creator's email. If a tester sends their
    // session URL to another tester, they need the original email to resume.
    // Pre-auth sessions (no betaTesterEmail) are unlocked. When auth is off
    // entirely (req.betaEmail unset), we don't enforce.
    if (req.betaEmail && session.betaTesterEmail && session.betaTesterEmail !== req.betaEmail) {
      res.status(403).json({
        error: "session-belongs-to-another-tester",
        message:
          'This conversation was started by a different beta tester. Sign in with their email to continue, or click "New session" to start fresh.',
      });
      return;
    }

    const sessionRow = await getChatSession(sid);
    const historyRows = sessionRow ? await getChatMessages(sessionRow.id) : [];
    const messages = historyRows
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const content = m.content as Record<string, unknown>;
        return {
          role: m.role as "user" | "assistant",
          content: (content.text as string) ?? "",
          timestamp: m.created_at,
        };
      });

    let reauth: { embedUrl: string; transactionId: string } | undefined;
    if (session.authIdAccountNumber && session.structuredContext.identity?.confirmed) {
      try {
        const txn = await createVerifiedTransaction({ accountNumber: session.authIdAccountNumber });
        const embedUrl = buildVerifiedEmbedUrl(txn.TransactionId, txn.OneTimeSecret);
        reauth = { embedUrl, transactionId: txn.TransactionId };
        session.pendingAuthIdProof = {
          embedUrl,
          operationId: txn.TransactionId,
          mode: "verified",
        };
        await updateSession(session);
      } catch (err) {
        console.error("Verified create failed during rehydrate:", err);
      }
    }

    res.json({
      session: {
        sessionId: session.sessionId,
        currentState: session.currentState,
        structuredContext: session.structuredContext,
        channel: session.channel,
        walkInLocationId: session.walkInLocationId,
        betaTesterEmail: session.betaTesterEmail,
        pendingAuthIdProof: session.pendingAuthIdProof,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      },
      messages,
      reauth,
    });
  } catch (err) {
    console.error("Rehydrate error:", err);
    res.status(500).json({ error: "Failed to rehydrate session" });
  }
});

// GET /chatbot/debug/session-logs/:sessionId
// Returns the full ordered stream of debug-log events for a session so any
// operator can reproduce the conversation's backend behavior given only the
// session id.
app.get("/chatbot/debug/session-logs/:sessionId", debugGate, async (req, res) => {
  try {
    const sid = String(req.params.sessionId);
    const sessionRow = await getChatSession(sid);
    if (!sessionRow) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const allMessages = await getChatMessages(sessionRow.id);
    const logs = allMessages
      .filter((m) => m.role === "system" && (m.content as Record<string, unknown>).eventType)
      .map((m) => {
        const content = m.content as Record<string, unknown>;
        return {
          timestamp: (content.timestamp as string) ?? m.created_at,
          eventType: content.eventType as string,
          payload: content.payload,
        };
      });
    res.json({
      sessionId: sid,
      count: logs.length,
      logs,
    });
  } catch (err) {
    console.error("Debug logs fetch error:", err);
    res.status(500).json({ error: "Failed to fetch debug logs" });
  }
});

// GET /chatbot/hot-buttons
app.get("/chatbot/hot-buttons", async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query<{ label: string; prompt: string }>(
      `SELECT label, prompt FROM hotbuttons ORDER BY sort_order`,
    );
    res.json(result.rows.map((r) => ({ label: r.label, transactionTypeId: r.prompt })));
  } catch (err) {
    console.error("Failed to load hot buttons:", err);
    res.json([]);
  }
});

// GET /chatbot/all-transactions
// Returns every active transaction with a one-click natural-language phrase.
app.get("/chatbot/all-transactions", async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query<{
      txn_type_id: string;
      name: string;
      description: string | null;
    }>(
      `SELECT txn_type_id, name, description
       FROM transaction_types
       WHERE status = 'active' AND office_id IS NULL
       ORDER BY name`,
    );
    const out = result.rows.map((r) => {
      const desc = r.description
        ? (JSON.parse(r.description) as {
            commonPhrases?: string[];
            summary?: string;
            category?: string;
          })
        : null;
      const phrases = desc?.commonPhrases ?? [];
      return {
        txnTypeId: r.txn_type_id,
        name: r.name,
        category: desc?.category ?? "Other",
        opener: phrases[0] ?? `I need help with ${r.name.toLowerCase()}`,
        summary: desc?.summary,
      };
    });
    res.json(out);
  } catch (err) {
    console.error("Failed to load all transactions:", err);
    res.status(500).json({ error: "Failed to load transactions" });
  }
});

// GET /chatbot/debug/trees?txnTypeIds=cdl,dl-transfer
// Returns decision trees + the fact definitions they reference. Used by the
// frontend debug panel to visualize branch state. Dev/debug only — safe to
// expose because trees and fact defs are authored, not customer data.
//
// SEC-16: deliberately NOT behind debugGate. Unlike /debug/session-logs (raw
// Bedrock payloads with citizen PII), this returns only AUTHORED content
// (decision trees + fact defs) and is consumed by the beta tester DebugPanel
// in the deployed SPA. It's already gated by the beta token + API key. Gating
// it to 404 would break a shipped tester feature for no PII benefit.
app.get("/chatbot/debug/trees", async (req, res) => {
  try {
    const { loadDecisionTrees } = await import("./data-loaders/decision-trees.js");
    const { loadFactDefinitions } = await import("./data-loaders/fact-definitions.js");

    const requested = String(req.query.txnTypeIds || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const allTrees = loadDecisionTrees();
    const trees =
      requested.length === 0
        ? [...allTrees.values()]
        : requested.map((id) => allTrees.get(id)).filter((t): t is NonNullable<typeof t> => !!t);

    // Collect every factKey referenced by factsRequired + branch `when` keys.
    const neededKeys = new Set<string>();
    for (const t of trees) {
      for (const fk of t.factsRequired) neededKeys.add(fk);
      for (const b of t.branches) for (const fk of Object.keys(b.when)) neededKeys.add(fk);
    }

    const allDefs = loadFactDefinitions();
    const factDefinitions = allDefs.filter((d) => neededKeys.has(d.factKey));

    res.json({ trees, factDefinitions });
  } catch (err) {
    console.error("Debug trees error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /chatbot/sessions/:sessionId/unresolved-facts
// Returns the facts the bot still needs to answer (in priority order) with
// each fact's allowedValues + valueLabels. Used by Playwright tests to send
// realistic answers + by frontend chips for previewing the next question.
app.get("/chatbot/sessions/:sessionId/unresolved-facts", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const activeIds = session.structuredContext.transactions
      .filter((t) => t.status === "active")
      .map((t) => t.txnTypeId);
    const requiredKeys = collectRequiredFactKeysForActiveTxns(activeIds);

    const { loadFactDefinitions } = await import("./data-loaders/fact-definitions.js");
    const defsByKey = new Map(loadFactDefinitions().map((d) => [d.factKey, d]));
    const facts = session.structuredContext.facts;

    const unresolved = [...requiredKeys]
      .map((k: string) => {
        const fv = facts[k];
        const def = defsByKey.get(k);
        if (!def) return null;
        if (fv && fv.confidence !== "unknown") return null;
        return {
          factKey: k,
          label: def.label,
          questionText: def.questionText,
          allowedValues: def.allowedValues,
          valueLabels: def.valueLabels,
        };
      })
      .filter((x: unknown): x is NonNullable<typeof x> => x !== null);

    res.json({
      sessionId: session.sessionId,
      state: session.currentState,
      unresolvedFacts: unresolved,
    });
  } catch (err) {
    console.error("Unresolved-facts fetch error:", err);
    res.status(500).json({ error: "Failed to fetch unresolved facts" });
  }
});

// POST /chatbot/sessions/:sessionId/upload-url
app.post("/chatbot/sessions/:sessionId/upload-url", async (req, res) => {
  try {
    const { documentType, filename } = req.body;
    if (!documentType || !filename) {
      res.status(400).json({ error: "documentType and filename required" });
      return;
    }
    const result = await generateUploadUrl(TENANT_ID, req.params.sessionId, documentType, filename);
    res.json(result);
  } catch (err) {
    console.error("Upload URL error:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// POST /chatbot/sessions/:sessionId/confirm-identity
app.post("/chatbot/sessions/:sessionId/confirm-identity", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "verify-identity") {
      res.status(400).json({ error: `Cannot confirm identity in state: ${session.currentState}` });
      return;
    }
    session.structuredContext.identity = {
      name: req.body.name || "",
      dob: req.body.dob || "",
      address: req.body.address || "",
      confirmed: true,
    };
    // Re-resolve trees if the official DOB overwrote a self-reported age fact.
    const changedByIdentity = inferFactsFromIdentity(session);
    if (changedByIdentity.length > 0) {
      await handleRecordFactsTool("record_facts", { facts: [] }, session);
      await handleResolveFactsTool("resolve_decision_trees", {}, session);
    }
    const transition = advanceState(session);
    cascadeAutoAdvance(session);
    await updateSession(session);
    res.json({
      previousState: transition.previousState,
      newState: session.currentState,
      identity: session.structuredContext.identity,
    });
  } catch (err) {
    console.error("Confirm identity error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/authid-result
// Polls AuthID for the in-flight Proof transaction's result, applies the
// decision matrix, and either holds the session in verify-identity (reject)
// or populates structuredContext.identity from extracted DL fields and
// advances state (pass / review).
app.post("/chatbot/sessions/:sessionId/authid-result", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "verify-identity") {
      res
        .status(400)
        .json({ error: `Cannot accept AuthID result in state ${session.currentState}` });
      return;
    }
    if (!session.authIdOperationId) {
      res.status(400).json({ error: "No in-flight AuthID transaction" });
      return;
    }

    const POLL_INTERVAL_MS = 2000;
    const POLL_MAX_ATTEMPTS = 30;
    let status = 0;
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i += 1) {
      const s = await getOperationStatus(session.authIdOperationId);
      status = s.Status;
      if (status === 1) break;
      if (status > 1) {
        res.status(200).json({ status: "authid-failed", authIdStatus: status });
        return;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (status !== 1) {
      res.status(504).json({ error: "Timed out waiting for AuthID result" });
      return;
    }

    const raw = await getProofResult(session.authIdOperationId);
    const decision = decide(raw);
    const extracted = extractIdentity(raw);

    session.authIdProofResult = {
      operationId: session.authIdOperationId,
      decision: decision.outcome,
      failureReasons: decision.reasons,
      matchedAt: new Date().toISOString(),
    };
    session.authIdOperationId = undefined;
    session.pendingAuthIdProof = undefined;

    if (decision.outcome === "reject") {
      await updateSession(session);
      res.status(200).json({
        status: "rejected",
        reasons: decision.reasons,
        sessionState: session.currentState,
      });
      return;
    }

    session.structuredContext.identity = {
      name: extracted.fullName ?? "",
      dob: extracted.dateOfBirth ?? "",
      address: extracted.address ?? "",
      confirmed: true,
    };
    // AuthID's DL is source-of-truth for the DOB-derived age facts; this may
    // overwrite what the customer self-reported during resolve-facts. Re-run
    // implications + tree resolution so any reopened branch / changed bucket /
    // new block is reflected before the customer reaches confirm-facts.
    const changedByIdentity = inferFactsFromIdentity(session);
    if (changedByIdentity.length > 0) {
      await handleRecordFactsTool("record_facts", { facts: [] }, session);
      await handleResolveFactsTool("resolve_decision_trees", {}, session);
    }
    advanceState(session);
    cascadeAutoAdvance(session);
    await updateSession(session);

    // The new state may be autoGreet-flagged (resolve-facts is). Run one
    // Bedrock round under its prompt so the bot's first question is in the
    // response — frontend splices it straight into the chat instead of
    // making the customer type a dummy turn to advance.
    let greeting: string | null = null;
    try {
      greeting = await runAutoGreet(TENANT_ID, session);
      if (greeting) await updateSession(session);
    } catch (err) {
      console.error("AuthID post-success autoGreet failed:", err);
    }

    res.json({
      status: decision.outcome,
      reasons: decision.reasons,
      identity: session.structuredContext.identity,
      sessionState: session.currentState,
      greeting: greeting ?? undefined,
    });
  } catch (err) {
    console.error("AuthID result error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/skip-verify
// Customer chose "Skip For Now" at the verify-identity gate. Advances past
// verify-identity without an AuthID proof, flags incomplete pre-work, and
// auto-greets the next state so the conversation continues (mirrors the
// AuthID-success path, minus the identity write).
app.post("/chatbot/sessions/:sessionId/skip-verify", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "verify-identity") {
      res.status(400).json({ error: `Cannot skip verify in state ${session.currentState}` });
      return;
    }

    // Identity not verified — clear any in-flight proof + flag the visit so the
    // clerk knows to verify at the counter.
    session.incompletePreWork = true;
    session.authIdOperationId = undefined;
    session.pendingAuthIdProof = undefined;
    advanceState(session);
    cascadeAutoAdvance(session);
    await updateSession(session);

    let greeting: string | null = null;
    try {
      greeting = await runAutoGreet(TENANT_ID, session);
      if (greeting) await updateSession(session);
    } catch (err) {
      console.error("Skip-verify autoGreet failed:", err);
    }

    res.json({
      status: "skipped",
      sessionState: session.currentState,
      greeting: greeting ?? undefined,
    });
  } catch (err) {
    console.error("Skip-verify error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /chatbot/sessions/:sessionId/scheduling/slot
// Proxies to the scheduling service for ONE offered slot for the session's
// active transactions. Degrades gracefully when scheduling is unconfigured.
app.get("/chatbot/sessions/:sessionId/scheduling/slot", async (req, res) => {
  try {
    if (!schedulingEnabled()) {
      res.json({ schedulable: false, unavailable: true });
      return;
    }
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const chatbotTxnIds = session.structuredContext.transactions
      .filter((t) => t.status === "active")
      .map((t) => t.txnTypeId);
    const result = await findSlot({ chatbotTxnIds });
    res.json(result);
  } catch (err) {
    console.error("Scheduling slot error:", err);
    res.status(502).json({ error: "scheduling-unreachable" });
  }
});

// POST /chatbot/sessions/:sessionId/scheduling/book
// Body: { officeId, date, time, firstName, lastName, email, phone }
app.post("/chatbot/sessions/:sessionId/scheduling/book", async (req, res) => {
  try {
    if (!schedulingEnabled()) {
      res.status(400).json({ error: "scheduling-disabled" });
      return;
    }
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "schedule") {
      res.status(400).json({ error: `Cannot book in state ${session.currentState}` });
      return;
    }
    const { officeId, date, time, firstName, lastName, email, phone } = req.body ?? {};
    if (!officeId || !date || !time || !firstName || !lastName || !email || !phone) {
      res
        .status(400)
        .json({ error: "Required: officeId, date, time, firstName, lastName, email, phone" });
      return;
    }
    const chatbotTxnIds = session.structuredContext.transactions
      .filter((t) => t.status === "active")
      .map((t) => t.txnTypeId);

    let result;
    try {
      result = await book({
        chatbotTxnIds,
        officeId,
        date,
        time,
        firstName,
        lastName,
        email,
        phone,
      });
    } catch (err) {
      if ((err as { code?: string }).code === "SLOT_TAKEN") {
        res.status(409).json({ error: "slot-taken" });
        return;
      }
      throw err;
    }

    // Record the booking on the session (reuses the existing scheduling shape).
    session.structuredContext.scheduling = {
      selectedSlot: {
        slotId: `${result.slot.officeId}#${result.slot.date}#${result.slot.time}`,
        locationId: String(result.slot.officeId),
        locationName:
          result.slot.officeName ||
          session.structuredContext.scheduling?.selectedSlot?.locationName ||
          "",
        date: result.slot.date,
        startTime: result.slot.time,
        endTime: result.slot.time,
      },
      appointmentId: String(result.appointmentId),
      qrCodeUrl: "",
    };
    await updateSession(session);

    res.json({
      status: "booked",
      appointmentId: result.appointmentId,
      qrCode: result.qrCode,
      scheduling: session.structuredContext.scheduling,
    });
  } catch (err) {
    console.error("Scheduling book error:", err);
    res.status(502).json({ error: "scheduling-unreachable" });
  }
});

// POST /chatbot/sessions/:sessionId/edit-facts
// User edits one or more facts during the confirm-facts review. Re-runs
// implications cascade + decision tree resolution. Returns the post-edit
// facts, resolved buckets, and any factKeys that are now unresolved (e.g.
// a branch was opened by the edit that requires a new answer).
app.post("/chatbot/sessions/:sessionId/edit-facts", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "confirm-facts") {
      res.status(400).json({ error: `Cannot edit facts in state: ${session.currentState}` });
      return;
    }
    const edits = req.body.edits as Array<{ factKey: string; value: string }> | undefined;
    if (!Array.isArray(edits) || edits.length === 0) {
      res.status(400).json({ error: "edits[] is required" });
      return;
    }

    // Snapshot transactions that were NOT already blocked so we can tell the
    // frontend which transactions got blocked as a direct consequence of this
    // edit (vs. transactions that were already blocked on a prior turn).
    const alreadyBlockedIds = new Set(
      session.structuredContext.transactions
        .filter((t) => t.status === "blocked")
        .map((t) => t.txnTypeId),
    );

    // Overwrite each edited fact via the standard record_facts handler. It
    // validates against fact-definitions.json + runs applyImplications. Clearing
    // any previously-inferred fact for the same key first, because applyImplications
    // only writes when a fact is missing.
    for (const e of edits) {
      delete session.structuredContext.facts[e.factKey];
    }
    const recordResult = await handleRecordFactsTool(
      "record_facts",
      {
        facts: edits.map((e) => ({
          factKey: e.factKey,
          value: e.value,
          confidence: "asserted",
          source: "user-message",
        })),
      },
      session,
    );

    // Clear downstream inferred facts whose implication chain may have changed.
    // Simpler policy: drop every 'inferred' fact not in the edits list and let
    // applyImplications rebuild them on the next record_facts call.
    const editedKeys = new Set(edits.map((e) => e.factKey));
    for (const [k, v] of Object.entries(session.structuredContext.facts)) {
      if (v.source === "inference" && !editedKeys.has(k)) {
        delete session.structuredContext.facts[k];
      }
    }
    // One more pass to re-infer anything the new edits imply.
    await handleRecordFactsTool("record_facts", { facts: [] }, session);

    // Re-resolve the decision tree with the new fact state.
    await handleResolveFactsTool("resolve_decision_trees", {}, session);

    // Compute newly-unresolved keys (keys the tree needs that aren't known).
    const activeIds = session.structuredContext.transactions
      .filter((t) => t.status === "active")
      .map((t) => t.txnTypeId);
    const requiredKeys = collectRequiredFactKeysForActiveTxns(activeIds);
    const newlyUnresolved: string[] = [];
    for (const k of requiredKeys) {
      const fact = session.structuredContext.facts[k];
      if (!fact || fact.confidence === "unknown") newlyUnresolved.push(k);
    }

    await updateSession(session);

    const recordJson = JSON.parse((recordResult.content as Array<{ text: string }>)[0].text);

    // Any transaction that is now blocked but wasn't before this call is a
    // direct consequence of the edit — those are the ones the UI flags loudly.
    const newHardBlocks = session.structuredContext.transactions
      .filter(
        (t) => t.status === "blocked" && !alreadyBlockedIds.has(t.txnTypeId) && t.blockingInfo,
      )
      .map((t) => ({
        txnTypeId: t.txnTypeId,
        name: t.name,
        blockingInfo: t.blockingInfo!,
      }));

    res.json({
      status: "ok",
      facts: session.structuredContext.facts,
      resolvedBuckets: session.structuredContext.resolvedBuckets,
      transactions: session.structuredContext.transactions,
      newlyUnresolved,
      newHardBlocks,
      rejected: recordJson.rejected || [],
    });
  } catch (err) {
    console.error("Edit facts error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/confirm-facts
// User accepts the reviewed facts and advances to the next state. Optionally
// triggers a transcript email.
app.post("/chatbot/sessions/:sessionId/confirm-facts", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "confirm-facts") {
      res.status(400).json({ error: `Cannot confirm facts in state: ${session.currentState}` });
      return;
    }

    // Gate: every required fact must be known.
    const activeIds = session.structuredContext.transactions
      .filter((t) => t.status === "active")
      .map((t) => t.txnTypeId);
    const requiredKeys = collectRequiredFactKeysForActiveTxns(activeIds);
    const newlyUnresolved: string[] = [];
    for (const k of requiredKeys) {
      const fact = session.structuredContext.facts[k];
      if (!fact || fact.confidence === "unknown") newlyUnresolved.push(k);
    }
    if (newlyUnresolved.length > 0) {
      res.status(400).json({ error: "unresolved-facts", newlyUnresolved });
      return;
    }

    // Optional email dispatch — fire-and-forget so a slow SES call doesn't
    // block the state advance. Validated via simple regex.
    const emailOptIn = req.body.emailOptIn as { address?: string } | undefined;
    if (emailOptIn?.address) {
      const addr = emailOptIn.address.trim();
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
        sendTranscriptForSession(TENANT_ID, session.sessionId, addr).catch((err) =>
          console.error("Async transcript send failed:", err),
        );
      }
    }

    const transition = advanceState(session);
    cascadeAutoAdvance(session);
    await updateSession(session);
    res.json({ previousState: transition.previousState, newState: session.currentState });
  } catch (err) {
    console.error("Confirm facts error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/message-feedback
// Beta-tester clicks Good / Bad / Comment under a specific assistant message.
// Idempotent on (sessionId, messageId, reaction).
app.post("/chatbot/sessions/:sessionId/message-feedback", async (req, res) => {
  try {
    const { messageId, reaction, comment } = req.body || {};
    if (typeof messageId !== "string" || messageId.length === 0) {
      res.status(400).json({ error: "messageId required" });
      return;
    }
    if (reaction !== "good" && reaction !== "bad" && reaction !== "comment") {
      res.status(400).json({ error: "reaction must be good | bad | comment" });
      return;
    }
    if (reaction === "comment" && (typeof comment !== "string" || comment.trim().length === 0)) {
      res.status(400).json({ error: "comment required when reaction is comment" });
      return;
    }
    await appendMessageFeedback(TENANT_ID, req.params.sessionId, {
      messageId,
      reaction,
      comment: typeof comment === "string" ? comment : undefined,
    });
    res.json({ status: "ok" });
  } catch (err) {
    console.error("Message feedback error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/feedback
// Tester clicks "Submit Transcript" in the debug panel: bundles freeform notes
// + a snapshot of all per-message reactions for support triage.
app.post("/chatbot/sessions/:sessionId/feedback", async (req, res) => {
  try {
    const { notes, messageFeedback, capturedAt } = req.body || {};
    const sid = req.params.sessionId;
    const session = await getSession(TENANT_ID, sid);
    const factsCount = session?.structuredContext.facts
      ? Object.keys(session.structuredContext.facts).length
      : 0;
    const result = await appendSessionFeedback(TENANT_ID, sid, {
      notes: typeof notes === "string" ? notes : "",
      messageFeedback:
        messageFeedback && typeof messageFeedback === "object" ? messageFeedback : {},
      capturedAt: typeof capturedAt === "string" ? capturedAt : new Date().toISOString(),
      stateSnapshot: {
        state: session?.currentState,
        transactions: session?.structuredContext.transactions,
        factsCount,
      },
      betaTesterEmail: session?.betaTesterEmail ?? req.betaEmail,
    });
    res.json({ status: "ok", submissionSk: result.submissionSk });
  } catch (err) {
    console.error("Session feedback error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/transcript-pdf
// Builds a downloadable PDF: cover, transcript, facts, transactions, debug log.
app.post("/chatbot/sessions/:sessionId/transcript-pdf", async (req, res) => {
  try {
    const sid = req.params.sessionId;
    const session = await getSession(TENANT_ID, sid);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const { notes, messageFeedback, messages: clientMessages } = req.body || {};

    // Prefer client-supplied messages because they carry the per-turn
    // messageId needed to attach feedback comments inline. Fall back to the
    // server's chat_messages table for sessions where the client list is missing.
    let messages: Array<{
      role: "user" | "assistant";
      content: string;
      timestamp?: string;
      messageId?: string;
    }>;
    if (Array.isArray(clientMessages) && clientMessages.length > 0) {
      messages = clientMessages.map((m: Record<string, unknown>) => ({
        role: m.role === "user" ? "user" : "assistant",
        content: typeof m.content === "string" ? m.content : "",
        timestamp: typeof m.timestamp === "string" ? m.timestamp : undefined,
        messageId: typeof m.messageId === "string" ? m.messageId : undefined,
      }));
    } else {
      const sessionRow = await getChatSession(sid);
      const allMsgs = sessionRow ? await getChatMessages(sessionRow.id) : [];
      messages = allMsgs
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          const c = m.content as Record<string, unknown>;
          return {
            role: m.role as "user" | "assistant",
            content: (c.text as string) ?? "",
            timestamp: m.created_at,
          };
        });
    }
    const pdfSessionRow = await getChatSession(sid);
    const allPdfMsgs = pdfSessionRow ? await getChatMessages(pdfSessionRow.id) : [];
    const debugLogs = allPdfMsgs
      .filter((m) => m.role === "system" && (m.content as Record<string, unknown>).eventType)
      .map((m) => {
        const c = m.content as Record<string, unknown>;
        return {
          timestamp: (c.timestamp as string) ?? m.created_at,
          eventType: c.eventType as string,
          payload: c.payload,
        };
      });
    const pdf = await buildTranscriptPdf({
      session,
      messages,
      debugLogs,
      notes: typeof notes === "string" ? notes : undefined,
      messageFeedback:
        messageFeedback && typeof messageFeedback === "object" ? messageFeedback : undefined,
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="transcript-${sid}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("Transcript PDF error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/send-transcript
// Idempotent — can be invoked from confirm-facts or a later button.
app.post("/chatbot/sessions/:sessionId/send-transcript", async (req, res) => {
  try {
    const to = String(req.body.to || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res.status(400).json({ error: 'valid "to" email required' });
      return;
    }
    const result = await sendTranscriptForSession(TENANT_ID, req.params.sessionId, to);
    res.json(result);
  } catch (err) {
    console.error("Send transcript error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /chatbot/sessions/:sessionId/skip
app.post("/chatbot/sessions/:sessionId/skip", async (req, res) => {
  try {
    const { stateName } = req.body;
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const result = doSkipState(session, stateName);
    await updateSession(session);
    res.json({
      previousState: result.previousState,
      newState: result.newState,
      warning: result.warning,
    });
  } catch (err) {
    console.error("Skip state error:", err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /chatbot/prescreening — SMS pre-screening completion
app.post("/chatbot/prescreening", async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const session = await getSession(TENANT_ID, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (answers && typeof answers === "object") {
      for (const [key, value] of Object.entries(answers)) {
        session.structuredContext.preScreening.answers[key] = {
          questionKey: key,
          answer: String(value),
          blocked: false,
          appliedToTxnTypes: session.structuredContext.transactions
            .filter((t: { status: string }) => t.status === "active")
            .map((t: { txnTypeId: string }) => t.txnTypeId),
        };
      }
    }
    session.structuredContext.preScreening.completedTxnTypes =
      session.structuredContext.transactions
        .filter((t: { status: string }) => t.status === "active")
        .map((t: { txnTypeId: string }) => t.txnTypeId);
    if (session.currentState === "pre-screen") advanceState(session);
    await updateSession(session);
    res.json({
      status: "complete",
      sessionId,
      state: session.currentState,
      message: "Pre-screening complete.",
    });
  } catch (err) {
    console.error("Prescreening error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// --- Legacy /api/* routes (backwards compat with vanilla JS frontend) ---

// GET /api/hot-buttons — read from PostgreSQL
app.get("/api/hot-buttons", async (_req, res) => {
  try {
    const pool = getPool();
    const result = await pool.query<{ label: string; prompt: string }>(
      `SELECT label, prompt FROM hotbuttons ORDER BY sort_order`,
    );
    res.json(result.rows.map((r) => ({ label: r.label, transactionTypeId: r.prompt })));
  } catch (err) {
    console.error("Failed to load hot buttons:", err);
    res.json([]);
  }
});

// GET /api/session/:sessionId — session-state polling
app.get("/api/session/:sessionId", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({
      sessionId: session.sessionId,
      state: session.currentState,
      structuredContext: session.structuredContext,
      incompletePreWork: session.incompletePreWork,
    });
  } catch (err) {
    console.error("Session fetch error:", err);
    res.status(500).json({ error: "Failed to fetch session" });
  }
});

// POST /api/chat — process message (backwards-compatible with existing frontend)
app.post("/api/chat", async (req, res) => {
  try {
    const { sessionId: existingSessionId, message } = req.body;

    if (!message || message.trim().length === 0) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    // Create session if needed
    let sessionId = existingSessionId;
    if (!sessionId) {
      const session = await createSession({
        tenantId: TENANT_ID,
        channel: "web",
      });
      sessionId = session.sessionId;
    }

    // Process message through state machine
    const result = await processMessage(TENANT_ID, sessionId, message);

    // Build response compatible with existing frontend
    const activeTransactions = result.structuredContext.transactions
      .filter((t: { status: string }) => t.status === "active")
      .map((t: { txnTypeId: string; name: string; durationMinutes: number }) => ({
        txnTypeId: t.txnTypeId,
        name: t.name,
        durationMinutes: t.durationMinutes,
        documentSummary: "",
      }));

    const totalDuration = activeTransactions.reduce(
      (sum: number, t: { durationMinutes: number }) => sum + t.durationMinutes,
      0,
    );

    // Deduplicate documents from active transactions
    const seen = new Set<string>();
    const combinedDocuments: string[] = [];
    for (const doc of result.structuredContext.documents) {
      if (!seen.has(doc.documentType)) {
        seen.add(doc.documentType);
        combinedDocuments.push(doc.documentType);
      }
    }

    res.json({
      sessionId,
      message: result.message,
      identifiedTransactions: activeTransactions,
      combinedDocuments,
      state: result.state,
      totalDurationMinutes: totalDuration,
    });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({
      error: "An error occurred processing your message. Please try again.",
    });
  }
});

// POST /api/session/:sessionId/skip — skip optional state
app.post("/api/session/:sessionId/skip", async (req, res) => {
  try {
    const { stateName } = req.body;
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    const result = doSkipState(session, stateName);
    await updateSession(session);

    res.json({
      previousState: result.previousState,
      newState: result.newState,
      warning: result.warning,
    });
  } catch (err) {
    console.error("Skip state error:", err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/session/:sessionId/upload-url — generate presigned URL
app.post("/api/session/:sessionId/upload-url", async (req, res) => {
  try {
    const { documentType, filename } = req.body;
    if (!documentType || !filename) {
      res.status(400).json({ error: "documentType and filename required" });
      return;
    }
    const result = await generateUploadUrl(TENANT_ID, req.params.sessionId, documentType, filename);
    res.json(result);
  } catch (err) {
    console.error("Upload URL error:", err);
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

// POST /api/session/:sessionId/confirm-identity — confirm OCR results
app.post("/api/session/:sessionId/confirm-identity", async (req, res) => {
  try {
    const session = await getSession(TENANT_ID, req.params.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (session.currentState !== "verify-identity") {
      res.status(400).json({ error: `Cannot confirm identity in state: ${session.currentState}` });
      return;
    }
    session.structuredContext.identity = {
      name: req.body.name || "",
      dob: req.body.dob || "",
      address: req.body.address || "",
      confirmed: true,
    };
    // Re-resolve trees if the official DOB overwrote a self-reported age fact.
    const changedByIdentity = inferFactsFromIdentity(session);
    if (changedByIdentity.length > 0) {
      await handleRecordFactsTool("record_facts", { facts: [] }, session);
      await handleResolveFactsTool("resolve_decision_trees", {}, session);
    }
    const transition = advanceState(session);
    cascadeAutoAdvance(session);
    await updateSession(session);
    res.json({
      previousState: transition.previousState,
      newState: session.currentState,
      identity: session.structuredContext.identity,
    });
  } catch (err) {
    console.error("Confirm identity error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/chatbot/prescreening — SMS pre-screening completion (walk-in flow)
app.post("/api/chatbot/prescreening", async (req, res) => {
  try {
    const { sessionId, answers } = req.body;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const session = await getSession(TENANT_ID, sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Record answers
    if (answers && typeof answers === "object") {
      for (const [key, value] of Object.entries(answers)) {
        session.structuredContext.preScreening.answers[key] = {
          questionKey: key,
          answer: String(value),
          blocked: false,
          appliedToTxnTypes: session.structuredContext.transactions
            .filter((t: { status: string }) => t.status === "active")
            .map((t: { txnTypeId: string }) => t.txnTypeId),
        };
      }
    }

    // Mark complete
    session.structuredContext.preScreening.completedTxnTypes =
      session.structuredContext.transactions
        .filter((t: { status: string }) => t.status === "active")
        .map((t: { txnTypeId: string }) => t.txnTypeId);

    if (session.currentState === "pre-screen") {
      advanceState(session);
    }

    await updateSession(session);

    console.log(`[STUB] Auto-queue for session ${sessionId}`);
    console.log(`[STUB] Queue confirmation SMS for session ${sessionId}`);

    res.json({
      status: "complete",
      sessionId,
      state: session.currentState,
      message: "Pre-screening complete. You have been placed in the queue.",
    });
  } catch (err) {
    console.error("Prescreening complete error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});
