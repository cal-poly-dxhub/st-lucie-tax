import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { withTransaction, pool } from "./db.js";
import { findAppointment } from "../src/find-appt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const DEMO_DATE = "2026-05-13";
const NOW_TS = "2026-05-13 06:00";

app.get("/schedule-demo", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "scheduling-demo.html"));
});

app.get("/schedule", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "check-in-schedule.html"));
});

// ─── GET /api/config ────────────────────────────────────────────────────────
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
      const clerks = await client.query(
        `SELECT c.id, c.first_name || ' ' || LEFT(c.last_name, 1) || '.' AS name,
                c.skill_ids, c.office_ids
         FROM clerks c
         WHERE c.status = 'active'
         ORDER BY c.id`,
      );
      const lunchShifts = await client.query(
        `SELECT id, office_id, shift_num, start_time::text, end_time::text
         FROM office_lunch_shifts
         ORDER BY office_id, start_time`,
      );
      const clerkSchedules = await client.query(
        `SELECT clerk_id, office_id, lunch_shift_id
         FROM clerk_schedules
         WHERE schedule_date = $1`,
        [DEMO_DATE],
      );
      const officeHours = await client.query(
        `SELECT office_id, day_of_week, open_time::text, close_time::text
         FROM office_hours`,
      );
      return {
        offices: offices.rows,
        txnTypes: txnTypes.rows,
        clerks: clerks.rows,
        lunchShifts: lunchShifts.rows,
        clerkSchedules: clerkSchedules.rows,
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

    const rows = await withTransaction(async (client) => {
      const result = await client.query(
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
      return result.rows;
    });
    res.json(rows);
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

      const durRes = await client.query(
        `SELECT SUM(tt.avg_duration_min)::int AS duration
         FROM unnest($1::int[]) AS tid
         JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL`,
        [appt.txn_type_ids],
      );
      const duration = durRes.rows[0]?.duration || 0;

      await client.query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [
        appointmentId,
      ]);

      if (!force) {
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

// ─── GET /api/appointments/:officeId ────────────────────────────────────────
app.get("/api/appointments/:officeId", async (req, res) => {
  try {
    const officeId = parseInt(req.params.officeId);
    if (isNaN(officeId)) return res.status(400).json({ error: "Invalid officeId" });
    const rows = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT a.id, a.appointment_time::text AS start_time, a.txn_type_ids,
                a.first_name, a.last_name,
                (SELECT SUM(tt.avg_duration_min)
                 FROM unnest(a.txn_type_ids) AS tid
                 JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL) AS duration_min
         FROM appointments a
         WHERE a.office_id = $1
           AND a.appointment_date = $2
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.appointment_time`,
        [officeId, DEMO_DATE],
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/find-appointment ─────────────────────────────────────────────
app.post("/api/find-appointment", async (req, res) => {
  try {
    const { targetSkills, asap, preferredOffice, preferredDow, preferredTime } = req.body;

    if (
      !Array.isArray(targetSkills) ||
      targetSkills.length === 0 ||
      !targetSkills.every((s: unknown) => Number.isInteger(s))
    ) {
      return res.status(400).json({ error: "targetSkills must be a non-empty array of integers" });
    }

    const result = await withTransaction(async (client) => {
      return findAppointment(client, {
        targetSkills,
        asap: asap ?? false,
        preferredOffice: preferredOffice ?? null,
        preferredDow: preferredDow ?? null,
        preferredTime: preferredTime ?? null,
        startDate: new Date(DEMO_DATE + "T00:00:00"),
        days: 1,
        nowTs: NOW_TS,
      });
    });

    if (result) {
      res.json({ success: true, ...result });
    } else {
      res.json({ success: false });
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── POST /api/book-appointment ─────────────────────────────────────────────
app.post("/api/book-appointment", async (req, res) => {
  try {
    const { officeId, date, time, txnTypeIds, firstName, lastName } = req.body;

    if (
      !officeId ||
      !date ||
      !time ||
      !firstName ||
      !lastName ||
      !Array.isArray(txnTypeIds) ||
      txnTypeIds.length === 0
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await withTransaction(async (client) => {
      const r = await client.query(
        `SELECT book_appointment(
           p_office_id     := $1,
           p_date          := $2,
           p_time          := $3,
           p_txn_type_ids  := $4,
           p_first_name    := $5,
           p_last_name     := $6,
           p_contact_email := $7,
           p_contact_phone := $8,
           p_now_ts        := $9
         ) AS appointment_id`,
        [
          officeId,
          date,
          time,
          txnTypeIds,
          firstName,
          lastName,
          `${firstName.toLowerCase()}.${lastName.toLowerCase()}@demo.com`,
          "555-0000",
          NOW_TS,
        ],
      );
      return r.rows[0]?.appointment_id;
    });

    res.json({ success: true, appointmentId: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("capacity_exceeded")) {
      res.json({ success: false, error: "capacity_exceeded" });
    } else if (msg.includes("office_closed")) {
      res.json({ success: false, error: "office_closed" });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ─── POST /api/demo/reset ───────────────────────────────────────────────────
app.post("/api/demo/reset", async (req, res) => {
  try {
    const { clerkCount, runRatePct, crossTrain, activeTxnIds } = req.body;

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM appointments WHERE appointment_date = $1`, [DEMO_DATE]);

      if (activeTxnIds && Array.isArray(activeTxnIds)) {
        await client.query(
          `UPDATE transaction_types SET status = CASE WHEN id = ANY($1::int[]) THEN 'active' ELSE 'hidden' END
           WHERE office_id IS NULL`,
          [activeTxnIds],
        );
      }

      if (runRatePct != null) {
        await client.query(`UPDATE offices SET run_rate_pct = $1`, [runRatePct]);
      }

      if (clerkCount != null) {
        await client.query(`UPDATE offices SET total_desks = $1`, [clerkCount]);
        await client.query(`UPDATE clerks SET status = 'inactive'`);
        await client.query(`DELETE FROM clerk_schedules WHERE schedule_date = $1`, [DEMO_DATE]);

        const officesRes = await client.query(`SELECT id FROM offices ORDER BY id`);
        const txnRes = await client.query(
          `SELECT id FROM transaction_types WHERE office_id IS NULL AND status = 'active' ORDER BY id`,
        );
        const txnIds = txnRes.rows.map((r: { id: number }) => r.id);
        const crossTrainPct = (crossTrain ?? 100) / 100;

        const lunchRes = await client.query(
          `SELECT id, office_id FROM office_lunch_shifts ORDER BY office_id, start_time`,
        );
        const lunchByOffice: Record<number, number[]> = {};
        for (const r of lunchRes.rows) {
          (lunchByOffice[r.office_id] ??= []).push(r.id);
        }

        let clerkId = 1;
        for (const office of officesRes.rows) {
          const officeLunches = lunchByOffice[office.id] || [];

          for (let i = 0; i < clerkCount; i++) {
            let skills: number[];
            if (crossTrainPct >= 1 || txnIds.length <= 1) {
              skills = [...txnIds];
            } else {
              const numSkills = Math.max(1, Math.round(txnIds.length * crossTrainPct));
              const shuffled = [...txnIds];
              for (let j = shuffled.length - 1; j > 0; j--) {
                const k = (i * 7 + j * 13 + office.id * 3) % (j + 1);
                [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
              }
              skills = shuffled.slice(0, numSkills);
            }

            const lunchShiftId =
              officeLunches.length > 0 ? officeLunches[i % officeLunches.length] : null;

            await client.query(
              `INSERT INTO clerks (id, first_name, last_name, email, status, skill_ids, office_ids)
               VALUES ($1, $2, $3, $4, 'active', $5, $6)
               ON CONFLICT (id) DO UPDATE
               SET status = 'active', skill_ids = EXCLUDED.skill_ids, office_ids = EXCLUDED.office_ids,
                   first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name, email = EXCLUDED.email`,
              [
                clerkId,
                `Clerk${clerkId}`,
                `C${clerkId}`,
                `clerk${clerkId}@demo.com`,
                skills,
                [office.id],
              ],
            );

            await client.query(
              `INSERT INTO clerk_schedules (clerk_id, office_id, schedule_date, lunch_shift_id)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (clerk_id, schedule_date) DO UPDATE
               SET office_id = EXCLUDED.office_id, lunch_shift_id = EXCLUDED.lunch_shift_id`,
              [clerkId, office.id, DEMO_DATE, lunchShiftId],
            );

            clerkId++;
          }
        }
      }
    });

    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Queue Demo ─────────────────────────────────────────────────────────────

app.get("/queue-demo", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "queue-demo.html"));
});

// Reset queue state for demo: clear queue + clerk_sessions, set up fresh clerk logins
app.post("/api/queue/reset", async (req, res) => {
  try {
    const officeId = parseInt(req.body.officeId as string) || 1;
    await withTransaction(async (client) => {
      await client.query(`DELETE FROM queue WHERE office_id = $1`, [officeId]);
      await client.query(`DELETE FROM clerk_sessions WHERE office_id = $1`, [officeId]);
      const clerks = await client.query(
        `SELECT id FROM clerks WHERE $1 = ANY(office_ids) AND status = 'active' ORDER BY id LIMIT 3`,
        [officeId],
      );
      for (let i = 0; i < clerks.rows.length; i++) {
        await client.query(
          `INSERT INTO clerk_sessions (clerk_id, office_id, desk_number, is_available)
           VALUES ($1, $2, $3, TRUE)`,
          [clerks.rows[i].id, officeId, i + 1],
        );
      }
    });
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get today's scheduled appointments for the office (with required docs + upload status)
app.get("/api/queue/appointments", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string) || 1;
    const rows = await withTransaction(async (client) => {
      const result = await client.query(
        `SELECT a.id, a.first_name, a.last_name, a.appointment_time::text AS time,
                a.txn_type_ids, a.qr_code, a.is_priority, a.status,
                a.identity_verified, a.prescreen_completed, a.required_doc_ids
         FROM appointments a
         WHERE a.office_id = $1
           AND a.appointment_date = $2::date
           AND a.status = 'scheduled'
         ORDER BY a.appointment_time, a.id`,
        [officeId, DEMO_DATE],
      );

      const apptIds = result.rows.map((r: { id: number }) => r.id);
      const docsByAppt: Record<number, Record<string, unknown>[]> = {};
      if (apptIds.length > 0) {
        const docsResult = await client.query(
          `SELECT appointment_id, doc_id, name, ai_review_status
           FROM documents
           WHERE appointment_id = ANY($1)
           ORDER BY created_at`,
          [apptIds],
        );
        for (const doc of docsResult.rows) {
          (docsByAppt[doc.appointment_id as number] ??= []).push(doc);
        }
      }

      return result.rows.map((a: { id: number } & Record<string, unknown>) => ({
        ...a,
        uploaded_docs: docsByAppt[a.id] || [],
      }));
    });
    res.json(rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get document registry (names for doc_ids)
app.get("/api/queue/doc-registry", async (_req, res) => {
  try {
    const result = await pool.query(`SELECT doc_id, name, description FROM document_registry`);
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Simulate document upload for an appointment
app.post("/api/queue/upload-doc", async (req, res) => {
  try {
    const { appointmentId, docId, docName, status } = req.body;
    await pool.query(
      `INSERT INTO documents (appointment_id, doc_id, name, ai_review_status)
       VALUES ($1, $2, $3, $4)`,
      [appointmentId, docId || null, docName, status || "accept"],
    );
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get documents for an appointment
app.get("/api/queue/documents", async (req, res) => {
  try {
    const appointmentId = parseInt(req.query.appointmentId as string);
    const result = await pool.query(
      `SELECT id, name, ai_review_status FROM documents
       WHERE appointment_id = $1
       ORDER BY created_at`,
      [appointmentId],
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Mark prescreen as completed
app.post("/api/queue/mark-prescreen", async (req, res) => {
  try {
    const { appointmentId } = req.body;
    await pool.query(`UPDATE appointments SET prescreen_completed = TRUE WHERE id = $1`, [
      appointmentId,
    ]);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Check in: scan QR code → add to queue
app.post("/api/queue/check-in", async (req, res) => {
  try {
    const { appointmentId, officeId, makePriority } = req.body;
    const oid = parseInt(officeId) || 1;
    const result = await withTransaction(async (client) => {
      if (makePriority) {
        await client.query(`UPDATE appointments SET is_priority = TRUE WHERE id = $1`, [
          appointmentId,
        ]);
      }
      const { rows } = await client.query(`SELECT check_in_to_queue($1, $2) AS id`, [
        oid,
        appointmentId,
      ]);
      const queueId = rows[0].id;
      const qRow = await client.query(`SELECT queue_number FROM queue WHERE id = $1`, [queueId]);
      const apptRow = await client.query(`SELECT is_priority FROM appointments WHERE id = $1`, [
        appointmentId,
      ]);
      return {
        queueId,
        queueNumber: qRow.rows[0].queue_number,
        isPriority: apptRow.rows[0]?.is_priority || false,
      };
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get current queue state
app.get("/api/queue/state", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string) || 1;
    const data = await withTransaction(async (client) => {
      const queue = await client.query(
        `SELECT q.id, q.queue_number, q.status, q.assigned_desk, q.assigned_clerk_id,
                a.first_name, a.last_name, a.is_priority, a.txn_type_ids
         FROM queue q
         JOIN appointments a ON a.id = q.appointment_id
         WHERE q.office_id = $1
         ORDER BY q.checked_in_at`,
        [officeId],
      );
      const clerks = await client.query(
        `SELECT cs.clerk_id, cs.desk_number, cs.is_available,
                c.first_name || ' ' || LEFT(c.last_name, 1) || '.' AS name,
                c.skill_ids
         FROM clerk_sessions cs
         JOIN clerks c ON c.id = cs.clerk_id
         WHERE cs.office_id = $1 AND cs.logged_out_at IS NULL
         ORDER BY cs.desk_number`,
        [officeId],
      );
      return { queue: queue.rows, clerks: clerks.rows };
    });
    res.json(data);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Assign next customer to a clerk (clerk calls for next)
app.post("/api/queue/assign", async (req, res) => {
  try {
    const { clerkId, officeId } = req.body;
    const oid = parseInt(officeId) || 1;
    const result = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT assign_next_customer($1, $2) AS queue_id`, [
        oid,
        clerkId,
      ]);
      const queueId = rows[0].queue_id;
      if (queueId === null) return null;
      const qRow = await client.query(
        `SELECT q.assigned_desk, q.assigned_clerk_id, q.queue_number,
                a.first_name, a.last_name
         FROM queue q JOIN appointments a ON a.id = q.appointment_id
         WHERE q.id = $1`,
        [queueId],
      );
      return { queueId, ...qRow.rows[0] };
    });
    res.json(result);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Complete service — mark queue entry done, free clerk
app.post("/api/queue/complete", async (req, res) => {
  try {
    const { queueId, officeId } = req.body;
    const oid = parseInt(officeId) || 1;
    await withTransaction(async (client) => {
      const qRow = await client.query(`SELECT assigned_clerk_id FROM queue WHERE id = $1`, [
        queueId,
      ]);
      const clerkId = qRow.rows[0]?.assigned_clerk_id;
      await client.query(`UPDATE queue SET status = 'done' WHERE id = $1`, [queueId]);
      if (clerkId) {
        await client.query(
          `UPDATE clerk_sessions SET is_available = TRUE
           WHERE clerk_id = $1 AND office_id = $2 AND logged_out_at IS NULL`,
          [clerkId, oid],
        );
      }
    });
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Get txn type names for display
app.get("/api/queue/txn-types", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name FROM transaction_types WHERE office_id IS NULL ORDER BY id`,
    );
    res.json(result.rows);
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Scheduling demo at http://localhost:${PORT}/schedule-demo`);
  console.log(`Check-in schedule at http://localhost:${PORT}/schedule`);
  console.log(`Queue demo at http://localhost:${PORT}/queue-demo`);
});
