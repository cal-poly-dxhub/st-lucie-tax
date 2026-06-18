import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import QRCode from "qrcode";
import { pool } from "./db.js";
import {
  lookupByQrCode,
  lookupByName,
  getAppointmentInfo,
  checkInToQueue,
  setAppointmentPriority,
} from "../src/check-in.js";
import { getRequiredDocsStatus, validateDocument } from "../src/documents.js";
import { setIdentityVerified } from "../src/identity.js";
import { getPrescreenQuestions, savePrescreenResponses } from "../src/prescreen.js";
import { getClerkServiceRecord } from "../src/service-clerk.js";
import { completeAppointment } from "../src/complete.js";
import { assignNextCustomer } from "../src/queue.js";
import { clerkLogin, setClerkAvailability } from "../src/clerk-session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const ses = new SESv2Client({ region: "us-west-2" });

const EMAIL = "njriley@calpoly.edu";
const BASE_URL = "http://localhost:3000";

async function sendEmail(input: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}) {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject },
          Body: {
            Html: { Data: input.html },
            Text: { Data: input.text },
          },
        },
      },
    }),
  );
}

// ─── Lookup by QR code (backed entirely by src/) ─────────────────────────────
// Wires lookupByQrCode → getAppointmentInfo → getRequiredDocsStatus.
app.post("/api/lookup", async (req, res) => {
  try {
    const qrCode = String(req.body?.qrCode ?? "").trim();
    if (!qrCode) return res.status(400).json({ error: "qrCode required" });

    const match = await lookupByQrCode(pool, qrCode);
    if (!match) return res.json({ found: false });

    const [info, docs] = await Promise.all([
      getAppointmentInfo(pool, match.appointmentId),
      getRequiredDocsStatus(pool, match.appointmentId),
    ]);

    res.json({
      found: true,
      appointmentId: match.appointmentId,
      officeId: match.officeId,
      status: match.status,
      firstName: info.firstName,
      lastName: info.lastName,
      identityVerified: info.identityVerified,
      prescreenCompleted: info.prescreenCompleted,
      requiredDocIds: info.requiredDocIds,
      docs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("lookup error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ─── Lookup by appointment ID (loads full record like QR lookup) ────────────
app.post("/api/lookup-by-id", async (req, res) => {
  try {
    const appointmentId = parseInt(req.body?.appointmentId);
    if (!appointmentId) return res.status(400).json({ error: "appointmentId required" });

    const { rows: apptRows } = await pool.query(
      `SELECT office_id, status FROM appointments WHERE id = $1`,
      [appointmentId],
    );
    if (!apptRows.length) return res.json({ found: false });

    const [info, docs] = await Promise.all([
      getAppointmentInfo(pool, appointmentId),
      getRequiredDocsStatus(pool, appointmentId),
    ]);

    res.json({
      found: true,
      appointmentId,
      officeId: apptRows[0].office_id,
      status: apptRows[0].status,
      firstName: info.firstName,
      lastName: info.lastName,
      identityVerified: info.identityVerified,
      prescreenCompleted: info.prescreenCompleted,
      requiredDocIds: info.requiredDocIds,
      docs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Search by name (backed by src/check-in.ts → lookupByName) ─────────────
app.post("/api/search-name", async (req, res) => {
  try {
    const query = String(req.body?.query ?? "").trim();
    const officeId = parseInt(req.body?.officeId) || 1;
    const date = req.body?.date || new Date().toISOString().slice(0, 10);
    if (!query) return res.status(400).json({ error: "query required" });

    const results = await lookupByName(pool, query, officeId, date);
    res.json(results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/send-confirmation", async (_req, res) => {
  const qrCode = randomUUID();
  console.log("send-confirmation: qrCode=", qrCode);

  try {
    const { rows } = await pool.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, required_doc_ids, appointment_date, appointment_time,
        qr_code, status, is_walk_in
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        1,
        "Jane",
        "Smith",
        EMAIL,
        "772-555-0001",
        [1],
        ["photo_id", "insurance_card"],
        "2026-06-24",
        "09:30",
        qrCode,
        "scheduled",
        false,
      ],
    );
    const appointmentId = rows[0].id;
    console.log("send-confirmation: appointmentId=", appointmentId);

    const qrDataUrl = await QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: "M",
      width: 200,
    });

    const html = `<p>Hi Jane,</p>
<p>Your appointment is confirmed:</p>
<ul>
  <li><strong>Appointment ID:</strong> ${appointmentId}</li>
  <li><strong>QR Code:</strong> ${qrCode}</li>
  <li><strong>Date:</strong> Tuesday, June 24, 2026</li>
  <li><strong>Time:</strong> 9:30 AM</li>
  <li><strong>Location:</strong> Port St. Lucie (Crosstown Pkwy)</li>
</ul>
<p>Present this QR code at check-in:</p>
<img src="${qrDataUrl}" alt="QR Code" width="200" height="200" />
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

    const text = `Hi Jane,

Your appointment is confirmed:
- Appointment ID: ${appointmentId}
- QR Code: ${qrCode}
- Date: Tuesday, June 24, 2026
- Time: 9:30 AM
- Location: Port St. Lucie (Crosstown Pkwy)

Please present your QR code at check-in.

Thank you,
St. Lucie County Tax Collector`;

    try {
      await sendEmail({
        to: EMAIL,
        from: EMAIL,
        subject: "Appointment Confirmed",
        html,
        text,
      });
    } catch (emailErr: unknown) {
      console.error("Email send failed:", emailErr);
    }

    res.json({ ok: true, qrCode, appointmentId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-confirmation error:", msg);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/send-prescreen", async (req, res) => {
  try {
    const appointmentId = req.body?.appointmentId;
    let toEmail = EMAIL;
    let firstName = "there";
    let qrCode = randomUUID();

    if (appointmentId) {
      const { rows } = await pool.query(
        `SELECT first_name, contact_email, qr_code FROM appointments WHERE id = $1`,
        [appointmentId],
      );
      if (rows.length) {
        firstName = rows[0].first_name;
        toEmail = rows[0].contact_email;
        qrCode = rows[0].qr_code;
      }
    }

    const prescreenUrl = `${BASE_URL}/prescreen/${qrCode}`;

    const html = `<p>Hi ${firstName},</p>
<p>Please complete your pre-screen questions before your appointment:</p>
<p><a href="${prescreenUrl}">${prescreenUrl}</a></p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

    const text = `Hi ${firstName},

Please complete your pre-screen questions before your appointment:
${prescreenUrl}

Thank you,
St. Lucie County Tax Collector`;

    await sendEmail({
      to: toEmail,
      from: EMAIL,
      subject: "Complete Your Pre-Screen Questions",
      html,
      text,
    });

    res.json({ ok: true, prescreenUrl, sentTo: toEmail });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-prescreen error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ─── Sample customers for testing (shows QR codes for lookup) ───────────────
app.get("/api/sample-customers", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.first_name, a.last_name, a.qr_code, a.prescreen_completed,
        a.txn_type_ids,
        array_length(a.required_doc_ids, 1) AS req_docs,
        (SELECT COUNT(*)::int FROM documents d WHERE d.appointment_id = a.id) AS uploaded,
        (SELECT COUNT(*)::int FROM documents d WHERE d.appointment_id = a.id AND d.ai_review_status = 'accept') AS accepted,
        (SELECT COUNT(*)::int FROM documents d WHERE d.appointment_id = a.id AND d.ai_review_status = 'reject') AS rejected
      FROM appointments a
      WHERE a.appointment_date = '2026-05-13' AND a.office_id = 1
      ORDER BY a.id
      LIMIT 12
    `);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Live queue state (reads from queue + clerk_sessions tables) ─────────────
app.get("/api/live-queue", async (_req, res) => {
  try {
    const queue = await pool.query(`
      SELECT q.id, q.queue_number, q.status, q.assigned_desk, q.notes,
             q.checked_in_at, q.served_at,
             a.first_name, a.last_name, a.is_priority, a.txn_type_ids
      FROM queue q
      JOIN appointments a ON a.id = q.appointment_id
      WHERE q.status IN ('waiting', 'serving', 'testing')
      ORDER BY
        CASE WHEN a.is_priority THEN 0 ELSE 1 END,
        q.checked_in_at
    `);
    const clerks = await pool.query(`
      SELECT cs.clerk_id, cs.desk_number, cs.is_available,
             c.first_name || ' ' || LEFT(c.last_name, 1) || '.' AS name,
             c.skill_ids
      FROM clerk_sessions cs
      JOIN clerks c ON c.id = cs.clerk_id
      WHERE cs.logged_out_at IS NULL
      ORDER BY cs.desk_number
    `);
    const txnTypes = await pool.query(
      `SELECT id, name FROM transaction_types WHERE office_id IS NULL ORDER BY id`,
    );
    res.json({ queue: queue.rows, clerks: clerks.rows, txnTypes: txnTypes.rows });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Verify identity (backed by src/identity.ts → setIdentityVerified) ──────
app.post("/api/verify-identity", async (req, res) => {
  try {
    const appointmentId = parseInt(req.body?.appointmentId);
    if (!appointmentId) return res.status(400).json({ error: "appointmentId required" });
    await setIdentityVerified(pool, appointmentId);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Validate document (backed by src/documents.ts → validateDocument) ──────
app.post("/api/validate-document", async (req, res) => {
  try {
    const documentId = parseInt(req.body?.documentId);
    if (!documentId) return res.status(400).json({ error: "documentId required" });
    await validateDocument(pool, documentId);
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Check in to queue (backed by src/check-in.ts → checkInToQueue) ─────────
app.post("/api/check-in", async (req, res) => {
  try {
    const { appointmentId, officeId, notes, priority } = req.body;
    if (!appointmentId || !officeId)
      return res.status(400).json({ error: "appointmentId and officeId required" });
    if (priority) {
      await setAppointmentPriority(pool, appointmentId, true);
    }
    const result = await checkInToQueue(pool, officeId, appointmentId, notes || undefined);
    res.json({ ok: true, queueId: result.queueId, queueNumber: result.queueNumber });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── Prescreen page (served as HTML) ─────────────────────────────────────────
app.get("/prescreen/:qrCode", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "prescreen.html"));
});

// ─── Prescreen API: load questions for an appointment by QR code ─────────────
app.get("/api/prescreen/:qrCode", async (req, res) => {
  try {
    const qrCode = req.params.qrCode;
    const match = await lookupByQrCode(pool, qrCode);
    if (!match) return res.status(404).json({ error: "Appointment not found" });

    const { rows } = await pool.query(
      `SELECT first_name, last_name, txn_type_ids, prescreen_completed FROM appointments WHERE id = $1`,
      [match.appointmentId],
    );
    if (!rows.length) return res.status(404).json({ error: "Appointment not found" });
    const appt = rows[0];

    const questions = await getPrescreenQuestions(pool, appt.txn_type_ids);

    res.json({
      appointmentId: match.appointmentId,
      firstName: appt.first_name,
      lastName: appt.last_name,
      prescreenCompleted: appt.prescreen_completed,
      questions,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Prescreen API: submit responses ─────────────────────────────────────────
app.post("/api/prescreen/:qrCode/submit", async (req, res) => {
  try {
    const qrCode = req.params.qrCode;
    const match = await lookupByQrCode(pool, qrCode);
    if (!match) return res.status(404).json({ error: "Appointment not found" });

    const responses: Record<string, boolean> = req.body?.responses || {};
    await savePrescreenResponses(pool, match.appointmentId, responses);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: login ────────────────────────────────────────────────────
app.post("/api/clerk/login", async (req, res) => {
  try {
    const { clerkId, officeId, deskNumber } = req.body;
    if (!clerkId || !officeId || !deskNumber)
      return res.status(400).json({ error: "clerkId, officeId, deskNumber required" });
    const result = await clerkLogin(pool, clerkId, officeId, deskNumber);
    if (!result.ok && result.error === "already_logged_in") {
      return res.json({ ok: true, note: "already_logged_in" });
    }
    if (!result.ok) return res.json({ ok: false, error: result.error });
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: set availability ────────────────────────────────────────
app.post("/api/clerk/availability", async (req, res) => {
  try {
    const { clerkId, officeId, available } = req.body;
    if (!clerkId || !officeId) return res.status(400).json({ error: "clerkId, officeId required" });
    await setClerkAvailability(pool, clerkId, officeId, available);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: summon next customer ────────────────────────────────────
app.post("/api/clerk/summon-next", async (req, res) => {
  try {
    const { clerkId, officeId } = req.body;
    if (!clerkId || !officeId) return res.status(400).json({ error: "clerkId, officeId required" });
    const result = await assignNextCustomer(pool, officeId, clerkId);
    if (!result) return res.json({ ok: true, assigned: false });
    res.json({ ok: true, assigned: true, queueId: result.queueId, deskNumber: result.deskNumber });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: get current serving record ──────────────────────────────
app.get("/api/clerk/serving", async (req, res) => {
  try {
    const clerkId = parseInt(req.query.clerkId as string);
    const officeId = parseInt(req.query.officeId as string) || 1;
    if (!clerkId) return res.status(400).json({ error: "clerkId required" });

    const { rows } = await pool.query(
      `SELECT q.id AS queue_id FROM queue q
       JOIN clerk_sessions cs ON cs.clerk_id = q.assigned_clerk_id AND cs.office_id = q.office_id
       WHERE q.assigned_clerk_id = $1 AND q.office_id = $2 AND q.status = 'serving'
       LIMIT 1`,
      [clerkId, officeId],
    );
    if (!rows.length) return res.json({ serving: false });

    const record = await getClerkServiceRecord(pool, rows[0].queue_id);
    res.json({ serving: true, record });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: complete appointment ────────────────────────────────────
app.post("/api/clerk/complete", async (req, res) => {
  try {
    const { queueId, clerkId, officeId } = req.body;
    if (!queueId || !clerkId || !officeId)
      return res.status(400).json({ error: "queueId, clerkId, officeId required" });
    const result = await completeAppointment(pool, { officeId, queueId, clerkId });
    res.json({ ok: true, durationSec: result.durationSec });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: complete and summon next ────────────────────────────────
app.post("/api/clerk/complete-and-next", async (req, res) => {
  try {
    const { queueId, clerkId, officeId } = req.body;
    if (!queueId || !clerkId || !officeId)
      return res.status(400).json({ error: "queueId, clerkId, officeId required" });
    const completeResult = await completeAppointment(pool, { officeId, queueId, clerkId });
    const nextResult = await assignNextCustomer(pool, officeId, clerkId);
    if (!nextResult)
      return res.json({
        ok: true,
        completed: true,
        durationSec: completeResult.durationSec,
        next: null,
      });
    const nextRecord = await getClerkServiceRecord(pool, nextResult.queueId);
    res.json({
      ok: true,
      completed: true,
      durationSec: completeResult.durationSec,
      next: nextRecord,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Simulation: reset queue + clerk sessions for clean demo ─────────────────
app.post("/api/sim/reset", async (_req, res) => {
  try {
    await pool.query(`DELETE FROM queue`);
    await pool.query(`DELETE FROM queue_counters`);
    await pool.query(`DELETE FROM clerk_sessions`);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Simulation: log in clerks to desks ─────────────────────────────────────
app.post("/api/sim/login-clerks", async (req, res) => {
  try {
    const { officeId, count } = req.body;
    const oid = officeId || 1;
    const n = count || 3;
    await pool.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [oid]);
    const { rows } = await pool.query(
      `SELECT id FROM clerks WHERE $1 = ANY(office_ids) AND status = 'active' ORDER BY id LIMIT $2`,
      [oid, n],
    );
    const results = [];
    for (let i = 0; i < rows.length; i++) {
      await pool.query(
        `INSERT INTO clerk_sessions (clerk_id, office_id, desk_number, is_available)
         VALUES ($1, $2, $3, TRUE)`,
        [rows[i].id, oid, i + 1],
      );
      results.push({ clerkId: rows[i].id, desk: i + 1 });
    }
    res.json({ ok: true, clerks: results });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Simulation: assign next customer to a specific clerk ───────────────────
app.post("/api/sim/assign", async (req, res) => {
  try {
    const { clerkId, officeId } = req.body;
    const oid = officeId || 1;
    const { rows } = await pool.query(`SELECT assign_next_customer($1, $2) AS queue_id`, [
      oid,
      clerkId,
    ]);
    const queueId = rows[0].queue_id;
    if (!queueId) return res.json({ ok: true, assigned: false });
    const qRow = await pool.query(
      `SELECT q.id AS queue_id, q.queue_number, q.assigned_desk, a.first_name, a.last_name
       FROM queue q JOIN appointments a ON a.id = q.appointment_id WHERE q.id = $1`,
      [queueId],
    );
    res.json({ ok: true, assigned: true, ...qRow.rows[0] });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Simulation: complete a service (mark done, free clerk) ─────────────────
app.post("/api/sim/complete", async (req, res) => {
  try {
    const { queueId, officeId } = req.body;
    const oid = officeId || 1;
    const qRow = await pool.query(`SELECT assigned_clerk_id FROM queue WHERE id = $1`, [queueId]);
    const clerkId = qRow.rows[0]?.assigned_clerk_id;
    await pool.query(`UPDATE queue SET status = 'done' WHERE id = $1`, [queueId]);
    if (clerkId) {
      await pool.query(
        `UPDATE clerk_sessions SET is_available = TRUE WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
        [clerkId, oid],
      );
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const server = app.listen(3000, () => {
  console.log("Prototype server running at http://localhost:3000/prototype.html");
});

server.on("error", (err) => {
  console.error("Server failed to start:", err.message);
  process.exit(1);
});
