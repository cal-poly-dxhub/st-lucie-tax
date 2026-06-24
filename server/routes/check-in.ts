import { Router } from "express";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { pool, withTransaction } from "../db.js";
import {
  lookupByConfirmationCode,
  lookupByName,
  getAppointmentInfo,
  checkInToQueue,
  setAppointmentPriority,
} from "../../src/check-in.js";
import { getRequiredDocsStatus, validateDocument } from "../../src/documents.js";
import { setIdentityVerified } from "../../src/identity.js";
import { buildPrescreenLinkEmail, sendEmail } from "../../src/email.js";

const router = Router();

const REGION = process.env.AWS_REGION ?? "us-west-2";
const EMAIL = process.env.EMAIL ?? "njriley@calpoly.edu";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const DEFAULT_DATE = "2026-06-24";

const ses = new SESv2Client({ region: REGION });

// ─── GET /api/config (offices, txn types, lunch shifts, office hours) ────────
router.get("/config", async (_req, res) => {
  try {
    const data = await withTransaction(async (client) => {
      const offices = await client.query(
        `SELECT id, name, total_desks, run_rate_pct FROM offices ORDER BY id`,
      );
      const txnTypes = await client.query(
        `SELECT id, txn_type_id AS slug, name, avg_duration_min AS duration,
                available_from::text, available_until::text, status
         FROM transaction_types
         WHERE office_id IS NULL
         ORDER BY id`,
      );
      const lunchShifts = await client.query(
        `SELECT id, office_id, shift_num, start_time::text, end_time::text
         FROM office_lunch_shifts
         ORDER BY office_id, start_time`,
      );
      const officeHours = await client.query(
        `SELECT office_id, day_of_week, open_time::text, close_time::text
         FROM office_hours`,
      );
      return {
        offices: offices.rows,
        txnTypes: txnTypes.rows,
        lunchShifts: lunchShifts.rows,
        officeHours: officeHours.rows,
        demoDate: DEFAULT_DATE,
      };
    });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/lookup (by confirmation code) ─────────────────────────────────
// Wires lookupByConfirmationCode → getAppointmentInfo → getRequiredDocsStatus.
router.post("/lookup", async (req, res) => {
  try {
    const confirmationCode = String(req.body?.confirmationCode ?? "").trim();
    if (!confirmationCode) return res.status(400).json({ error: "confirmationCode required" });

    const match = await lookupByConfirmationCode(pool, confirmationCode);
    if (!match) return res.json({ found: false });

    const [info, docs] = await Promise.all([
      getAppointmentInfo(pool, match.appointmentId),
      getRequiredDocsStatus(pool, match.appointmentId),
    ]);

    res.json({
      found: true,
      appointmentId: match.appointmentId,
      confirmationCode,
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

// ─── POST /api/lookup-by-id (loads full record like QR lookup) ───────────────
router.post("/lookup-by-id", async (req, res) => {
  try {
    const appointmentId = parseInt(req.body?.appointmentId);
    if (!appointmentId) return res.status(400).json({ error: "appointmentId required" });

    const { rows: apptRows } = await pool.query(
      `SELECT office_id, status, confirmation_code FROM appointments WHERE id = $1`,
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
      confirmationCode: apptRows[0].confirmation_code,
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

// ─── POST /api/search-name (backed by lookupByName) ──────────────────────────
router.post("/search-name", async (req, res) => {
  try {
    const query = String(req.body?.query ?? "").trim();
    const officeId = parseInt(req.body?.officeId) || 1;
    const date = req.body?.date || DEFAULT_DATE;
    if (!query) return res.status(400).json({ error: "query required" });

    const results = await lookupByName(pool, query, officeId, date);
    res.json(results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/verify-identity (backed by setIdentityVerified) ───────────────
router.post("/verify-identity", async (req, res) => {
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

// ─── POST /api/validate-document (backed by validateDocument) ────────────────
router.post("/validate-document", async (req, res) => {
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

// ─── POST /api/check-in (setAppointmentPriority if priority + checkInToQueue) ─
router.post("/check-in", async (req, res) => {
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

// ─── POST /api/send-prescreen (buildPrescreenLinkEmail + sendEmail) ──────────
router.post("/send-prescreen", async (req, res) => {
  try {
    const appointmentId = req.body?.appointmentId;
    let toEmail = EMAIL;
    let firstName = "there";
    let confirmationCode = "DEMO1234";

    if (appointmentId) {
      const { rows } = await pool.query(
        `SELECT first_name, contact_email, confirmation_code FROM appointments WHERE id = $1`,
        [appointmentId],
      );
      if (rows.length) {
        firstName = rows[0].first_name;
        toEmail = rows[0].contact_email;
        confirmationCode = rows[0].confirmation_code;
      }
    }

    const autoCheckIn = req.body?.autoCheckIn || false;
    const priority = req.body?.priority || false;
    let prescreenUrl = `${BASE_URL}/prescreen/${confirmationCode}`;
    if (autoCheckIn) {
      prescreenUrl += `?autoCheckIn=1${priority ? "&priority=1" : ""}`;
    }

    const emailInput = buildPrescreenLinkEmail({
      recipientEmail: toEmail,
      firstName,
      confirmationCode,
      baseUrl: BASE_URL,
      fromEmail: EMAIL,
    });
    // Override the URL in the email with the one that has query params.
    const html = emailInput.html.replace(
      new RegExp(`${BASE_URL}/prescreen/${confirmationCode}`, "g"),
      prescreenUrl,
    );
    const text = emailInput.text.replace(
      new RegExp(`${BASE_URL}/prescreen/${confirmationCode}`, "g"),
      prescreenUrl,
    );
    await sendEmail(ses, { ...emailInput, html, text });

    res.json({ ok: true, prescreenUrl, sentTo: toEmail });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-prescreen error:", msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
