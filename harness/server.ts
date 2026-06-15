import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool, withTenant } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const COUNTY_ID = "stlucie";
const DEMO_DATE = "2026-05-13";

app.get("/schedule", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "check-in-schedule.html"));
});

// ─── GET /api/config ────────────────────────────────────────────────────────
app.get("/api/config", async (_req, res) => {
  try {
    const data = await withTenant(async (client) => {
      const offices = await client.query(
        `SELECT id, name, total_desks, run_rate_pct FROM offices WHERE county_id = 'stlucie' ORDER BY id`,
      );
      const txnTypes = await client.query(
        `SELECT id, txn_type_id AS slug, name, avg_duration_min AS duration,
                available_from::text, available_until::text, status
         FROM transaction_types
         WHERE county_id = 'stlucie' AND office_id IS NULL
         ORDER BY id`,
      );
      const clerks = await client.query(
        `SELECT c.id, c.first_name || ' ' || LEFT(c.last_name, 1) || '.' AS name,
                c.skill_ids, c.office_ids
         FROM clerks c
         WHERE c.county_id = 'stlucie' AND c.status = 'active'
         ORDER BY c.id`,
      );
      const lunchShifts = await client.query(
        `SELECT id, office_id, shift_num, start_time::text, end_time::text
         FROM office_lunch_shifts
         WHERE county_id = 'stlucie'
         ORDER BY office_id, start_time`,
      );
      const clerkSchedules = await client.query(
        `SELECT clerk_id, office_id, lunch_shift_id
         FROM clerk_schedules
         WHERE county_id = 'stlucie' AND schedule_date = $1`,
        [DEMO_DATE],
      );
      const officeHours = await client.query(
        `SELECT office_id, day_of_week, open_time::text, close_time::text
         FROM office_hours WHERE county_id = 'stlucie'`,
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/schedule/appointments ─────────────────────────────────────────
app.get("/api/schedule/appointments", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string);
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;

    if (isNaN(officeId) || !startDate || !endDate) {
      return res
        .status(400)
        .json({ error: "officeId, startDate, endDate required" });
    }

    const rows = await withTenant(async (client) => {
      const result = await client.query(
        `SELECT a.id, a.office_id, a.appointment_date::text, a.appointment_time::text AS start_time,
                a.txn_type_ids, a.first_name, a.last_name, a.status,
                (SELECT SUM(tt.avg_duration_min)
                 FROM unnest(a.txn_type_ids) AS tid
                 JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL) AS duration_min
         FROM appointments a
         WHERE a.county_id = 'stlucie'
           AND a.office_id = $1
           AND a.appointment_date BETWEEN $2 AND $3
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.appointment_date, a.appointment_time`,
        [officeId, startDate, endDate],
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/schedule/reschedule ──────────────────────────────────────────
app.post("/api/schedule/reschedule", async (req, res) => {
  try {
    const { appointmentId, newDate, newTime, force } = req.body;

    if (!appointmentId || !newDate || !newTime) {
      return res
        .status(400)
        .json({ error: "appointmentId, newDate, newTime required" });
    }

    const result = await withTenant(async (client) => {
      const apptRes = await client.query(
        `SELECT id, office_id, txn_type_ids FROM appointments
         WHERE county_id = 'stlucie' AND id = $1 AND status NOT IN ('cancelled', 'no_show')`,
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

      // Temporarily hide this appointment to check capacity at new slot
      await client.query(
        `UPDATE appointments SET status = 'cancelled' WHERE id = $1`,
        [appointmentId],
      );

      if (!force) {
        const capRes = await client.query(
          `SELECT validate_slot('stlucie', $1, $2::date, $3::time, $4, $5) AS available`,
          [appt.office_id, newDate, newTime, appt.txn_type_ids, duration],
        );
        const available = capRes.rows[0]?.available || 0;

        if (available <= 0) {
          await client.query(
            `UPDATE appointments SET status = 'scheduled' WHERE id = $1`,
            [appointmentId],
          );
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
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
    await withTenant(async (client) => {
      await client.query(
        `DELETE FROM queue WHERE county_id = $1 AND office_id = $2`,
        [COUNTY_ID, officeId],
      );
      await client.query(
        `DELETE FROM clerk_sessions WHERE county_id = $1 AND office_id = $2`,
        [COUNTY_ID, officeId],
      );
      // Log in clerks at desks 1-3
      const clerks = await client.query(
        `SELECT id FROM clerks WHERE county_id = $1 AND $2 = ANY(office_ids) AND status = 'active' ORDER BY id LIMIT 3`,
        [COUNTY_ID, officeId],
      );
      for (let i = 0; i < clerks.rows.length; i++) {
        await client.query(
          `INSERT INTO clerk_sessions (county_id, clerk_id, office_id, desk_number, is_available)
           VALUES ($1, $2, $3, $4, TRUE)`,
          [COUNTY_ID, clerks.rows[i].id, officeId, i + 1],
        );
      }
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get today's scheduled appointments for the office
app.get("/api/queue/appointments", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string) || 1;
    const rows = await withTenant(async (client) => {
      const result = await client.query(
        `SELECT a.id, a.first_name, a.last_name, a.appointment_time::text AS time,
                a.txn_type_ids, a.qr_code, a.is_priority, a.status,
                a.identity_verified, a.prescreen_completed
         FROM appointments a
         WHERE a.county_id = $1 AND a.office_id = $2
           AND a.appointment_date = $3::date
           AND a.status = 'scheduled'
         ORDER BY a.appointment_time, a.id`,
        [COUNTY_ID, officeId, DEMO_DATE],
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Simulate document upload for an appointment
app.post("/api/queue/upload-doc", async (req, res) => {
  try {
    const { appointmentId, docName, status } = req.body;
    await withTenant(async (client) => {
      await client.query(
        `INSERT INTO documents (county_id, appointment_id, name, ai_review_status)
         VALUES ($1, $2, $3, $4)`,
        [COUNTY_ID, appointmentId, docName, status || "accept"],
      );
    });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get documents for an appointment
app.get("/api/queue/documents", async (req, res) => {
  try {
    const appointmentId = parseInt(req.query.appointmentId as string);
    const rows = await withTenant(async (client) => {
      const result = await client.query(
        `SELECT id, name, ai_review_status FROM documents
         WHERE county_id = $1 AND appointment_id = $2
         ORDER BY created_at`,
        [COUNTY_ID, appointmentId],
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check in: scan QR code → add to queue
app.post("/api/queue/check-in", async (req, res) => {
  try {
    const { appointmentId, officeId, makePriority } = req.body;
    const oid = parseInt(officeId) || 1;
    const result = await withTenant(async (client) => {
      if (makePriority) {
        await client.query(
          `UPDATE appointments SET is_priority = TRUE WHERE id = $1`,
          [appointmentId],
        );
      }
      const { rows } = await client.query(
        `SELECT check_in_to_queue($1, $2, $3) AS id`,
        [COUNTY_ID, oid, appointmentId],
      );
      const queueId = rows[0].id;
      const qRow = await client.query(
        `SELECT queue_number FROM queue WHERE id = $1`,
        [queueId],
      );
      const apptRow = await client.query(
        `SELECT is_priority FROM appointments WHERE id = $1`,
        [appointmentId],
      );
      return {
        queueId,
        queueNumber: qRow.rows[0].queue_number,
        isPriority: apptRow.rows[0]?.is_priority || false,
      };
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get current queue state
app.get("/api/queue/state", async (req, res) => {
  try {
    const officeId = parseInt(req.query.officeId as string) || 1;
    const data = await withTenant(async (client) => {
      const queue = await client.query(
        `SELECT q.id, q.queue_number, q.status, q.assigned_desk, q.assigned_clerk_id,
                a.first_name, a.last_name, a.is_priority, a.txn_type_ids
         FROM queue q
         JOIN appointments a ON a.id = q.appointment_id
         WHERE q.county_id = $1 AND q.office_id = $2
         ORDER BY q.checked_in_at`,
        [COUNTY_ID, officeId],
      );
      const clerks = await client.query(
        `SELECT cs.clerk_id, cs.desk_number, cs.is_available,
                c.first_name || ' ' || LEFT(c.last_name, 1) || '.' AS name,
                c.skill_ids
         FROM clerk_sessions cs
         JOIN clerks c ON c.id = cs.clerk_id
         WHERE cs.county_id = $1 AND cs.office_id = $2 AND cs.logged_out_at IS NULL
         ORDER BY cs.desk_number`,
        [COUNTY_ID, officeId],
      );
      return { queue: queue.rows, clerks: clerks.rows };
    });
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Assign next customer to a clerk (clerk calls for next)
app.post("/api/queue/assign", async (req, res) => {
  try {
    const { clerkId, officeId } = req.body;
    const oid = parseInt(officeId) || 1;
    const result = await withTenant(async (client) => {
      const { rows } = await client.query(
        `SELECT assign_next_customer($1, $2, $3) AS queue_id`,
        [COUNTY_ID, oid, clerkId],
      );
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Complete service — mark queue entry done, free clerk
app.post("/api/queue/complete", async (req, res) => {
  try {
    const { queueId, officeId } = req.body;
    const oid = parseInt(officeId) || 1;
    await withTenant(async (client) => {
      const qRow = await client.query(
        `SELECT assigned_clerk_id FROM queue WHERE id = $1`,
        [queueId],
      );
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get txn type names for display
app.get("/api/queue/txn-types", async (_req, res) => {
  try {
    const rows = await withTenant(async (client) => {
      const result = await client.query(
        `SELECT id, name FROM transaction_types WHERE county_id = $1 AND office_id IS NULL ORDER BY id`,
        [COUNTY_ID],
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/schedule`);
  console.log(`Queue demo at http://localhost:${PORT}/queue-demo`);
});
