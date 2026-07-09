import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import { pool, withTransaction } from "./db.js";
import {
  generateQrCodeDataUrl,
  lookupByConfirmationCode,
  lookupByName,
  getAppointmentInfo,
  checkInToQueue,
  setAppointmentPriority,
} from "../services/office-ops/src/check-in.js";
import { getRequiredDocsStatus, validateDocument } from "../services/office-ops/src/documents.js";
import { setIdentityVerified } from "../services/office-ops/src/identity.js";
import {
  getPrescreenQuestions,
  savePrescreenResponses,
} from "../services/office-ops/src/prescreen.js";
import {
  getClerkServiceRecord,
  sendToWrittenTest,
} from "../services/office-ops/src/service-clerk.js";
import { completeAppointment } from "../services/office-ops/src/complete.js";
import { assignNextCustomer } from "../services/office-ops/src/queue.js";
import { clerkLogin, setClerkAvailability } from "../services/office-ops/src/clerk-session.js";
import {
  buildQrConfirmationEmail,
  buildPrescreenLinkEmail,
  buildQueueSummonEmail,
} from "../services/office-ops/src/email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const DEMO_DATE = "2026-06-24";

// ─── GET /api/config (needed by check-in-schedule.html) ─────────────────────
app.get("/api/config", async (_req, res) => {
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
        demoDate: DEMO_DATE,
      };
    });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── GET /api/schedule/appointments ─────────────────────────────────────────
app.get("/api/schedule/appointments", async (req, res) => {
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
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/schedule/reschedule ──────────────────────────────────────────
app.post("/api/schedule/reschedule", async (req, res) => {
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
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

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

// ─── Queue Summon Email ─────────────────────────────────────────────────────
async function sendSummonEmail(queueId: number) {
  try {
    const { rows } = await pool.query(
      `SELECT a.confirmation_code, a.first_name, a.contact_email, q.assigned_desk, o.name AS office_name
       FROM queue q
       JOIN appointments a ON a.id = q.appointment_id
       JOIN offices o ON o.id = q.office_id
       WHERE q.id = $1`,
      [queueId],
    );
    const row = rows[0];
    if (!row?.contact_email) return;
    const emailInput = buildQueueSummonEmail({
      recipientEmail: row.contact_email,
      firstName: row.first_name,
      confirmationCode: row.confirmation_code,
      deskNumber: row.assigned_desk,
      officeName: row.office_name,
      fromEmail: EMAIL,
    });
    await sendEmail(emailInput);
  } catch (err) {
    console.error("summon email failed:", err);
  }
}

// ─── Lookup by QR code (backed entirely by src/) ─────────────────────────────
// Wires lookupByConfirmationCode → getAppointmentInfo → getRequiredDocsStatus.
app.post("/api/lookup", async (req, res) => {
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

// ─── Lookup by appointment ID (loads full record like QR lookup) ────────────
app.post("/api/lookup-by-id", async (req, res) => {
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

// ─── Search by name (backed by src/check-in.ts → lookupByName) ─────────────
app.post("/api/search-name", async (req, res) => {
  try {
    const query = String(req.body?.query ?? "").trim();
    const officeId = parseInt(req.body?.officeId) || 1;
    const date = req.body?.date || "2026-06-24";
    if (!query) return res.status(400).json({ error: "query required" });

    const results = await lookupByName(pool, query, officeId, date);
    res.json(results);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/send-confirmation", async (req, res) => {
  const prescreen = req.body?.prescreen ?? true;
  const identity = req.body?.identity ?? false;
  const docsConfig = req.body?.docs ?? "mixed";

  try {
    const { rows } = await pool.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, required_doc_ids, appointment_date, appointment_time,
        status, is_walk_in, prescreen_completed, identity_verified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id, confirmation_code`,
      [
        1,
        "Jane",
        "Smith",
        EMAIL,
        "772-555-0001",
        [1],
        ["photo_id", "insurance_card", "proof_address"],
        "2026-06-24",
        "09:30",
        "scheduled",
        false,
        prescreen,
        identity,
      ],
    );
    const appointmentId = rows[0].id;
    const confirmationCode = rows[0].confirmation_code;

    // Insert documents based on config
    const docDefs: { docId: string; name: string; status: string | null }[] = [];
    if (docsConfig === "mixed") {
      docDefs.push({ docId: "photo_id", name: "Photo ID", status: "accept" });
      docDefs.push({ docId: "insurance_card", name: "Insurance Card", status: "reject" });
      // proof_address not uploaded (pending)
    } else if (docsConfig === "all-accepted") {
      docDefs.push({ docId: "photo_id", name: "Photo ID", status: "accept" });
      docDefs.push({ docId: "insurance_card", name: "Insurance Card", status: "accept" });
      docDefs.push({ docId: "proof_address", name: "Proof of Residency", status: "accept" });
    } else if (docsConfig === "all-pending") {
      // All required but none uploaded — no document rows
    } else if (docsConfig === "none") {
      // No docs at all
    }

    for (const doc of docDefs) {
      await pool.query(
        `INSERT INTO documents (appointment_id, doc_id, name, ai_review_status)
         VALUES ($1, $2, $3, $4)`,
        [appointmentId, doc.docId, doc.name, doc.status],
      );
    }

    const qrDataUrl = await generateQrCodeDataUrl(confirmationCode);
    const emailInput = buildQrConfirmationEmail({
      recipientEmail: EMAIL,
      firstName: "Jane",
      confirmationCode,
      appointmentDate: "Tuesday, June 24, 2026",
      appointmentTime: "9:30 AM",
      officeName: "Port St. Lucie (Crosstown Pkwy)",
      qrCodeDataUrl: qrDataUrl,
      fromEmail: EMAIL,
    });

    try {
      await sendEmail(emailInput);
    } catch (emailErr: unknown) {
      console.error("Email send failed:", emailErr);
    }

    res.json({ ok: true, confirmationCode, appointmentId });
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
    // Override the URL in the email with the one that has query params
    const html = emailInput.html.replace(
      new RegExp(`${BASE_URL}/prescreen/${confirmationCode}`, "g"),
      prescreenUrl,
    );
    const text = emailInput.text.replace(
      new RegExp(`${BASE_URL}/prescreen/${confirmationCode}`, "g"),
      prescreenUrl,
    );
    await sendEmail({ ...emailInput, html, text });

    res.json({ ok: true, prescreenUrl, sentTo: toEmail });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-prescreen error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ─── Sample customers for testing (returns Jane Smith appointments) ──────────
app.get("/api/sample-customers", async (_req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.first_name, a.last_name, a.confirmation_code, a.prescreen_completed,
        a.txn_type_ids,
        array_length(a.required_doc_ids, 1) AS req_docs,
        (SELECT COUNT(*)::int FROM documents d WHERE d.appointment_id = a.id) AS uploaded,
        (SELECT COUNT(*)::int FROM documents d WHERE d.appointment_id = a.id AND d.ai_review_status = 'accept') AS accepted,
        (SELECT COUNT(*)::int FROM documents d WHERE d.appointment_id = a.id AND d.ai_review_status = 'reject') AS rejected
      FROM appointments a
      WHERE a.first_name = 'Jane' AND a.last_name = 'Smith'
      ORDER BY a.id DESC
      LIMIT 1
    `);
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Seed queue: create 5 customers and check them in ───────────────────────
app.post("/api/seed-queue", async (_req, res) => {
  try {
    // Clear existing queue
    await pool.query(`DELETE FROM queue`);
    await pool.query(`DELETE FROM queue_counters`);

    const customers = [
      {
        first: "Robert",
        last: "Garcia",
        txn: [2],
        docs: ["birth_cert", "proof_address", "ssn_proof"],
        allDocsValid: true,
      },
      {
        first: "Patricia",
        last: "Wilson",
        txn: [3],
        docs: ["learner_permit", "photo_id", "proof_address", "ssn_proof"],
        allDocsValid: true,
      },
      {
        first: "Michael",
        last: "Johnson",
        txn: [1],
        docs: ["learner_permit", "photo_id", "vision_cert", "vehicle_reg", "insurance_card"],
        allDocsValid: true,
      },
      {
        first: "Linda",
        last: "Martinez",
        txn: [2],
        docs: ["birth_cert", "proof_address", "ssn_proof"],
        allDocsValid: false,
      },
      {
        first: "David",
        last: "Anderson",
        txn: [3],
        docs: ["learner_permit", "photo_id", "proof_address", "ssn_proof"],
        allDocsValid: true,
      },
    ];

    const officeId = 1;
    const apptDate = "2026-06-24";
    const results = [];

    for (let i = 0; i < customers.length; i++) {
      const c = customers[i];
      const minutes = i * 15;
      const time = `${String(9 + Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

      const { rows } = await pool.query(
        `INSERT INTO appointments (
          office_id, first_name, last_name, contact_email, contact_phone,
          txn_type_ids, required_doc_ids, appointment_date, appointment_time,
          status, is_walk_in, prescreen_completed, identity_verified
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING id`,
        [
          officeId,
          c.first,
          c.last,
          `${c.first.toLowerCase()}.${c.last.toLowerCase()}@email.com`,
          `772-555-${String(100 + i).padStart(4, "0")}`,
          c.txn,
          c.docs,
          apptDate,
          time,
          "scheduled",
          false,
          true, // all have prescreen done
          true, // all identity verified
        ],
      );
      const appointmentId = rows[0].id;

      // Insert documents
      for (let d = 0; d < c.docs.length; d++) {
        const docId = c.docs[d];
        let status = "accept";
        if (!c.allDocsValid && d === c.docs.length - 1) {
          status = "reject";
        }
        const { rows: regRows } = await pool.query(
          `SELECT name FROM document_registry WHERE doc_id = $1`,
          [docId],
        );
        const docName = regRows[0]?.name || docId;
        await pool.query(
          `INSERT INTO documents (appointment_id, doc_id, name, ai_review_status, clerk_validated)
           VALUES ($1, $2, $3, $4, $5)`,
          [appointmentId, docId, docName, status, c.allDocsValid],
        );
      }

      // Check in to queue
      const queueResult = await checkInToQueue(pool, officeId, appointmentId, undefined);
      results.push({ name: `${c.first} ${c.last}`, queueNumber: queueResult.queueNumber });
    }

    res.json({ ok: true, seeded: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("seed-queue error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ─── Live queue state (reads from queue + clerk_sessions tables) ─────────────
app.get("/api/live-queue", async (_req, res) => {
  try {
    const queue = await pool.query(`
      SELECT q.id, q.appointment_id, q.queue_number, q.status, q.assigned_desk, q.notes,
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

// ─── Walk-in registration (create appointment + check in) ──────────────────
app.post("/api/walk-in", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, txns, prescreen, priority, notes } = req.body;
    // TODO: validate email format and phone number format
    if (!firstName || !lastName || !txns?.length)
      return res.status(400).json({ error: "firstName, lastName, and txns required" });

    // TODO: pull required docs per txn type from the database instead of hardcoding
    const txnDocMap: Record<string, string[]> = {
      "road-test": ["learner_permit", "photo_id", "vision_cert", "vehicle_reg", "insurance_card"],
      "id-card": ["birth_cert", "proof_address", "ssn_proof"],
      "license-original": ["learner_permit", "photo_id", "proof_address", "ssn_proof"],
    };
    const txnIdMap: Record<string, number> = {
      "road-test": 1,
      "id-card": 2,
      "license-original": 3,
    };

    const txnTypeIds = txns.map((t: string) => txnIdMap[t]).filter(Boolean);
    const seen = new Set<string>();
    const requiredDocs: string[] = [];
    for (const t of txns as string[]) {
      for (const d of txnDocMap[t] || []) {
        if (!seen.has(d)) {
          seen.add(d);
          requiredDocs.push(d);
        }
      }
    }

    const officeId = 1;

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
        "2026-06-24",
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
      // Prescreen not done — don't check in yet; auto check-in happens after prescreen submission
      return res.json({ ok: true, appointmentId, pendingPrescreen: true });
    }

    const result = await checkInToQueue(pool, officeId, appointmentId, notes || undefined);
    res.json({ ok: true, appointmentId, queueId: result.queueId, queueNumber: result.queueNumber });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("walk-in error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ─── Prescreen page (served as HTML) ─────────────────────────────────────────
app.get("/prescreen/:confirmationCode", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "prescreen.html"));
});

// ─── Prescreen API: load questions for an appointment by QR code ─────────────
app.get("/api/prescreen/:confirmationCode", async (req, res) => {
  try {
    const confirmationCode = req.params.confirmationCode;
    const match = await lookupByConfirmationCode(pool, confirmationCode);
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

// ─── Prescreen API: submit responses (auto check-in if flagged) ─────────────
app.post("/api/prescreen/:confirmationCode/submit", async (req, res) => {
  try {
    const confirmationCode = req.params.confirmationCode;
    const match = await lookupByConfirmationCode(pool, confirmationCode);
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
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Service Clerk: list clerks for an office (with skills) ─────────────────
app.get("/api/clerks", async (req, res) => {
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
    await sendSummonEmail(result.queueId);
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

    // Enrich prescreen: attach question text to each response entry
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

    // Include current transaction steps if tracked
    const steps = txnSteps[rows[0].queue_id] ?? { visionTest: false, photo: false, payment: false };

    res.json({ serving: true, record: { ...record, prescreenWithText, steps } });
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
    await sendSummonEmail(nextResult.queueId);
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

// ─── Service Clerk: send to written test ────────────────────────────────────
app.post("/api/clerk/send-to-test", async (req, res) => {
  try {
    const { queueId, testStationId, clerkId, officeId } = req.body;
    if (!queueId || !testStationId || !clerkId || !officeId)
      return res.status(400).json({ error: "queueId, testStationId, clerkId, officeId required" });
    await sendToWrittenTest(pool, { queueId, testStationId, clerkId, officeId });
    res.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// In-memory prototype state: transaction steps and state uploads per queueId
// Real implementation would persist these to the DB.
const txnSteps: Record<number, { visionTest: boolean; photo: boolean; payment: boolean }> = {};
const stateUploads: Record<number, Record<string, "pending" | "uploaded">> = {};

// ─── Service Clerk: record transaction step (prototype only) ─────────────────
app.post("/api/clerk/record-step", (req, res) => {
  const { queueId, step } = req.body;
  if (!queueId || !step) return res.status(400).json({ error: "queueId and step required" });
  if (!["visionTest", "photo", "payment"].includes(step))
    return res.status(400).json({ error: "step must be visionTest, photo, or payment" });
  if (!txnSteps[queueId]) txnSteps[queueId] = { visionTest: false, photo: false, payment: false };
  txnSteps[queueId][step as "visionTest" | "photo" | "payment"] = true;
  res.json({ ok: true, steps: txnSteps[queueId] });
});

// ─── Service Clerk: get transaction steps for current serving ────────────────
app.get("/api/clerk/steps/:queueId", (req, res) => {
  const queueId = parseInt(req.params.queueId);
  res.json(txnSteps[queueId] ?? { visionTest: false, photo: false, payment: false });
});

// ─── Service Clerk: record state system upload (prototype only) ───────────────
app.post("/api/clerk/state-upload", (req, res) => {
  const { queueId, docName } = req.body;
  if (!queueId || !docName) return res.status(400).json({ error: "queueId and docName required" });
  if (!stateUploads[queueId]) stateUploads[queueId] = {};
  stateUploads[queueId][docName] = "uploaded";
  res.json({ ok: true, uploads: stateUploads[queueId] });
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

// ─── Admin Dashboard ────────────────────────────────────────────────────────
app.get("/admin", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "admin.html"));
});

// ─── Admin API: Offices ─────────────────────────────────────────────────────
app.get("/api/admin/offices", async (_req, res) => {
  try {
    const offices = await pool.query(
      `SELECT id, name, address, total_desks, run_rate_pct FROM offices ORDER BY id`,
    );
    const hours = await pool.query(
      `SELECT id, office_id, day_of_week, open_time::text, close_time::text FROM office_hours ORDER BY office_id, day_of_week`,
    );
    const lunches = await pool.query(
      `SELECT id, office_id, shift_num, start_time::text, end_time::text FROM office_lunch_shifts ORDER BY office_id, shift_num`,
    );
    res.json({ offices: offices.rows, hours: hours.rows, lunches: lunches.rows });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/offices", async (req, res) => {
  try {
    const { name, address, totalDesks, runRatePct } = req.body;
    if (!name || !totalDesks)
      return res.status(400).json({ error: "name and totalDesks required" });
    const { rows } = await pool.query(
      `INSERT INTO offices (name, address, total_desks, run_rate_pct) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, address || null, totalDesks, runRatePct || 100],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/offices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, address, totalDesks, runRatePct } = req.body;
    await pool.query(
      `UPDATE offices SET name = COALESCE($2, name), address = COALESCE($3, address),
       total_desks = COALESCE($4, total_desks), run_rate_pct = COALESCE($5, run_rate_pct) WHERE id = $1`,
      [id, name || null, address, totalDesks || null, runRatePct || null],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/offices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query(`DELETE FROM offices WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Office Hours ────────────────────────────────────────────────
app.post("/api/admin/office-hours", async (req, res) => {
  try {
    const { officeId, dayOfWeek, openTime, closeTime } = req.body;
    await pool.query(
      `INSERT INTO office_hours (office_id, day_of_week, open_time, close_time)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (office_id, day_of_week) DO UPDATE SET open_time = $3, close_time = $4`,
      [officeId, dayOfWeek, openTime, closeTime],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/office-hours/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM office_hours WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Lunch Shifts ────────────────────────────────────────────────
app.post("/api/admin/lunch-shifts", async (req, res) => {
  try {
    const { officeId, shiftNum, startTime, endTime } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO office_lunch_shifts (office_id, shift_num, start_time, end_time)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [officeId, shiftNum, startTime, endTime],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/lunch-shifts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query(`UPDATE clerk_schedules SET lunch_shift_id = NULL WHERE lunch_shift_id = $1`, [
      id,
    ]);
    await pool.query(`DELETE FROM office_lunch_shifts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Transaction Types ───────────────────────────────────────────
app.get("/api/admin/transaction-types", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, txn_type_id, office_id, name, description, avg_duration_min,
              status, available_from::text, available_until::text,
              is_online_eligible, online_redirect_url
       FROM transaction_types ORDER BY office_id NULLS FIRST, id`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/transaction-types", async (req, res) => {
  try {
    const {
      txnTypeId,
      officeId,
      name,
      description,
      avgDurationMin,
      status,
      availableFrom,
      availableUntil,
      isOnlineEligible,
      onlineRedirectUrl,
    } = req.body;
    if (!txnTypeId || !name || !avgDurationMin)
      return res.status(400).json({ error: "txnTypeId, name, avgDurationMin required" });
    const { rows } = await pool.query(
      `INSERT INTO transaction_types (txn_type_id, office_id, name, description, avg_duration_min, status, available_from, available_until, is_online_eligible, online_redirect_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        txnTypeId,
        officeId || null,
        name,
        description || null,
        avgDurationMin,
        status || "active",
        availableFrom || null,
        availableUntil || null,
        isOnlineEligible || false,
        onlineRedirectUrl || null,
      ],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/transaction-types/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      name,
      description,
      avgDurationMin,
      status,
      availableFrom,
      availableUntil,
      isOnlineEligible,
      onlineRedirectUrl,
    } = req.body;
    await pool.query(
      `UPDATE transaction_types SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       avg_duration_min = COALESCE($4, avg_duration_min),
       status = COALESCE($5, status),
       available_from = $6,
       available_until = $7,
       is_online_eligible = COALESCE($8, is_online_eligible),
       online_redirect_url = $9
       WHERE id = $1`,
      [
        id,
        name || null,
        description,
        avgDurationMin || null,
        status || null,
        availableFrom || null,
        availableUntil || null,
        isOnlineEligible,
        onlineRedirectUrl || null,
      ],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/transaction-types/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM transaction_types WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Clerks ──────────────────────────────────────────────────────
app.get("/api/admin/clerks", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, status, skill_ids, office_ids FROM clerks ORDER BY id`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/clerks", async (req, res) => {
  try {
    const { firstName, lastName, email, status, skillIds, officeIds } = req.body;
    if (!firstName || !lastName || !email)
      return res.status(400).json({ error: "firstName, lastName, email required" });
    const { rows } = await pool.query(
      `INSERT INTO clerks (first_name, last_name, email, status, skill_ids, office_ids)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [firstName, lastName, email, status || "active", skillIds || [], officeIds || []],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/clerks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { firstName, lastName, email, status, skillIds, officeIds } = req.body;
    await pool.query(
      `UPDATE clerks SET
       first_name = COALESCE($2, first_name),
       last_name = COALESCE($3, last_name),
       email = COALESCE($4, email),
       status = COALESCE($5, status),
       skill_ids = COALESCE($6, skill_ids),
       office_ids = COALESCE($7, office_ids)
       WHERE id = $1`,
      [
        id,
        firstName || null,
        lastName || null,
        email || null,
        status || null,
        skillIds || null,
        officeIds || null,
      ],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/clerks/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM clerks WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/clerks/bulk-import", async (req, res) => {
  try {
    const { clerks: clerkRows } = req.body;
    if (!Array.isArray(clerkRows) || !clerkRows.length)
      return res.status(400).json({ error: "clerks array required" });
    const inserted = [];
    for (const c of clerkRows) {
      const { rows } = await pool.query(
        `INSERT INTO clerks (first_name, last_name, email, status, skill_ids, office_ids)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (email) DO UPDATE SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
           status = EXCLUDED.status, skill_ids = EXCLUDED.skill_ids, office_ids = EXCLUDED.office_ids
         RETURNING id`,
        [
          c.firstName,
          c.lastName,
          c.email,
          c.status || "active",
          c.skillIds || [],
          c.officeIds || [],
        ],
      );
      inserted.push(rows[0].id);
    }
    res.json({ ok: true, count: inserted.length, ids: inserted });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Hotbuttons ──────────────────────────────────────────────────
app.get("/api/admin/hotbuttons", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sort_order, label, prompt FROM hotbuttons ORDER BY sort_order`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/hotbuttons", async (req, res) => {
  try {
    const { sortOrder, label, prompt } = req.body;
    if (!label || !prompt) return res.status(400).json({ error: "label and prompt required" });
    const { rows } = await pool.query(
      `INSERT INTO hotbuttons (sort_order, label, prompt) VALUES ($1, $2, $3) RETURNING id`,
      [sortOrder || 0, label, prompt],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/hotbuttons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sortOrder, label, prompt } = req.body;
    await pool.query(
      `UPDATE hotbuttons SET sort_order = COALESCE($2, sort_order), label = COALESCE($3, label), prompt = COALESCE($4, prompt) WHERE id = $1`,
      [id, sortOrder ?? null, label || null, prompt || null],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/hotbuttons/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM hotbuttons WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Prescreen Questions ─────────────────────────────────────────
app.get("/api/admin/prescreen-questions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pq.id, pq.txn_type_id, pq.sort_order, pq.question_text, tt.name AS txn_name
       FROM prescreen_questions pq
       JOIN transaction_types tt ON tt.id = pq.txn_type_id
       ORDER BY pq.txn_type_id, pq.sort_order`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/prescreen-questions", async (req, res) => {
  try {
    const { txnTypeId, sortOrder, questionText } = req.body;
    if (!txnTypeId || !questionText)
      return res.status(400).json({ error: "txnTypeId and questionText required" });
    const { rows } = await pool.query(
      `INSERT INTO prescreen_questions (txn_type_id, sort_order, question_text)
       VALUES ($1, $2, $3) RETURNING id`,
      [txnTypeId, sortOrder || 1, questionText],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/prescreen-questions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sortOrder, questionText } = req.body;
    await pool.query(
      `UPDATE prescreen_questions SET sort_order = COALESCE($2, sort_order), question_text = COALESCE($3, question_text) WHERE id = $1`,
      [id, sortOrder ?? null, questionText || null],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/prescreen-questions/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM prescreen_questions WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Duration Recommendations ────────────────────────────────────
app.get("/api/admin/duration-recommendations", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.id, dr.txn_type_id, tt.name AS txn_name, dr.current_avg_min,
              dr.recommended_avg_min, dr.sample_size, dr.status, dr.created_at
       FROM duration_recommendations dr
       JOIN transaction_types tt ON tt.id = dr.txn_type_id
       ORDER BY dr.created_at DESC`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Skills Matrix ──────────────────────────────────────────────
app.get("/api/admin/skills-matrix", async (_req, res) => {
  try {
    const { rows: clerks } = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.skill_ids, c.status
       FROM clerks c ORDER BY c.id`,
    );
    const { rows: txnTypes } = await pool.query(
      `SELECT id, name FROM transaction_types WHERE office_id IS NULL ORDER BY id`,
    );
    res.json({ clerks, txnTypes });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/clerk-skills/:clerkId", async (req, res) => {
  try {
    const clerkId = parseInt(req.params.clerkId);
    const { skillIds } = req.body;
    if (!Array.isArray(skillIds)) return res.status(400).json({ error: "skillIds array required" });
    await pool.query(`UPDATE clerks SET skill_ids = $2 WHERE id = $1`, [clerkId, skillIds]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Transaction-Office Matrix ──────────────────────────────────
app.get("/api/admin/txn-office-matrix", async (_req, res) => {
  try {
    const { rows: offices } = await pool.query(`SELECT id, name FROM offices ORDER BY id`);
    const { rows: globalTxns } = await pool.query(
      `SELECT id, txn_type_id, name, status FROM transaction_types WHERE office_id IS NULL ORDER BY id`,
    );
    const { rows: overrides } = await pool.query(
      `SELECT id, txn_type_id, office_id, name, status, available_from::text, available_until::text
       FROM transaction_types WHERE office_id IS NOT NULL ORDER BY office_id, txn_type_id`,
    );
    res.json({ offices, globalTxns, overrides });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/txn-office-override", async (req, res) => {
  try {
    const { txnTypeId, officeId, status, availableFrom, availableUntil } = req.body;
    if (!txnTypeId || !officeId)
      return res.status(400).json({ error: "txnTypeId and officeId required" });
    // Look up the global transaction type to copy name/description
    const { rows: globalRows } = await pool.query(
      `SELECT name, description, avg_duration_min FROM transaction_types WHERE txn_type_id = $1 AND office_id IS NULL`,
      [txnTypeId],
    );
    if (!globalRows.length)
      return res.status(404).json({ error: "Global transaction type not found" });
    const g = globalRows[0];
    const { rows } = await pool.query(
      `INSERT INTO transaction_types (txn_type_id, office_id, name, description, avg_duration_min, status, available_from, available_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (txn_type_id, office_id) DO UPDATE SET status = $6, available_from = $7, available_until = $8
       RETURNING id`,
      [
        txnTypeId,
        officeId,
        g.name,
        g.description,
        g.avg_duration_min,
        status || "active",
        availableFrom || null,
        availableUntil || null,
      ],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/txn-office-override/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM transaction_types WHERE id = $1 AND office_id IS NOT NULL`, [
      parseInt(req.params.id),
    ]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Document Registry ──────────────────────────────────────────
app.get("/api/admin/document-registry", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT doc_id, name, description, alternatives FROM document_registry ORDER BY doc_id`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/document-registry", async (req, res) => {
  try {
    const { docId, name, description, alternatives } = req.body;
    if (!docId || !name) return res.status(400).json({ error: "docId and name required" });
    await pool.query(
      `INSERT INTO document_registry (doc_id, name, description, alternatives) VALUES ($1, $2, $3, $4)`,
      [docId, name, description || null, alternatives || []],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/document-registry/:docId", async (req, res) => {
  try {
    const docId = req.params.docId;
    const { name, description, alternatives } = req.body;
    await pool.query(
      `UPDATE document_registry SET name = COALESCE($2, name), description = COALESCE($3, description), alternatives = COALESCE($4, alternatives) WHERE doc_id = $1`,
      [docId, name || null, description, alternatives || null],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.delete("/api/admin/document-registry/:docId", async (req, res) => {
  try {
    await pool.query(`DELETE FROM document_registry WHERE doc_id = $1`, [req.params.docId]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Transaction Flows (document requirements per txn) ──────────
app.get("/api/admin/transaction-flows", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tf.id, tf.txn_type_id, tt.name AS txn_name, tf.steps
       FROM transaction_flows tf
       JOIN transaction_types tt ON tt.id = tf.txn_type_id
       ORDER BY tf.txn_type_id`,
    );
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/transaction-flows/:txnTypeId", async (req, res) => {
  try {
    const txnTypeId = parseInt(req.params.txnTypeId);
    const { steps } = req.body;
    if (!steps) return res.status(400).json({ error: "steps required" });
    await pool.query(
      `INSERT INTO transaction_flows (txn_type_id, steps) VALUES ($1, $2)
       ON CONFLICT (txn_type_id) DO UPDATE SET steps = $2`,
      [txnTypeId, JSON.stringify(steps)],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Performance Metrics ────────────────────────────────────────
app.get("/api/admin/performance-metrics", async (req, res) => {
  try {
    const days = parseInt(req.query.days as string) || 30;

    // Average service time per transaction type
    const { rows: avgByTxn } = await pool.query(
      `SELECT tt.name AS txn_name, tt.id AS txn_type_id,
              ROUND(AVG(sh.duration_sec) / 60.0, 1) AS avg_minutes,
              COUNT(*)::int AS sample_count
       FROM service_history sh
       JOIN service_history_txn_types sht ON sht.service_history_id = sh.id
       JOIN transaction_types tt ON tt.id = sht.txn_type_id
       WHERE sh.served_at >= NOW() - $1::interval
       GROUP BY tt.id, tt.name
       ORDER BY tt.name`,
      [`${days} days`],
    );

    // Daily service times (for line chart)
    const { rows: dailyTimes } = await pool.query(
      `SELECT DATE(sh.served_at) AS day,
              ROUND(AVG(sh.duration_sec) / 60.0, 1) AS avg_minutes,
              COUNT(*)::int AS count
       FROM service_history sh
       WHERE sh.served_at >= NOW() - $1::interval
       GROUP BY DATE(sh.served_at)
       ORDER BY day`,
      [`${days} days`],
    );

    // Customers served per day
    const { rows: dailyVolume } = await pool.query(
      `SELECT DATE(sh.served_at) AS day, COUNT(*)::int AS customers_served
       FROM service_history sh
       WHERE sh.served_at >= NOW() - $1::interval
       GROUP BY DATE(sh.served_at)
       ORDER BY day`,
      [`${days} days`],
    );

    // Average wait time (time from check-in to serving)
    const { rows: waitTimes } = await pool.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (q.served_at - q.checked_in_at))) / 60.0, 1) AS avg_wait_minutes,
              COUNT(*)::int AS sample_count
       FROM queue q
       WHERE q.status = 'done' AND q.served_at IS NOT NULL
         AND q.checked_in_at >= NOW() - $1::interval`,
      [`${days} days`],
    );

    // Per-office comparison
    const { rows: officeMetrics } = await pool.query(
      `SELECT o.name AS office_name, o.id AS office_id,
              ROUND(AVG(sh.duration_sec) / 60.0, 1) AS avg_service_minutes,
              COUNT(*)::int AS total_served,
              ROUND(AVG(EXTRACT(EPOCH FROM (q.served_at - q.checked_in_at))) / 60.0, 1) AS avg_wait_minutes
       FROM service_history sh
       JOIN offices o ON o.id = sh.office_id
       LEFT JOIN queue q ON q.appointment_id = sh.appointment_id AND q.served_at IS NOT NULL
       WHERE sh.served_at >= NOW() - $1::interval
       GROUP BY o.id, o.name
       ORDER BY o.name`,
      [`${days} days`],
    );

    res.json({
      avgByTxn,
      dailyTimes,
      dailyVolume,
      waitTimes: waitTimes[0] || { avg_wait_minutes: null, sample_count: 0 },
      officeMetrics,
    });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/duration-recommendations/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `UPDATE duration_recommendations SET status = 'approved' WHERE id = $1 RETURNING txn_type_id, recommended_avg_min`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "not found" });
    await pool.query(`UPDATE transaction_types SET avg_duration_min = $2 WHERE id = $1`, [
      rows[0].txn_type_id,
      rows[0].recommended_avg_min,
    ]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.post("/api/admin/duration-recommendations/:id/reject", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query(`UPDATE duration_recommendations SET status = 'rejected' WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Admin API: Global Config ───────────────────────────────────────────────
app.get("/api/admin/config", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT timezone, scheduling_block_padding, default_lookahead_days FROM config`,
    );
    res.json(rows[0] || {});
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.put("/api/admin/config", async (req, res) => {
  try {
    const { timezone, schedulingBlockPadding, defaultLookaheadDays } = req.body;
    await pool.query(
      `UPDATE config SET
       timezone = COALESCE($1, timezone),
       scheduling_block_padding = COALESCE($2, scheduling_block_padding),
       default_lookahead_days = COALESCE($3, default_lookahead_days)`,
      [timezone || null, schedulingBlockPadding ?? null, defaultLookaheadDays ?? null],
    );
    res.json({ ok: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

const server = app.listen(3000, () => {
  console.log("Prototype server running at http://localhost:3000/prototype.html");
  console.log("Admin dashboard at http://localhost:3000/admin");
});

server.on("error", (err) => {
  console.error("Server failed to start:", err.message);
  process.exit(1);
});
