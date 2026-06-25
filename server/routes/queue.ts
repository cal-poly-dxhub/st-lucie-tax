import { Router } from "express";
import { pool } from "../db.js";
import { sendSummonEmail } from "../notify.js";
import { clerkLogin, setClerkAvailability } from "../../src/clerk-session.js";
import { assignNextCustomer } from "../../src/queue.js";
import { getClerkServiceRecord, sendToWrittenTest } from "../../src/service-clerk.js";
import { completeAppointment } from "../../src/complete.js";
import { sendError } from "../middleware/errors.js";

const router = Router();

// ─── GET /api/clerks (list clerks for an office, with skills) ────────────────
router.get("/clerks", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string) || 1;
    const { rows } = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.skill_ids,
              array_agg(tt.name ORDER BY tt.id) FILTER (WHERE tt.id IS NOT NULL) AS skill_names
       FROM clerks c
       LEFT JOIN transaction_types tt ON tt.id = ANY(c.skill_ids)
       WHERE $1 = ANY(c.office_ids) AND c.status = 'active'
       GROUP BY c.id
       ORDER BY c.id`,
      [officeId],
    );
    res.json({ clerks: rows });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/login ───────────────────────────────────────────────────
router.post("/clerk/login", async (req, res) => {
  try {
    const { clerkId, officeId, deskNumber } = req.body;
    if (!clerkId || !officeId || !deskNumber)
      return res.status(400).json({ error: "clerkId, officeId, deskNumber required" });
    const result = await clerkLogin(pool, clerkId, officeId, deskNumber);
    if (!result.ok && result.error === "already_logged_in") {
      await pool.query(
        `UPDATE clerk_sessions SET is_available = TRUE, desk_number = $3
         WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
        [clerkId, officeId, deskNumber],
      );
      return res.json({ ok: true, note: "already_logged_in" });
    }
    if (!result.ok) return res.json({ ok: false, error: result.error });
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/availability ────────────────────────────────────────────
router.post("/clerk/availability", async (req, res) => {
  try {
    const { clerkId, officeId, available } = req.body;
    if (!clerkId || !officeId) return res.status(400).json({ error: "clerkId, officeId required" });
    await setClerkAvailability(pool, clerkId, officeId, available);
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/summon-next ─────────────────────────────────────────────
router.post("/clerk/summon-next", async (req, res) => {
  try {
    const { clerkId, officeId } = req.body;
    if (!clerkId || !officeId) return res.status(400).json({ error: "clerkId, officeId required" });
    const result = await assignNextCustomer(pool, officeId, clerkId);
    if (!result) return res.json({ ok: true, assigned: false });
    await sendSummonEmail(result.queueId);
    res.json({ ok: true, assigned: true, queueId: result.queueId, deskNumber: result.deskNumber });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── GET /api/clerk/serving (current record for a clerk) ─────────────────────
router.get("/clerk/serving", async (req, res) => {
  try {
    const clerkId = parseInt(req.query.clerkId as string);
    const officeId = parseInt(req.query.officeId as string) || 1;
    if (!clerkId) return res.status(400).json({ error: "clerkId required" });

    const { rows } = await pool.query(
      `SELECT q.id AS queue_id FROM queue q
       WHERE q.assigned_clerk_id = $1 AND q.office_id = $2 AND q.status = 'serving'
       LIMIT 1`,
      [clerkId, officeId],
    );
    if (!rows.length) return res.json({ serving: false });

    const record = await getClerkServiceRecord(pool, rows[0].queue_id);

    // Enrich prescreen responses with their question text for the clerk UI.
    const prescreenEntries = Object.entries(record.prescreenResponses);
    let prescreenWithText: { questionId: string; questionText: string; answer: boolean }[] = [];
    if (prescreenEntries.length > 0) {
      const questionIds = prescreenEntries.map(([k]) => parseInt(k)).filter((n) => !isNaN(n));
      if (questionIds.length > 0) {
        const { rows: qRows } = await pool.query(
          `SELECT id, question_text FROM prescreen_questions WHERE id = ANY($1::int[])`,
          [questionIds],
        );
        const textMap = Object.fromEntries(qRows.map((r) => [String(r.id), r.question_text]));
        prescreenWithText = prescreenEntries.map(([k, v]) => ({
          questionId: k,
          questionText: textMap[k] ?? `Question ${k}`,
          answer: v,
        }));
      }
    }

    res.json({ serving: true, record: { ...record, prescreenWithText } });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/complete ────────────────────────────────────────────────
router.post("/clerk/complete", async (req, res) => {
  try {
    const { queueId, clerkId, officeId } = req.body;
    if (!queueId || !clerkId || !officeId)
      return res.status(400).json({ error: "queueId, clerkId, officeId required" });
    const result = await completeAppointment(pool, { officeId, queueId, clerkId });
    res.json({ ok: true, durationSec: result.durationSec });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/complete-and-next ───────────────────────────────────────
// Chains completeAppointment → assignNextCustomer → summon email so the clerk
// finishes one customer and immediately pulls the next.
router.post("/clerk/complete-and-next", async (req, res) => {
  try {
    const { queueId, clerkId, officeId } = req.body;
    if (!queueId || !clerkId || !officeId)
      return res.status(400).json({ error: "queueId, clerkId, officeId required" });

    const completeResult = await completeAppointment(pool, { officeId, queueId, clerkId });
    const nextResult = await assignNextCustomer(pool, officeId, clerkId);
    if (!nextResult) {
      return res.json({
        ok: true,
        completed: true,
        durationSec: completeResult.durationSec,
        next: null,
      });
    }
    await sendSummonEmail(nextResult.queueId);
    const nextRecord = await getClerkServiceRecord(pool, nextResult.queueId);
    res.json({
      ok: true,
      completed: true,
      durationSec: completeResult.durationSec,
      next: nextRecord,
    });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/send-to-test ────────────────────────────────────────────
router.post("/clerk/send-to-test", async (req, res) => {
  try {
    const { queueId, testStationId } = req.body;
    if (!queueId || !testStationId)
      return res.status(400).json({ error: "queueId and testStationId required" });
    await sendToWrittenTest(pool, queueId, testStationId);
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── GET /api/live-queue (lobby display feed) ────────────────────────────────
// Minimal PII: only confirmation code and desk number for the public lobby display.
router.get("/live-queue", async (_req, res) => {
  try {
    const queue = await pool.query(`
      SELECT q.id, q.queue_number, q.status, q.assigned_desk,
             a.confirmation_code
      FROM queue q
      JOIN appointments a ON a.id = q.appointment_id
      WHERE q.status IN ('waiting', 'serving', 'testing')
      ORDER BY q.checked_in_at
    `);
    const clerks = await pool.query(`
      SELECT cs.desk_number, cs.is_available
      FROM clerk_sessions cs
      WHERE cs.logged_out_at IS NULL
      ORDER BY cs.desk_number
    `);
    res.json({ queue: queue.rows, clerks: clerks.rows });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

export default router;
