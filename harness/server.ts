import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool, withTenant } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const COUNTY_ID = "stlucie";
const DEMO_DATE = "2026-05-12";

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

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/schedule`);
});
