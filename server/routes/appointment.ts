import { Router } from "express";
import { pool, withTransaction } from "../db.js";
import { ses, s3, EMAIL, BASE_URL, DEFAULT_DATE, DOCUMENTS_BUCKET } from "../config.js";
import {
  lookupByConfirmationCode,
  lookupByName,
  getAppointmentInfo,
  checkInToQueue,
  setAppointmentPriority,
} from "../../src/check-in.js";
import { getRequiredDocsStatus, validateDocument, uploadDocument } from "../../src/documents.js";
import { setIdentityVerified } from "../../src/identity.js";
import { getPrescreenQuestions, savePrescreenResponses } from "../../src/prescreen.js";
import { buildPrescreenLinkEmail, sendEmail } from "../../src/email.js";
import { sendError } from "../middleware/errors.js";

const router = Router();

// ─── GET /api/config ─────────────────────────────────────────────────────────
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
    sendError(res, err, "appointment");
  }
});

// ─── GET /api/schedule/appointments ─────────────────────────────────────────
router.get("/schedule/appointments", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    if (isNaN(officeId) || !startDate || !endDate) {
      return res.status(400).json({ error: "officeId, startDate, endDate required" });
    }

    const result = await pool.query(
      `SELECT a.id, a.office_id, a.appointment_date::text, a.appointment_time::text AS start_time,
              a.txn_type_ids, a.first_name, a.last_name, a.status,
              (SELECT SUM(tt.avg_duration_min)
               FROM unnest(a.txn_type_ids) AS tid
               JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL) AS duration_min
       FROM appointments a
       WHERE a.office_id = $1
         AND a.appointment_date BETWEEN $2 AND $3
         AND a.status NOT IN ('cancelled', 'no_show')
       ORDER BY a.appointment_date, a.appointment_time`,
      [officeId, startDate, endDate],
    );
    res.json(result.rows);
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/schedule/reschedule ──────────────────────────────────────────
router.post("/schedule/reschedule", async (req, res) => {
  try {
    const { appointmentId, newDate, newTime, force } = req.body;
    if (!appointmentId || !newDate || !newTime) {
      return res.status(400).json({ error: "appointmentId, newDate, newTime required" });
    }

    const result = await withTransaction(async (client) => {
      const apptRes = await client.query(
        `SELECT id, office_id, txn_type_ids FROM appointments
         WHERE id = $1 AND status NOT IN ('cancelled', 'no_show')`,
        [appointmentId],
      );
      if (apptRes.rows.length === 0) {
        return { success: false, error: "appointment_not_found" };
      }
      const appt = apptRes.rows[0];

      await client.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [
        appointmentId,
      ]);

      if (!force) {
        const durRes = await client.query(
          `SELECT SUM(tt.avg_duration_min)::int AS duration
           FROM unnest($1::int[]) AS tid
           JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL`,
          [appt.txn_type_ids],
        );
        const duration = durRes.rows[0]?.duration || 0;

        const capRes = await client.query(
          `SELECT validate_slot($1, $2::date, $3::time, $4, $5) AS available`,
          [appt.office_id, newDate, newTime, appt.txn_type_ids, duration],
        );
        const available = capRes.rows[0]?.available || 0;
        if (available <= 0) {
          await client.query(`UPDATE appointments SET status = 'scheduled' WHERE id = $1`, [
            appointmentId,
          ]);
          return { success: false, error: "capacity_exceeded" };
        }
      }

      await client.query(
        `UPDATE appointments SET appointment_date = $2, appointment_time = $3, status = 'scheduled'
         WHERE id = $1`,
        [appointmentId, newDate, newTime],
      );
      return { success: true };
    });

    res.json(result);
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/lookup (by confirmation code) ─────────────────────────────────
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
    sendError(res, err, "lookup");
  }
});

// ─── POST /api/lookup-by-id ──────────────────────────────────────────────────
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
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/search-name ───────────────────────────────────────────────────
router.post("/search-name", async (req, res) => {
  try {
    const query = String(req.body?.query ?? "").trim();
    const officeId = parseInt(req.body?.officeId) || 1;
    const date = req.body?.date || DEFAULT_DATE;
    if (!query) return res.status(400).json({ error: "query required" });

    const results = await lookupByName(pool, query, officeId, date);
    res.json(results);
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/verify-identity ───────────────────────────────────────────────
router.post("/verify-identity", async (req, res) => {
  try {
    const appointmentId = parseInt(req.body?.appointmentId);
    if (!appointmentId) return res.status(400).json({ error: "appointmentId required" });
    await setIdentityVerified(pool, appointmentId);
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/validate-document ─────────────────────────────────────────────
router.post("/validate-document", async (req, res) => {
  try {
    const documentId = parseInt(req.body?.documentId);
    if (!documentId) return res.status(400).json({ error: "documentId required" });
    await validateDocument(pool, documentId);
    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/upload-document (base64 body → S3) ────────────────────────────
// Promoted to exercise src/documents.ts uploadDocument against the configured
// S3 bucket. For large files the production path is a presigned PUT (see
// /api/upload-url); this inline path stays for the demo's small samples.
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

router.post("/upload-document", async (req, res) => {
  try {
    const { appointmentId, docId, name, contentType, dataBase64 } = req.body ?? {};
    if (!appointmentId || !name || !dataBase64) {
      return res.status(400).json({ error: "appointmentId, name, dataBase64 required" });
    }
    const resolvedType = contentType ?? "application/octet-stream";
    if (!ALLOWED_CONTENT_TYPES.has(resolvedType)) {
      return res.status(400).json({ error: "File type not allowed. Accepted: pdf, jpg, png" });
    }
    if (!DOCUMENTS_BUCKET) {
      return res.status(503).json({ error: "DOCUMENTS_BUCKET not configured" });
    }
    const fileBuffer = Buffer.from(dataBase64, "base64");
    if (fileBuffer.length > MAX_FILE_SIZE) {
      return res.status(400).json({ error: "File exceeds 5MB limit" });
    }
    const result = await uploadDocument(s3, DOCUMENTS_BUCKET, pool, {
      appointmentId,
      docId: docId ?? null,
      name,
      fileBuffer,
      contentType: resolvedType,
    });
    res.json({ ok: true, ...result });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/check-in ──────────────────────────────────────────────────────
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
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/walk-in (create appointment + check in) ───────────────────────
router.post("/walk-in", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, txns, officeId, prescreen, priority, notes } =
      req.body;
    if (!firstName || !lastName || !txns?.length || !officeId)
      return res.status(400).json({ error: "firstName, lastName, txns, and officeId required" });

    const { rows: txnRows } = await pool.query(
      `SELECT id, txn_type_id FROM transaction_types
       WHERE txn_type_id = ANY($1) AND (office_id IS NULL OR office_id = $2)`,
      [txns, officeId],
    );
    const txnTypeIds = txnRows.map((r: { id: number }) => r.id);
    if (!txnTypeIds.length) return res.status(400).json({ error: "No valid transaction types" });

    const txnDocMap: Record<string, string[]> = {
      road_test: ["learner_permit", "photo_id", "vision_cert", "vehicle_reg", "insurance_card"],
      id_card: ["birth_cert", "proof_address", "ssn_proof"],
      license_original: ["learner_permit", "photo_id", "proof_address", "ssn_proof"],
    };
    const seen = new Set<string>();
    const requiredDocs: string[] = [];
    for (const row of txnRows) {
      for (const d of txnDocMap[(row as { txn_type_id: string }).txn_type_id] || []) {
        if (!seen.has(d)) {
          seen.add(d);
          requiredDocs.push(d);
        }
      }
    }
    const { rows } = await pool.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, required_doc_ids, appointment_date, appointment_time,
        status, is_walk_in, prescreen_completed
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        officeId,
        firstName,
        lastName,
        email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@walkin.local`,
        phone || "",
        txnTypeIds,
        requiredDocs,
        DEFAULT_DATE,
        "09:00",
        "scheduled",
        true,
        !!prescreen,
      ],
    );
    const appointmentId = rows[0].id;

    if (priority) {
      await setAppointmentPriority(pool, appointmentId, true);
    }

    if (!prescreen) {
      // Auto check-in happens after the customer completes prescreen in lobby.
      return res.json({ ok: true, appointmentId, pendingPrescreen: true });
    }

    const result = await checkInToQueue(pool, officeId, appointmentId, notes || undefined);
    res.json({ ok: true, appointmentId, queueId: result.queueId, queueNumber: result.queueNumber });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/send-prescreen ────────────────────────────────────────────────
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
    const placeholder = `${BASE_URL}/prescreen/${confirmationCode}`;
    const html = emailInput.html.replaceAll(placeholder, prescreenUrl);
    const text = emailInput.text.replaceAll(placeholder, prescreenUrl);
    await sendEmail(ses, { ...emailInput, html, text });

    res.json({ ok: true, prescreenUrl, sentTo: toEmail });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── GET /api/prescreen/:confirmationCode (load questions) ───────────────────
router.get("/prescreen/:confirmationCode", async (req, res) => {
  try {
    const match = await lookupByConfirmationCode(pool, req.params.confirmationCode);
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
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/prescreen/:confirmationCode/submit (auto check-in if flagged) ─
router.post("/prescreen/:confirmationCode/submit", async (req, res) => {
  try {
    const match = await lookupByConfirmationCode(pool, req.params.confirmationCode);
    if (!match) return res.status(404).json({ error: "Appointment not found" });

    const responses: Record<string, boolean> = req.body?.responses || {};
    await savePrescreenResponses(pool, match.appointmentId, responses);

    const autoCheckIn: boolean = req.body?.autoCheckIn || false;
    const priority: boolean = req.body?.priority || false;

    if (autoCheckIn) {
      if (priority) {
        await setAppointmentPriority(pool, match.appointmentId, true);
      }
      const queueResult = await checkInToQueue(
        pool,
        match.officeId,
        match.appointmentId,
        undefined,
      );
      return res.json({ ok: true, checkedIn: true, queueNumber: queueResult.queueNumber });
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

export default router;
