/**
 * Admin dashboard Express app — read-only view over the chatbot's
 * PostgreSQL tables. Mirror of services/chatbot/src/local-server-app.ts:
 * exports an `app` (no listen call) so it can be served by both the local
 * dev launcher (admin/src/local-server.ts) and the Lambda handler
 * (admin/src/handlers/express-app.handler.ts).
 *
 * Auth uses ADMIN_PASSWORD + ADMIN_AUTH_SECRET env vars and an HMAC token
 * in `Authorization: Bearer <token>`. In dev (env vars unset) auth is
 * a no-op so `npm run dev` works without secrets.
 */

import "dotenv/config";
import express from "express";
import {
  isAuthEnabled,
  checkPassword,
  issueToken,
  verifyToken,
  isValidEmail,
  normalizeEmail,
} from "./auth/admin-auth.js";
import { getSummary } from "./queries/summary.js";
import { listSessions } from "./queries/list-sessions.js";
import { getSessionDetail } from "./queries/get-session.js";
import { setSessionReviewed } from "./queries/set-reviewed.js";

declare module "express-serve-static-core" {
  interface Request {
    adminEmail?: string;
  }
}

export const app = express();

app.use(express.json());

// Open CORS — admin SPA lives on a different CloudFront distribution from the
// API. Same shape as the chatbot service.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, x-api-key, X-Api-Key",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  next();
});

// Health check (public, no auth) — used by the deploy smoke test.
app.get("/admin/health", (_req, res) => {
  res.json({ ok: true, authEnabled: isAuthEnabled() });
});

// Login — same shape as the chatbot's. Returns a bearer token tied to the
// admin's email so the dashboard can attribute who triggered which view.
app.post("/admin/auth/login", (req, res) => {
  if (!isAuthEnabled()) {
    const email = normalizeEmail(req.body?.email ?? "dev@local");
    return res.json({ token: "dev-no-auth", email });
  }
  const email = normalizeEmail(req.body?.email ?? "");
  const password = String(req.body?.password ?? "");
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: "Invalid email format." });
  }
  if (!checkPassword(password)) {
    return res.status(401).json({ error: "Wrong password." });
  }
  const token = issueToken(email);
  return res.json({ token, email });
});

const PUBLIC_ROUTES = new Set(["/admin/auth/login", "/admin/health"]);

app.use((req, res, next) => {
  if (!isAuthEnabled()) return next();
  if (req.method === "OPTIONS") return next();
  if (PUBLIC_ROUTES.has(req.path)) return next();
  if (!req.path.startsWith("/admin/")) return next();

  const auth = req.header("authorization") ?? req.header("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) {
    return res.status(401).json({ error: "Sign in to continue." });
  }
  const token = auth.slice(7).trim();
  const verified = verifyToken(token);
  if (!verified) {
    return res.status(401).json({ error: "Your session expired. Please sign in again." });
  }
  req.adminEmail = verified.email;
  // SEC-05 sliding expiry: re-issue past half-life, return via response header.
  if (verified.needsRefresh) {
    res.setHeader("X-Refreshed-Token", issueToken(verified.email));
    res.setHeader("Access-Control-Expose-Headers", "X-Refreshed-Token");
  }
  next();
});

// --- Routes ---

app.get("/admin/summary", async (_req, res) => {
  try {
    const summary = await getSummary();
    res.json(summary);
  } catch (err) {
    console.error("[admin] summary error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/admin/sessions", async (req, res) => {
  try {
    const result = await listSessions({
      limit: parseIntOr(req.query.limit, undefined),
      hasFeedback: req.query.hasFeedback === "1" || req.query.hasFeedback === "true",
      hasBad: req.query.hasBad === "1" || req.query.hasBad === "true",
      hasSubmission: req.query.hasSubmission === "1" || req.query.hasSubmission === "true",
      state: typeof req.query.state === "string" ? req.query.state : undefined,
      email: typeof req.query.email === "string" ? req.query.email : undefined,
      includeTestSessions:
        req.query.includeTestSessions === "1" || req.query.includeTestSessions === "true",
    });
    res.json(result);
  } catch (err) {
    console.error("[admin] sessions error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/admin/sessions/:id", async (req, res) => {
  try {
    const detail = await getSessionDetail(req.params.id);
    if (!detail) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json(detail);
  } catch (err) {
    console.error("[admin] session detail error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// Admin triage: mark a session reviewed / not-reviewed. The dashboard's only
// write. Targeted single-attribute update — see set-reviewed.ts.
app.patch("/admin/sessions/:id/reviewed", async (req, res) => {
  try {
    const reviewed = req.body?.reviewed;
    if (typeof reviewed !== "boolean") {
      return res.status(400).json({ error: "reviewed (boolean) is required" });
    }
    const result = await setSessionReviewed(req.params.id, reviewed);
    if (!result.ok) {
      return res.status(404).json({ error: "Session not found" });
    }
    res.json({ ok: true, sessionId: req.params.id, reviewed });
  } catch (err) {
    console.error("[admin] set-reviewed error:", err);
    res.status(500).json({ error: (err as Error).message });
  }
});

function parseIntOr(v: unknown, fallback: number | undefined): number | undefined {
  if (typeof v !== "string") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}
