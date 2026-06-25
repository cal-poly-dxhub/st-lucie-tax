import express from "express";
import { SERVICE } from "./config.js";
import appointmentRouter from "./routes/appointment.js";
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

const mountAppointment = SERVICE === "appointment" || SERVICE === "all";
const mountQueue = SERVICE === "queue" || SERVICE === "all";

if (mountAppointment) {
  app.use("/api", requireAuth(), appointmentRouter);
  app.use("/api/admin", requireAuth("admin"), adminRouter);
}
if (mountQueue) {
  app.use("/api", requireAuth("checkin_clerk", "service_clerk"), queueRouter);
}

app.get("/healthz", (_req, res) => res.json({ ok: true, service: SERVICE }));
