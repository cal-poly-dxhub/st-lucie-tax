import express from "express";
import { join } from "node:path";
import { SERVICE, DOCUMENTS_BUCKET } from "./config.js";
import appointmentRouter, { publicRouter } from "./routes/appointment.js";
import queueRouter from "./routes/queue.js";
import adminRouter from "./routes/admin.js";
import { requireAuth } from "./middleware/auth.js";

// The same app is deployed as two Lambdas distinguished by SERVICE:
//   SERVICE=appointment → AppointmentFn (citizen/booking + admin config)
//   SERVICE=queue       → QueueFn (in-office queue + service clerk)
// Unset (local dev) mounts everything so one process serves all surfaces.
// The two domains are logically separate so a failure in one does not take
// down the other (separate functions, APIs, concurrency in production).
export const app = express();
app.use(express.json({ limit: "12mb" })); // 10MB doc uploads + base64 overhead

// Serve locally-uploaded documents in dev when no S3 bucket is configured
if (!DOCUMENTS_BUCKET) {
  app.use("/uploads", express.static(join(process.cwd(), "uploads")));
}

const mountAppointment = SERVICE === "appointment" || SERVICE === "all";
const mountQueue = SERVICE === "queue" || SERVICE === "all";

if (mountAppointment) {
  // Public routes first (prescreen, config) — no auth required
  app.use("/api", publicRouter);
  app.use("/api", requireAuth(), appointmentRouter);
  // "ops-admin", not "admin": CloudFront routes /api/admin/* to the Chatbot
  // stack's AdminFn (session review), which would otherwise shadow this router
  // entirely. /api/ops-admin/* falls through to the /api/* office origin.
  app.use("/api/ops-admin", requireAuth("admin"), adminRouter);
}
if (mountQueue) {
  app.use("/api", requireAuth("checkin_clerk", "service_clerk"), queueRouter);
}

app.get("/healthz", (_req, res) => res.json({ ok: true, service: SERVICE }));
