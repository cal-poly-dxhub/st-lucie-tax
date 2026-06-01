import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { pool, withTenant } from "./db.js";
import { findAppointment } from "../src/find-appt.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());

const COUNTY_ID = "stlucie";
const DEMO_DATE = "2026-05-12";
const NOW_TS = new Date("2026-05-12T06:00:00Z");

// Serve demo HTML
app.get("/", (_req, res) => {
  res.sendFile(path.resolve(__dirname, "../docs/scheduling-demo.html"));
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

// ─── GET /api/appointments/:officeId ────────────────────────────────────────
app.get("/api/appointments/:officeId", async (req, res) => {
  try {
    const officeId = parseInt(req.params.officeId);
    const rows = await withTenant(async (client) => {
      const result = await client.query(
        `SELECT a.id, a.appointment_time::text AS start_time, a.txn_type_ids,
                a.first_name, a.last_name,
                (SELECT SUM(tt.avg_duration_min)
                 FROM unnest(a.txn_type_ids) AS tid
                 JOIN transaction_types tt ON tt.id = tid AND tt.office_id IS NULL) AS duration_min
         FROM appointments a
         WHERE a.county_id = 'stlucie'
           AND a.office_id = $1
           AND a.appointment_date = $2
           AND a.status NOT IN ('cancelled', 'no_show')
         ORDER BY a.appointment_time`,
        [officeId, DEMO_DATE],
      );
      return result.rows;
    });
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/find-appointment ─────────────────────────────────────────────
app.post("/api/find-appointment", async (req, res) => {
  try {
    const { targetSkills, asap, preferredOffice, preferredDow, preferredTime } =
      req.body;

    const result = await withTenant(async (client) => {
      return findAppointment(client, {
        countyId: COUNTY_ID,
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
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/book-appointment ─────────────────────────────────────────────
app.post("/api/book-appointment", async (req, res) => {
  try {
    const { officeId, date, time, txnTypeIds, firstName, lastName } = req.body;

    const result = await withTenant(async (client) => {
      const r = await client.query(
        `SELECT book_appointment(
           p_county_id     := $1,
           p_office_id     := $2,
           p_date          := $3,
           p_time          := $4,
           p_txn_type_ids  := $5,
           p_first_name    := $6,
           p_last_name     := $7,
           p_contact_email := $8,
           p_contact_phone := $9,
           p_now_ts        := $10
         ) AS appointment_id`,
        [
          COUNTY_ID,
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
  } catch (err: any) {
    if (err.message?.includes("capacity_exceeded")) {
      res.json({ success: false, error: "capacity_exceeded" });
    } else if (err.message?.includes("office_closed")) {
      res.json({ success: false, error: "office_closed" });
    } else {
      res.status(500).json({ error: err.message });
    }
  }
});

// ─── POST /api/demo/reset ───────────────────────────────────────────────────
app.post("/api/demo/reset", async (req, res) => {
  try {
    const { clerkCount, runRatePct, crossTrain, activeTxnIds } = req.body;

    await withTenant(async (client) => {
      // Clear appointments for demo date
      await client.query(
        `DELETE FROM appointments WHERE county_id = 'stlucie' AND appointment_date = $1`,
        [DEMO_DATE],
      );

      // Toggle txn type status if provided
      if (activeTxnIds && Array.isArray(activeTxnIds)) {
        await client.query(
          `UPDATE transaction_types SET status = 'hidden' WHERE county_id = 'stlucie' AND office_id IS NULL`,
        );
        if (activeTxnIds.length > 0) {
          await client.query(
            `UPDATE transaction_types SET status = 'active' WHERE county_id = 'stlucie' AND office_id IS NULL AND id = ANY($1::int[])`,
            [activeTxnIds],
          );
        }
      }

      // Update office run rate
      if (runRatePct != null) {
        await client.query(
          `UPDATE offices SET run_rate_pct = $1 WHERE county_id = 'stlucie'`,
          [runRatePct],
        );
      }

      // Update desk count + rebuild clerks if clerkCount provided
      if (clerkCount != null) {
        await client.query(
          `UPDATE offices SET total_desks = $1 WHERE county_id = 'stlucie'`,
          [clerkCount],
        );

        // Deactivate all existing clerks
        await client.query(
          `UPDATE clerks SET status = 'inactive' WHERE county_id = 'stlucie'`,
        );

        // Clear schedules for demo date
        await client.query(
          `DELETE FROM clerk_schedules WHERE county_id = 'stlucie' AND schedule_date = $1`,
          [DEMO_DATE],
        );

        // Get offices and txn types for skill assignment
        const officesRes = await client.query(
          `SELECT id FROM offices WHERE county_id = 'stlucie' ORDER BY id`,
        );
        const txnRes = await client.query(
          `SELECT id FROM transaction_types WHERE county_id = 'stlucie' AND office_id IS NULL AND status = 'active' ORDER BY id`,
        );
        const txnIds = txnRes.rows.map((r: any) => r.id);
        const crossTrainPct = (crossTrain ?? 100) / 100;

        // Get lunch shifts
        const lunchRes = await client.query(
          `SELECT id, office_id FROM office_lunch_shifts WHERE county_id = 'stlucie' ORDER BY office_id, start_time`,
        );
        const lunchByOffice: Record<number, number[]> = {};
        for (const r of lunchRes.rows) {
          if (!lunchByOffice[r.office_id]) lunchByOffice[r.office_id] = [];
          lunchByOffice[r.office_id].push(r.id);
        }

        let clerkId = 1;
        for (const office of officesRes.rows) {
          const officeLunches = lunchByOffice[office.id] || [];

          for (let i = 0; i < clerkCount; i++) {
            // Assign skills based on cross-training
            let skills: number[];
            if (crossTrainPct >= 1 || txnIds.length <= 1) {
              skills = [...txnIds];
            } else {
              const numSkills = Math.max(
                1,
                Math.round(txnIds.length * crossTrainPct),
              );
              const shuffled = [...txnIds];
              for (let j = shuffled.length - 1; j > 0; j--) {
                const k = (i * 7 + j * 13 + office.id * 3) % (j + 1);
                [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
              }
              skills = shuffled.slice(0, numSkills);
            }

            // Assign lunch shift (stagger across shifts)
            const lunchShiftId =
              officeLunches.length > 0
                ? officeLunches[i % officeLunches.length]
                : null;

            // Upsert clerk (reuse IDs if they exist)
            const existing = await client.query(
              `SELECT id FROM clerks WHERE county_id = 'stlucie' AND id = $1`,
              [clerkId],
            );

            if (existing.rows.length > 0) {
              await client.query(
                `UPDATE clerks SET status = 'active', skill_ids = $1, office_ids = $2
                 WHERE county_id = 'stlucie' AND id = $3`,
                [skills, [office.id], clerkId],
              );
            } else {
              await client.query(
                `INSERT INTO clerks (county_id, id, first_name, last_name, email, status, skill_ids, office_ids)
                 VALUES ('stlucie', $1, $2, $3, $4, 'active', $5, $6)`,
                [
                  clerkId,
                  `Clerk${clerkId}`,
                  `C${clerkId}`,
                  `clerk${clerkId}@demo.com`,
                  skills,
                  [office.id],
                ],
              );
            }

            // Schedule for demo date
            await client.query(
              `INSERT INTO clerk_schedules (county_id, clerk_id, office_id, schedule_date, lunch_shift_id)
               VALUES ('stlucie', $1, $2, $3, $4)
               ON CONFLICT (county_id, clerk_id, schedule_date) DO UPDATE
               SET office_id = EXCLUDED.office_id, lunch_shift_id = EXCLUDED.lunch_shift_id`,
              [clerkId, office.id, DEMO_DATE, lunchShiftId],
            );

            clerkId++;
          }
        }
      }
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 3000);
app.listen(PORT, () => {
  console.log(`Scheduling demo harness running at http://localhost:${PORT}`);
});
