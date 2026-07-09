/**
 * Admin dashboard Express app — read-only view over the chatbot's
 * PostgreSQL tables. Auth uses Cognito JWT verification, requiring
 * membership in the "admin" group.
 */

import "dotenv/config";
import express from "express";
import { isAuthEnabled, requireAdmin } from "./auth/admin-auth.js";
import { getSummary } from "./queries/summary.js";
import { listSessions } from "./queries/list-sessions.js";
import { getSessionDetail } from "./queries/get-session.js";
import { setSessionReviewed } from "./queries/set-reviewed.js";

export const app = express();

app.use(express.json());

// Path normalization: API Gateway stage 'api' adds a prefix to the path.
// CloudFront routes /api/admin/* to this API, so the Lambda receives paths like
// /admin/admin/... when Express expects /admin/... Strip the /admin prefix
// when running in Lambda (detected by presence of ORIGIN_SECRET env var).
// This middleware must run BEFORE route registration.
if (process.env.ORIGIN_SECRET) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/admin/")) {
      req.url = req.url.replace(/^\/admin/, "");
    }
    next();
  });
}

// Origin-secret gate: reject direct API Gateway access (must come through CloudFront).
const ORIGIN_SECRET = process.env.ORIGIN_SECRET;
if (ORIGIN_SECRET) {
  app.use((req, res, next) => {
    if (req.method === "OPTIONS") return next();
    if (req.headers["x-origin-secret"] === ORIGIN_SECRET) return next();
    res.status(403).json({ error: "Forbidden" });
  });
}

// Open CORS — admin SPA lives on a different CloudFront distribution from the
// API. Same shape as the chatbot service.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
  next();
});

// Health check (public, no auth) — used by the deploy smoke test.
app.get("/admin/health", (_req, res) => {
  res.json({ ok: true, authEnabled: isAuthEnabled() });
});

// All /admin/* routes (except health) require Cognito "admin" group.
app.use("/admin", requireAdmin());

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
