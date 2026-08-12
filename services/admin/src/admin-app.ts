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

// Path normalization: CloudFront forwards the matched viewer path unchanged.
// Its Admin behavior is /api/admin/* and the SPA requests /api/admin/admin/*,
// while Express routes are rooted at /admin/*. Remove only the CloudFront
// prefix when running in Lambda (detected by ORIGIN_SECRET). Retain the legacy
// /admin/admin/* form to keep direct API Gateway stage requests compatible.
// This middleware must run BEFORE route registration.
if (process.env.ORIGIN_SECRET) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin/")) {
      req.url = req.url.replace(/^\/api\/admin/, "");
    } else if (req.path.startsWith("/admin/")) {
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

// --- Terminal handlers (must stay LAST, after every route registered above) ---
//
// Not deletable boilerplate. A request that matches no route above — or that
// throws outside a route's own try/catch — otherwise reaches Express's built-in
// finalhandler, whose send() calls on-finished(req, …) → ee-first, which does
// `socket.on("error", …)` on req.socket. Under @codegenie/serverless-express the
// request is an http.IncomingMessage built over a PLAIN OBJECT stand-in for the
// socket, so that call throws `TypeError: ee.on is not a function` and the
// handler never produces the intended 404/500 JSON. The status the client ends
// up with depends on where the throw surfaces; for this service the deployed
// observation was a 500 HTML page containing that TypeError (GET
// /api/admin/health, which the prefix rewrite above turns into /health, a path
// no route claims). The chatbot service's identical crash was measured as an
// opaque 502 through CloudFront/API Gateway, so don't rely on a specific code.
// A real Node socket IS an EventEmitter, so `npm run dev` never reproduces it.
// Answering here with res.status().json() keeps finalhandler unreachable.

// Unmatched path. OPTIONS gets a 204 rather than a 404 because this middleware
// runs ahead of Express's automatic OPTIONS/Allow reply and would otherwise
// swallow it — the 204 carries the Access-Control-* headers set above.
// Scope: UNMATCHED paths only. An OPTIONS to a guarded /admin/* path is
// answered earlier by requireAdmin() (line ~61), which — unlike the chatbot
// service's auth middleware — has no OPTIONS pass-through, so it 401s a
// preflight. Not a live problem: post-deploy config.json gives the admin SPA a
// RELATIVE adminApiUrl ("/api/admin") served by the same CloudFront
// distribution as the SPA, and `npm run dev` goes through the Vite proxy, so
// the browser treats admin API calls as same-origin and issues no preflight.
app.use((req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  res.status(404).json({ error: "Not found" });
});

// Four parameters = Express error handler. The arity is load-bearing (three
// would register an ordinary middleware), so `_req` stays even though unused.
app.use(
  (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error("[admin] unhandled request error:", err);
    if (res.headersSent) {
      // Already streaming a response; only Express can abort it now. Safe to
      // delegate: finalhandler's headers-sent branch just calls
      // req.socket.destroy(), which the mock socket does implement.
      next(err);
      return;
    }
    // Client faults arrive pre-tagged (express.json() marks a malformed body
    // 400) — keep that status, collapse everything else to 500. The error text
    // and stack stay in the log above; the response body says nothing specific.
    const tagged = err as { status?: number; statusCode?: number };
    const status = tagged.status ?? tagged.statusCode ?? 500;
    const clientFault = status >= 400 && status < 500;
    res
      .status(clientFault ? status : 500)
      .json({ error: clientFault ? "Bad request" : "Internal server error" });
  },
);
