import { Router } from "express";
import { pool, withTransaction } from "../db.js";
import { ses, s3, EMAIL, FRONTEND_URL, DEFAULT_DATE, DOCUMENTS_BUCKET } from "../config.js";
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
import {
  buildPrescreenLinkEmail,
  buildQrConfirmationEmail,
  buildRescheduleEmail,
  buildCancellationEmail,
  sendEmail,
  formatAppointmentDateTime,
  verifyEmailIdentity,
  checkEmailVerified,
} from "../../src/email.js";
import { findAppointment } from "../../src/find-appt.js";
import { bookAppointment } from "../../src/book-appt.js";
import { sendError } from "../middleware/errors.js";
import { requireAuth } from "../middleware/auth.js";

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
      // Get required base documents per txn type from transaction_flows + document_registry
      const reqDocs = await client.query<{
        txn_type_id: number;
        doc_id: string;
        doc_name: string;
        bucket: string;
      }>(
        `SELECT tf.txn_type_id, dr.doc_id, dr.name AS doc_name, dr.bucket
         FROM transaction_flows tf
         CROSS JOIN LATERAL jsonb_array_elements_text(tf.steps -> 'baseItems') AS item(doc_id)
         JOIN document_registry dr ON dr.doc_id = item.doc_id
         ORDER BY tf.txn_type_id`,
      );
      // Group by txn_type_id
      const docsByTxn = new Map<number, { docId: string; name: string; bucket: string }[]>();
      for (const row of reqDocs.rows) {
        let arr = docsByTxn.get(row.txn_type_id);
        if (!arr) {
          arr = [];
          docsByTxn.set(row.txn_type_id, arr);
        }
        arr.push({ docId: row.doc_id, name: row.doc_name, bucket: row.bucket });
      }
      // Attach requiredDocs to each txn type
      const txnTypesWithDocs = txnTypes.rows.map((row: Record<string, unknown>) => ({
        ...row,
        requiredDocs: docsByTxn.get(row.id as number) ?? [],
      }));
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
        txnTypes: txnTypesWithDocs,
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

    // Send reschedule notification email (fire-and-forget — SES errors don't block response)
    if (result.success) {
      try {
        const info = await pool.query(
          `SELECT a.contact_email, a.first_name, a.confirmation_code, o.name AS office_name
           FROM appointments a
           JOIN offices o ON o.id = a.office_id
           WHERE a.id = $1`,
          [appointmentId],
        );
        const row = info.rows[0];
        if (row?.contact_email) {
          const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(row.confirmation_code)}`;
          const email = buildRescheduleEmail({
            recipientEmail: row.contact_email,
            firstName: row.first_name,
            confirmationCode: row.confirmation_code,
            newDate,
            newTime,
            officeName: row.office_name,
            qrCodeDataUrl: qrDataUrl,
            baseUrl: FRONTEND_URL,
            fromEmail: EMAIL,
          });
          await sendEmail(ses, email);
        }
      } catch (emailErr) {
        console.error("Failed to send reschedule email (non-blocking):", emailErr);
      }
    }

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
// Staff-only: returns full citizen PII by raw numeric ID, which is otherwise
// enumerable. Scoped to roles that legitimately look up walk-ins (check-in
// desk, service clerk, admin) rather than any authenticated user.
router.post(
  "/lookup-by-id",
  requireAuth("admin", "checkin_clerk", "service_clerk"),
  async (req, res) => {
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
  },
);

// ─── POST /api/search-name ───────────────────────────────────────────────────
// Staff-only: same PII exposure rationale as /lookup-by-id above.
router.post(
  "/search-name",
  requireAuth("admin", "checkin_clerk", "service_clerk"),
  async (req, res) => {
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
  },
);

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
    const {
      firstName,
      lastName,
      email,
      phone,
      txns,
      officeId,
      prescreen,
      priority,
      identityVerified,
      notes,
    } = req.body;
    if (!firstName || !lastName || !txns?.length || !officeId)
      return res.status(400).json({ error: "firstName, lastName, txns, and officeId required" });

    const { rows: txnRows } = await pool.query(
      `SELECT id, txn_type_id FROM transaction_types
       WHERE txn_type_id = ANY($1) AND (office_id IS NULL OR office_id = $2)`,
      [txns, officeId],
    );
    const txnTypeIds = txnRows.map((r: { id: number }) => r.id);
    if (!txnTypeIds.length) return res.status(400).json({ error: "No valid transaction types" });

    // Get baseItems from transaction_flows, deduped across all selected txn types
    const { rows: docRows } = await pool.query<{ doc_id: string }>(
      `SELECT DISTINCT item.doc_id
       FROM transaction_flows tf
       CROSS JOIN LATERAL jsonb_array_elements_text(tf.steps -> 'baseItems') AS item(doc_id)
       WHERE tf.txn_type_id = ANY($1::int[])`,
      [txnTypeIds],
    );
    const requiredDocs = docRows.map((r) => r.doc_id);
    const { rows } = await pool.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, required_doc_ids, appointment_date, appointment_time,
        status, is_walk_in, is_priority, prescreen_completed, identity_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id, confirmation_code`,
      [
        officeId,
        firstName,
        lastName,
        email || `${firstName.toLowerCase()}.${lastName.toLowerCase()}@walkin.local`,
        phone || "",
        txnTypeIds,
        requiredDocs,
        DEFAULT_DATE,
        new Date().toLocaleTimeString("en-US", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/New_York",
        }),
        "scheduled",
        true,
        false,
        !!prescreen,
        !!identityVerified,
      ],
    );
    const appointmentId = rows[0].id;

    if (priority) {
      await setAppointmentPriority(pool, appointmentId, true);
    }

    if (!prescreen) {
      // Auto check-in happens after the customer completes prescreen in lobby.
      const confirmationCode = rows[0].confirmation_code;

      // Send prescreen email if the customer provided a real email address
      if (email && !email.endsWith("@walkin.local")) {
        try {
          const prescreenUrl = `${FRONTEND_URL}/prescreen/${confirmationCode}?autoCheckIn=1${priority ? "&priority=1" : ""}`;
          const emailInput = buildPrescreenLinkEmail({
            recipientEmail: email,
            firstName,
            confirmationCode,
            baseUrl: FRONTEND_URL,
            fromEmail: EMAIL,
          });
          const placeholder = `${FRONTEND_URL}/prescreen/${confirmationCode}`;
          const html = emailInput.html.replaceAll(placeholder, prescreenUrl);
          const text = emailInput.text.replaceAll(placeholder, prescreenUrl);
          await sendEmail(ses, { ...emailInput, html, text });
        } catch (emailErr) {
          // Log but don't fail the walk-in registration if email fails
          console.error("Failed to send prescreen email for walk-in:", emailErr);
        }
      }

      return res.json({
        ok: true,
        appointmentId,
        confirmationCode,
        pendingPrescreen: true,
      });
    }

    const result = await checkInToQueue(pool, officeId, appointmentId, notes || undefined);
    res.json({
      ok: true,
      appointmentId,
      confirmationCode: rows[0].confirmation_code,
      queueId: result.queueId,
      queueNumber: result.queueNumber,
    });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/send-confirmation (demo: create appointment + send email) ────
router.post("/send-confirmation", async (req, res) => {
  try {
    const { prescreen, identity, docs } = req.body;

    const docConfigs: Record<string, string[]> = {
      mixed: ["learner_permit", "photo_id"],
      "all-accepted": ["learner_permit", "photo_id", "vision_cert"],
      "all-pending": [],
      none: [],
    };
    const uploadedDocs = docConfigs[docs as string] ?? [];
    const allRequiredDocs = ["learner_permit", "photo_id", "vision_cert"];

    const result = await withTransaction(async (client) => {
      const { rows: txnRows } = await client.query(
        `SELECT id FROM transaction_types WHERE txn_type_id = 'road-test' AND office_id IS NULL LIMIT 1`,
      );
      const txnTypeId = txnRows[0]?.id ?? 1;

      const { rows } = await client.query(
        `INSERT INTO appointments (
          office_id, first_name, last_name, contact_email, contact_phone,
          txn_type_ids, required_doc_ids, appointment_date, appointment_time,
          status, prescreen_completed, identity_verified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id, confirmation_code`,
        [
          1,
          "Jane",
          "Smith",
          EMAIL,
          "",
          [txnTypeId],
          allRequiredDocs,
          DEFAULT_DATE,
          "09:30",
          "scheduled",
          !!prescreen,
          !!identity,
        ],
      );
      const appointmentId = rows[0].id;
      const confirmationCode = rows[0].confirmation_code;

      for (const docId of uploadedDocs) {
        await client.query(
          `INSERT INTO documents (appointment_id, doc_id, name, s3_key, ai_review_status)
           VALUES ($1, $2, $3, $4, 'accept')`,
          [appointmentId, docId, docId.replace(/_/g, " "), `demo/${docId}.pdf`],
        );
      }

      return { confirmationCode };
    });

    res.json({ ok: true, confirmationCode: result.confirmationCode });
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
    let prescreenUrl = `${FRONTEND_URL}/prescreen/${confirmationCode}`;
    if (autoCheckIn) {
      prescreenUrl += `?autoCheckIn=1${priority ? "&priority=1" : ""}`;
    }

    const emailInput = buildPrescreenLinkEmail({
      recipientEmail: toEmail,
      firstName,
      confirmationCode,
      baseUrl: FRONTEND_URL,
      fromEmail: EMAIL,
    });
    const placeholder = `${FRONTEND_URL}/prescreen/${confirmationCode}`;
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

// ─── POST /api/demo-book ────────────────────────────────────────────────────
// Demo self-service: find the best slot, book it, verify email in SES, and
// send the confirmation email — all in one call.
router.post("/demo-book", async (req, res) => {
  try {
    const { firstName, lastName, email, txnTypeIds, officeId, preferredTime, preferredDow } =
      req.body;
    if (!firstName || !lastName || !email || !txnTypeIds?.length) {
      return res
        .status(400)
        .json({ error: "firstName, lastName, email, and txnTypeIds are required" });
    }

    // Determine required docs for the selected transactions
    const { rows: docRows } = await pool.query<{ doc_id: string }>(
      `SELECT DISTINCT item.doc_id
       FROM transaction_flows tf
       CROSS JOIN LATERAL jsonb_array_elements_text(tf.steps -> 'baseItems') AS item(doc_id)
       WHERE tf.txn_type_id = ANY($1::int[])`,
      [txnTypeIds],
    );
    const requiredDocs = docRows.map((r) => r.doc_id);

    // Find the best available slot — search from tomorrow onward
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() + 1);

    const slot = await findAppointment(pool, {
      targetTxns: txnTypeIds,
      asap: !preferredTime && preferredDow == null,
      preferredOffice: officeId ?? null,
      preferredDow: preferredDow ?? null,
      preferredTime: preferredTime ?? null,
      startDate,
      days: 30,
    });

    if (!slot) {
      return res.status(409).json({ error: "no_available_slots" });
    }

    // Book the appointment
    const bookResult = await bookAppointment(pool, {
      officeId: slot.officeId,
      date: slot.slotDate,
      time: slot.slotTime,
      txnTypeIds,
      requiredDocIds: requiredDocs,
      firstName,
      lastName,
      contactEmail: email,
      contactPhone: "",
    });

    if (!bookResult.ok) {
      return res.status(409).json({ error: bookResult.error });
    }

    // Get office name for the email
    const { rows: officeRows } = await pool.query<{ name: string }>(
      `SELECT name FROM offices WHERE id = $1`,
      [slot.officeId],
    );
    const officeName = officeRows[0]?.name ?? "St. Lucie County";

    // Format date/time for email
    const { dateStr, timeStr } = formatAppointmentDateTime(slot.slotDate, slot.slotTime);

    // Verify email in SES (non-fatal if already verified)
    try {
      await verifyEmailIdentity(email, ses);
    } catch (sesErr: unknown) {
      console.error("SES verify failed (non-fatal):", sesErr);
    }

    // Build and send confirmation email with QR code
    const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(bookResult.confirmationCode)}`;
    const emailInput = buildQrConfirmationEmail({
      recipientEmail: email,
      firstName,
      confirmationCode: bookResult.confirmationCode,
      appointmentDate: dateStr,
      appointmentTime: timeStr,
      officeName,
      qrCodeDataUrl: qrDataUrl,
      baseUrl: FRONTEND_URL,
      fromEmail: EMAIL,
    });
    let emailSent = false;
    try {
      await sendEmail(ses, emailInput);
      emailSent = true;
    } catch (emailErr: unknown) {
      console.error("Confirmation email failed (non-fatal):", (emailErr as Error).message);
    }

    res.json({
      ok: true,
      appointmentId: bookResult.appointmentId,
      confirmationCode: bookResult.confirmationCode,
      officeId: slot.officeId,
      officeName,
      date: slot.slotDate,
      time: slot.slotTime,
      dateFormatted: dateStr,
      timeFormatted: timeStr,
      emailSent,
    });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/verify-email ──────────────────────────────────────────────────
// Trigger SES email identity verification for a recipient address.
router.post("/verify-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });

    const status = await verifyEmailIdentity(email, ses);
    res.json({ ok: true, status });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── GET /api/verify-email-status ────────────────────────────────────────────
// Check whether a recipient email is verified in SES.
router.get("/verify-email-status", async (req, res) => {
  try {
    const email = req.query.email as string;
    if (!email) return res.status(400).json({ error: "email query param required" });

    const verified = await checkEmailVerified(email, ses);
    res.json({ email, verified });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/set-demo-email ────────────────────────────────────────────────
// Updates the contact_email on all appointments for the demo date to the
// provided address and triggers SES email identity verification.
router.post("/set-demo-email", requireAuth("admin"), async (req, res) => {
  if (process.env.NODE_ENV === "production" && !process.env.ENABLE_DEMO_ENDPOINTS) {
    return res.status(404).json({ error: "Not found" });
  }
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "email required" });

    await pool.query(`UPDATE appointments SET contact_email = $1`, [email]);

    let sesNote = "Check inbox for SES verification email";
    try {
      const status = await verifyEmailIdentity(email, ses);
      if (status === "already_verified") {
        sesNote = "Email already verified in SES";
      }
    } catch (sesErr: unknown) {
      console.error("SES verify failed (non-fatal):", sesErr);
      sesNote = "Email updated but SES verification failed — verify manually if needed";
    }

    res.json({ ok: true, email, note: sesNote });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/feedback ──────────────────────────────────────────────────────
router.post("/feedback", async (req, res) => {
  try {
    const { name, message } = req.body ?? {};
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required." });
    }
    await pool.query(`INSERT INTO feedback (name, message) VALUES ($1, $2)`, [
      typeof name === "string" && name.trim() ? name.trim() : null,
      message.trim(),
    ]);
    res.status(201).json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

export default router;

// ═══════════════════════════════════════════════════════════════════════════════
// Public routes (no auth required) — mounted separately in app.ts
// ═══════════════════════════════════════════════════════════════════════════════
export const publicRouter = Router();

// Load prescreen questions for a confirmation code
publicRouter.get("/prescreen/:confirmationCode", async (req, res) => {
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

// Submit prescreen responses (auto check-in if flagged)
publicRouter.post("/prescreen/:confirmationCode/submit", async (req, res) => {
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

// ─── GET /api/queue/status/:confirmationCode ─────────────────────────────────
// Public: citizen checks their queue position by confirmation code.
publicRouter.get("/queue/status/:confirmationCode", async (req, res) => {
  try {
    const match = await lookupByConfirmationCode(pool, req.params.confirmationCode);
    if (!match) return res.status(404).json({ error: "Appointment not found" });

    // Check if citizen is in the queue
    const { rows: qRows } = await pool.query(
      `SELECT q.id, q.queue_number, q.status, q.assigned_desk, q.checked_in_at
       FROM queue q
       WHERE q.appointment_id = $1
       ORDER BY q.checked_in_at DESC
       LIMIT 1`,
      [match.appointmentId],
    );

    if (qRows.length === 0) {
      // Not checked in yet — show appointment info
      const { rows: apptRows } = await pool.query(
        `SELECT a.first_name, a.appointment_date::text, a.appointment_time::text, a.status,
                o.name AS office_name
         FROM appointments a
         JOIN offices o ON o.id = a.office_id
         WHERE a.id = $1`,
        [match.appointmentId],
      );
      const appt = apptRows[0];
      return res.json({
        inQueue: false,
        appointment: {
          firstName: appt.first_name,
          date: appt.appointment_date,
          time: appt.appointment_time,
          status: appt.status,
          officeName: appt.office_name,
        },
      });
    }

    const q = qRows[0];

    // Count how many people are ahead in the queue
    let positionAhead = 0;
    if (q.status === "waiting") {
      const { rows: posRows } = await pool.query(
        `SELECT COUNT(*)::int AS ahead
         FROM queue
         WHERE office_id = $1 AND status = 'waiting' AND checked_in_at < $2`,
        [match.officeId, q.checked_in_at],
      );
      positionAhead = posRows[0]?.ahead ?? 0;
    }

    // Get first name for personalization
    const { rows: nameRows } = await pool.query(
      `SELECT first_name FROM appointments WHERE id = $1`,
      [match.appointmentId],
    );

    res.json({
      inQueue: true,
      firstName: nameRows[0]?.first_name,
      queueNumber: q.queue_number,
      status: q.status,
      assignedDesk: q.assigned_desk,
      positionAhead,
      checkedInAt: q.checked_in_at,
    });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/appointment/cancel ────────────────────────────────────────────
// Public: citizen cancels their appointment (verify by code + email).
publicRouter.post("/appointment/cancel", async (req, res) => {
  try {
    const { confirmationCode, email } = req.body ?? {};
    if (!confirmationCode || !email) {
      return res.status(400).json({ error: "confirmationCode and email required" });
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.status, a.first_name, a.appointment_date::text, a.appointment_time::text,
              a.contact_email, o.name AS office_name
       FROM appointments a
       JOIN offices o ON o.id = a.office_id
       WHERE a.confirmation_code = $1 AND LOWER(a.contact_email) = LOWER($2)`,
      [confirmationCode, email],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Appointment not found or email does not match" });
    }
    const appt = rows[0];
    if (appt.status === "cancelled") {
      return res.json({ ok: true, alreadyCancelled: true });
    }
    if (appt.status !== "scheduled") {
      return res.status(400).json({ error: "Only scheduled appointments can be cancelled" });
    }

    await pool.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [appt.id]);

    // Send cancellation confirmation email (fire-and-forget)
    try {
      const cancellationEmail = buildCancellationEmail({
        recipientEmail: appt.contact_email,
        firstName: appt.first_name,
        confirmationCode,
        appointmentDate: appt.appointment_date,
        appointmentTime: appt.appointment_time,
        officeName: appt.office_name,
        fromEmail: EMAIL,
      });
      await sendEmail(ses, cancellationEmail);
    } catch (emailErr) {
      console.error("Failed to send cancellation email (non-blocking):", emailErr);
    }

    res.json({ ok: true });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/appointment/change ────────────────────────────────────────────
// Public: citizen reschedules their appointment (verify by code + email).
publicRouter.post("/appointment/change", async (req, res) => {
  try {
    const { confirmationCode, email, newDate, newTime } = req.body ?? {};
    if (!confirmationCode || !email || !newDate || !newTime) {
      return res.status(400).json({ error: "confirmationCode, email, newDate, newTime required" });
    }

    const { rows } = await pool.query(
      `SELECT a.id, a.office_id, a.txn_type_ids, a.status, a.first_name, a.contact_email,
              o.name AS office_name
       FROM appointments a
       JOIN offices o ON o.id = a.office_id
       WHERE a.confirmation_code = $1 AND LOWER(a.contact_email) = LOWER($2)`,
      [confirmationCode, email],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Appointment not found or email does not match" });
    }
    const appt = rows[0];
    if (appt.status !== "scheduled") {
      return res.status(400).json({ error: "Only scheduled appointments can be changed" });
    }

    // Validate capacity at new slot
    const durRes = await pool.query(
      `SELECT SUM(tt.avg_duration_min)::int AS duration
       FROM unnest($1::int[]) AS tid
       JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL`,
      [appt.txn_type_ids],
    );
    const duration = durRes.rows[0]?.duration || 0;

    const capRes = await pool.query(
      `SELECT validate_slot($1, $2::date, $3::time, $4, $5) AS available`,
      [appt.office_id, newDate, newTime, appt.txn_type_ids, duration],
    );
    const available = capRes.rows[0]?.available || 0;
    if (available <= 0) {
      return res.status(409).json({ error: "Selected time slot is no longer available" });
    }

    await pool.query(
      `UPDATE appointments SET appointment_date = $2, appointment_time = $3 WHERE id = $1`,
      [appt.id, newDate, newTime],
    );

    // Send reschedule confirmation email (fire-and-forget)
    try {
      const qrDataUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(confirmationCode)}`;
      const rescheduleEmail = buildRescheduleEmail({
        recipientEmail: appt.contact_email,
        firstName: appt.first_name,
        confirmationCode,
        newDate,
        newTime,
        officeName: appt.office_name,
        qrCodeDataUrl: qrDataUrl,
        baseUrl: FRONTEND_URL,
        fromEmail: EMAIL,
      });
      await sendEmail(ses, rescheduleEmail);
    } catch (emailErr) {
      console.error("Failed to send reschedule email (non-blocking):", emailErr);
    }

    res.json({ ok: true, newDate, newTime });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── GET /api/appointment/lookup/:confirmationCode ───────────────────────────
// Public: look up basic appointment details for the manage page.
publicRouter.get("/appointment/lookup/:confirmationCode", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.first_name, a.appointment_date::text, a.appointment_time::text,
              a.status, a.contact_email, a.office_id, a.txn_type_ids, o.name AS office_name
       FROM appointments a
       JOIN offices o ON o.id = a.office_id
       WHERE a.confirmation_code = $1`,
      [req.params.confirmationCode],
    );
    if (!rows.length) return res.status(404).json({ error: "Appointment not found" });
    const a = rows[0];
    // Mask email for privacy: show first 2 chars + ***@domain
    const [local, domain] = a.contact_email.split("@");
    const maskedEmail = `${local.slice(0, 2)}***@${domain}`;
    res.json({
      firstName: a.first_name,
      date: a.appointment_date,
      time: a.appointment_time,
      status: a.status,
      officeName: a.office_name,
      officeId: a.office_id,
      txnTypeIds: a.txn_type_ids,
      maskedEmail,
    });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});

// ─── POST /api/appointment/find-slot ─────────────────────────────────────────
// Public: find the best available slot for rescheduling an existing appointment.
publicRouter.post("/appointment/find-slot", async (req, res) => {
  try {
    const { confirmationCode, email, preferredTime, preferredDow, preferredOffice } =
      req.body ?? {};
    if (!confirmationCode || !email) {
      return res.status(400).json({ error: "confirmationCode and email required" });
    }

    const { rows } = await pool.query(
      `SELECT id, office_id, txn_type_ids, status FROM appointments
       WHERE confirmation_code = $1 AND LOWER(contact_email) = LOWER($2)`,
      [confirmationCode, email],
    );
    if (!rows.length) {
      return res.status(404).json({ error: "Appointment not found or email does not match" });
    }
    const appt = rows[0];
    if (appt.status !== "scheduled") {
      return res.status(400).json({ error: "Only scheduled appointments can be rescheduled" });
    }

    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() + 1);

    const resolvedOffice = preferredOffice ?? appt.office_id;

    const slot = await findAppointment(pool, {
      targetTxns: appt.txn_type_ids,
      asap: !preferredTime && preferredDow == null && !preferredOffice,
      preferredOffice: resolvedOffice,
      preferredDow: preferredDow ?? null,
      preferredTime: preferredTime ?? null,
      startDate,
      days: 30,
    });

    if (!slot) {
      return res.status(409).json({ error: "no_available_slots" });
    }

    // Get office name
    const { rows: officeRows } = await pool.query<{ name: string }>(
      `SELECT name FROM offices WHERE id = $1`,
      [slot.officeId],
    );
    const officeName = officeRows[0]?.name ?? "St. Lucie County";

    // Format date/time for display
    const { dateStr: dateFormatted, timeStr: timeFormatted } = formatAppointmentDateTime(
      slot.slotDate,
      slot.slotTime,
    );

    res.json({
      slotDate: slot.slotDate,
      slotTime: slot.slotTime,
      officeName,
      dateFormatted,
      timeFormatted,
    });
  } catch (err: unknown) {
    sendError(res, err, "appointment");
  }
});
