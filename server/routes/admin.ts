import { Router } from "express";
import { pool, withTransaction } from "../db.js";
import { sendError } from "../middleware/errors.js";

const router = Router();

const fail = (res: import("express").Response, err: unknown) => sendError(res, err, "admin");

// ─── Offices ─────────────────────────────────────────────────────────────────
router.get("/offices", async (_req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.post("/offices", async (req, res) => {
  try {
    const { name, address, totalDesks, runRatePct } = req.body;
    if (!name || !totalDesks)
      return res.status(400).json({ error: "name and totalDesks required" });
    const { rows } = await pool.query(
      `INSERT INTO offices (name, address, total_desks, run_rate_pct) VALUES ($1, $2, $3, $4) RETURNING id`,
      [name, address || null, totalDesks, runRatePct || 100],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/offices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, address, totalDesks, runRatePct } = req.body;
    await pool.query(
      `UPDATE offices SET name = COALESCE($2, name), address = COALESCE($3, address),
       total_desks = COALESCE($4, total_desks), run_rate_pct = COALESCE($5, run_rate_pct) WHERE id = $1`,
      [id, name ?? null, address, totalDesks ?? null, runRatePct ?? null],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/offices/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM offices WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Office Hours ────────────────────────────────────────────────────────────
router.post("/office-hours", async (req, res) => {
  try {
    const { officeId, dayOfWeek, openTime, closeTime } = req.body;
    await pool.query(
      `INSERT INTO office_hours (office_id, day_of_week, open_time, close_time)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (office_id, day_of_week) DO UPDATE SET open_time = $3, close_time = $4`,
      [officeId, dayOfWeek, openTime, closeTime],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/office-hours/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM office_hours WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Lunch Shifts ────────────────────────────────────────────────────────────
router.post("/lunch-shifts", async (req, res) => {
  try {
    const { officeId, shiftNum, startTime, endTime } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO office_lunch_shifts (office_id, shift_num, start_time, end_time)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [officeId, shiftNum, startTime, endTime],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/lunch-shifts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await pool.query(`UPDATE clerk_schedules SET lunch_shift_id = NULL WHERE lunch_shift_id = $1`, [
      id,
    ]);
    await pool.query(`DELETE FROM office_lunch_shifts WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Transaction Types ───────────────────────────────────────────────────────
router.get("/transaction-types", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, txn_type_id, office_id, name, description, avg_duration_min,
              status, available_from::text, available_until::text,
              is_online_eligible, online_redirect_url
       FROM transaction_types ORDER BY office_id NULLS FIRST, id`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/transaction-types", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.put("/transaction-types/:id", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/transaction-types/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM transaction_types WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Clerks ──────────────────────────────────────────────────────────────────
router.get("/clerks", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, first_name, last_name, email, status, skill_ids, office_ids FROM clerks ORDER BY id`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/clerks", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.put("/clerks/:id", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/clerks/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM clerks WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.post("/clerks/bulk-import", async (req, res) => {
  try {
    const { clerks: clerkRows } = req.body;
    if (!Array.isArray(clerkRows) || !clerkRows.length)
      return res.status(400).json({ error: "clerks array required" });
    if (clerkRows.length > 500)
      return res.status(400).json({ error: "Maximum 500 clerks per import" });
    const inserted = await withTransaction(async (client) => {
      const ids = [];
      for (const c of clerkRows) {
        const { rows } = await client.query(
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
        ids.push(rows[0].id);
      }
      return ids;
    });
    res.json({ ok: true, count: inserted.length, ids: inserted });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Hotbuttons ──────────────────────────────────────────────────────────────
router.get("/hotbuttons", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, sort_order, label, prompt FROM hotbuttons ORDER BY sort_order`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/hotbuttons", async (req, res) => {
  try {
    const { sortOrder, label, prompt } = req.body;
    if (!label || !prompt) return res.status(400).json({ error: "label and prompt required" });
    const { rows } = await pool.query(
      `INSERT INTO hotbuttons (sort_order, label, prompt) VALUES ($1, $2, $3) RETURNING id`,
      [sortOrder || 0, label, prompt],
    );
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/hotbuttons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sortOrder, label, prompt } = req.body;
    await pool.query(
      `UPDATE hotbuttons SET sort_order = COALESCE($2, sort_order), label = COALESCE($3, label), prompt = COALESCE($4, prompt) WHERE id = $1`,
      [id, sortOrder ?? null, label || null, prompt || null],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/hotbuttons/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM hotbuttons WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Prescreen Questions ─────────────────────────────────────────────────────
router.get("/prescreen-questions", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT pq.id, pq.txn_type_id, pq.sort_order, pq.question_text, tt.name AS txn_name
       FROM prescreen_questions pq
       JOIN transaction_types tt ON tt.id = pq.txn_type_id
       ORDER BY pq.txn_type_id, pq.sort_order`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/prescreen-questions", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.put("/prescreen-questions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sortOrder, questionText } = req.body;
    await pool.query(
      `UPDATE prescreen_questions SET sort_order = COALESCE($2, sort_order), question_text = COALESCE($3, question_text) WHERE id = $1`,
      [id, sortOrder ?? null, questionText || null],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/prescreen-questions/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM prescreen_questions WHERE id = $1`, [parseInt(req.params.id)]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Skills Matrix ───────────────────────────────────────────────────────────
router.get("/skills-matrix", async (_req, res) => {
  try {
    const { rows: clerks } = await pool.query(
      `SELECT c.id, c.first_name, c.last_name, c.skill_ids, c.status FROM clerks c ORDER BY c.id`,
    );
    const { rows: txnTypes } = await pool.query(
      `SELECT id, name FROM transaction_types WHERE office_id IS NULL ORDER BY id`,
    );
    res.json({ clerks, txnTypes });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/clerk-skills/:clerkId", async (req, res) => {
  try {
    const clerkId = parseInt(req.params.clerkId);
    const { skillIds } = req.body;
    if (!Array.isArray(skillIds)) return res.status(400).json({ error: "skillIds array required" });
    await pool.query(`UPDATE clerks SET skill_ids = $2 WHERE id = $1`, [clerkId, skillIds]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Transaction-Office Matrix ───────────────────────────────────────────────
router.get("/txn-office-matrix", async (_req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.post("/txn-office-override", async (req, res) => {
  try {
    const { txnTypeId, officeId, status, availableFrom, availableUntil } = req.body;
    if (!txnTypeId || !officeId)
      return res.status(400).json({ error: "txnTypeId and officeId required" });
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
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/txn-office-override/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM transaction_types WHERE id = $1 AND office_id IS NOT NULL`, [
      parseInt(req.params.id),
    ]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Document Registry ───────────────────────────────────────────────────────
router.get("/document-registry", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT doc_id, name, description, alternatives FROM document_registry ORDER BY doc_id`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/document-registry", async (req, res) => {
  try {
    const { docId, name, description, alternatives } = req.body;
    if (!docId || !name) return res.status(400).json({ error: "docId and name required" });
    await pool.query(
      `INSERT INTO document_registry (doc_id, name, description, alternatives) VALUES ($1, $2, $3, $4)`,
      [docId, name, description || null, alternatives || []],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/document-registry/:docId", async (req, res) => {
  try {
    const docId = req.params.docId;
    const { name, description, alternatives } = req.body;
    await pool.query(
      `UPDATE document_registry SET name = COALESCE($2, name), description = COALESCE($3, description), alternatives = COALESCE($4, alternatives) WHERE doc_id = $1`,
      [docId, name || null, description, alternatives || null],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/document-registry/:docId", async (req, res) => {
  try {
    await pool.query(`DELETE FROM document_registry WHERE doc_id = $1`, [req.params.docId]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Transaction Flows ───────────────────────────────────────────────────────
router.get("/transaction-flows", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tf.id, tf.txn_type_id, tt.name AS txn_name, tf.steps
       FROM transaction_flows tf
       JOIN transaction_types tt ON tt.id = tf.txn_type_id
       ORDER BY tf.txn_type_id`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.put("/transaction-flows/:txnTypeId", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

// ─── Performance Metrics ─────────────────────────────────────────────────────
router.get("/performance-metrics", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const interval = `${days} days`;

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
      [interval],
    );
    const { rows: dailyTimes } = await pool.query(
      `SELECT DATE(sh.served_at) AS day,
              ROUND(AVG(sh.duration_sec) / 60.0, 1) AS avg_minutes,
              COUNT(*)::int AS count
       FROM service_history sh
       WHERE sh.served_at >= NOW() - $1::interval
       GROUP BY DATE(sh.served_at)
       ORDER BY day`,
      [interval],
    );
    const { rows: dailyVolume } = await pool.query(
      `SELECT DATE(sh.served_at) AS day, COUNT(*)::int AS customers_served
       FROM service_history sh
       WHERE sh.served_at >= NOW() - $1::interval
       GROUP BY DATE(sh.served_at)
       ORDER BY day`,
      [interval],
    );
    const { rows: waitTimes } = await pool.query(
      `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (q.served_at - q.checked_in_at))) / 60.0, 1) AS avg_wait_minutes,
              COUNT(*)::int AS sample_count
       FROM queue q
       WHERE q.status = 'done' AND q.served_at IS NOT NULL
         AND q.checked_in_at >= NOW() - $1::interval`,
      [interval],
    );
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
      [interval],
    );

    res.json({
      avgByTxn,
      dailyTimes,
      dailyVolume,
      waitTimes: waitTimes[0] || { avg_wait_minutes: null, sample_count: 0 },
      officeMetrics,
    });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Duration Recommendations ────────────────────────────────────────────────
router.get("/duration-recommendations", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT dr.id, dr.txn_type_id, tt.name AS txn_name, dr.current_avg_min,
              dr.recommended_avg_min, dr.sample_size, dr.status, dr.created_at
       FROM duration_recommendations dr
       JOIN transaction_types tt ON tt.id = dr.txn_type_id
       ORDER BY dr.created_at DESC`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/duration-recommendations/:id/approve", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

router.post("/duration-recommendations/:id/reject", async (req, res) => {
  try {
    await pool.query(`UPDATE duration_recommendations SET status = 'rejected' WHERE id = $1`, [
      parseInt(req.params.id),
    ]);
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Global Config ───────────────────────────────────────────────────────────
router.get("/config", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT timezone, scheduling_block_padding, default_lookahead_days FROM config`,
    );
    res.json(rows[0] || {});
  } catch (err) {
    fail(res, err);
  }
});

router.put("/config", async (req, res) => {
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
  } catch (err) {
    fail(res, err);
  }
});

export default router;
