import { Router } from "express";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pool } from "../db.js";
import { s3, DOCUMENTS_BUCKET } from "../config.js";
import { sendSummonEmail } from "../notify.js";
import { clerkLogin, setClerkAvailability } from "../../src/clerk-session.js";
import { assignNextCustomer } from "../../src/queue.js";
import {
  getClerkServiceRecord,
  sendToWrittenTest,
  completeWrittenTest,
} from "../../src/service-clerk.js";
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
    const { queueId, testStationId, clerkId, officeId } = req.body;
    if (!queueId || !testStationId || !clerkId || !officeId)
      return res.status(400).json({ error: "queueId, testStationId, clerkId, officeId required" });
    await sendToWrittenTest(pool, { queueId, testStationId, clerkId, officeId });
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/complete-test ──────────────────────────────────────────
router.post("/clerk/complete-test", async (req, res) => {
  try {
    const { queueId } = req.body;
    if (!queueId) return res.status(400).json({ error: "queueId required" });
    await completeWrittenTest(pool, queueId);
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/clerk/record-step ────────────────────────────────────────────
router.post("/clerk/record-step", async (req, res) => {
  try {
    const { queueId, step } = req.body;
    if (!queueId || !step) return res.status(400).json({ error: "queueId and step required" });
    const { rows } = await pool.query(
      `UPDATE queue SET steps = COALESCE(steps, '{}'::jsonb) || jsonb_build_object($2::text, 'true'::jsonb)
       WHERE id = $1
       RETURNING steps`,
      [queueId, step],
    );
    if (!rows.length) return res.status(404).json({ error: "Queue entry not found" });
    res.json({ ok: true, steps: rows[0].steps });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── GET /api/clerk/document-url/:documentId ─────────────────────────────────
router.get("/clerk/document-url/:documentId", async (req, res) => {
  try {
    const documentId = parseInt(req.params.documentId);
    if (!documentId) return res.status(400).json({ error: "documentId required" });

    const { rows } = await pool.query(`SELECT s3_key, name FROM documents WHERE id = $1`, [
      documentId,
    ]);
    if (!rows.length || !rows[0].s3_key) {
      return res.status(404).json({ error: "Document not found or no file uploaded" });
    }
    if (!DOCUMENTS_BUCKET) {
      // Local dev: serve file directly from the local uploads directory
      const url = `/uploads/${rows[0].s3_key}`;
      res.json({ url, name: rows[0].name, local: true });
      return;
    }

    const disposition = req.query.disposition === "attachment" ? "attachment" : "inline";
    const command = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: rows[0].s3_key,
      ResponseContentDisposition: `${disposition}; filename="${rows[0].name}"`,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 300 }); // 5-minute expiry

    res.json({ url, name: rows[0].name });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── POST /api/seed-queue (demo helper) ─────────────────────────────────────
router.post("/seed-queue", async (req, res) => {
  const firstNames = [
    "James",
    "Mary",
    "Robert",
    "Patricia",
    "John",
    "Jennifer",
    "Michael",
    "Linda",
    "David",
    "Elizabeth",
    "William",
    "Barbara",
    "Richard",
    "Susan",
    "Joseph",
    "Jessica",
  ];
  const lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Hernandez",
    "Lopez",
    "Gonzalez",
    "Wilson",
    "Anderson",
    "Thomas",
  ];
  const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

  try {
    // Use office 1 by default; callers can pass officeId in the body
    const officeId = (req.body.officeId as number) || 1;

    // Pick a random active transaction type for each seeded customer
    const { rows: txnTypes } = await pool.query<{ id: number }>(
      `SELECT id FROM transaction_types WHERE office_id IS NULL AND status = 'active'`,
    );
    if (txnTypes.length === 0) {
      return res.status(400).json({ error: "No active transaction types found" });
    }

    const seeded = [];
    for (let i = 0; i < 5; i++) {
      const firstName = pick(firstNames);
      const lastName = pick(lastNames);
      const txnId = pick(txnTypes).id;

      // Create a walk-in appointment for today
      const { rows: apptRows } = await pool.query<{ id: number }>(
        `INSERT INTO appointments (office_id, first_name, last_name, contact_email, contact_phone,
           txn_type_ids, appointment_date, status, is_walk_in)
         VALUES ($1, $2, $3, $4, $5, ARRAY[$6::INT], CURRENT_DATE, 'scheduled', TRUE)
         RETURNING id`,
        [
          officeId,
          firstName,
          lastName,
          `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
          "772-555-" + String(Math.floor(Math.random() * 10000)).padStart(4, "0"),
          txnId,
        ],
      );
      const appointmentId = apptRows[0].id;

      // Check them into the queue
      const { rows } = await pool.query<{ id: number; queue_number: number }>(
        `SELECT check_in_to_queue($1, $2, NULL) AS id`,
        [officeId, appointmentId],
      );
      const queueId = rows[0].id;
      const qRow = await pool.query<{ queue_number: number }>(
        `SELECT queue_number FROM queue WHERE id = $1`,
        [queueId],
      );
      seeded.push({ id: queueId, queue_number: qRow.rows[0].queue_number });
    }
    res.json({ ok: true, seeded });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

// ─── GET /api/live-queue ────────────────────────────────────────────────────
router.get("/live-queue", async (_req, res) => {
  try {
    const queue = await pool.query(`
      SELECT q.id, q.queue_number, q.status, q.assigned_desk,
             a.confirmation_code, a.is_priority, a.first_name, a.last_name,
             a.txn_type_ids, q.checked_in_at
      FROM queue q
      JOIN appointments a ON a.id = q.appointment_id
      WHERE q.status IN ('waiting', 'serving', 'testing')
      ORDER BY
        CASE WHEN a.is_priority THEN 0 ELSE 1 END,
        q.checked_in_at
    `);
    const clerks = await pool.query(`
      SELECT cs.desk_number, cs.is_available,
             c.first_name || ' ' || c.last_name AS name
      FROM clerk_sessions cs
      JOIN clerks c ON c.id = cs.clerk_id
      WHERE cs.logged_out_at IS NULL
      ORDER BY cs.desk_number
    `);
    const txnTypes = await pool.query(
      `SELECT id, txn_type_id AS slug, name, avg_duration_min AS duration, status
       FROM transaction_types WHERE office_id IS NULL ORDER BY id`,
    );
    res.json({ queue: queue.rows, clerks: clerks.rows, txnTypes: txnTypes.rows });
  } catch (err: unknown) {
    sendError(res, err, "queue");
  }
});

export default router;
