import { Router } from "express";
import { pool, withTransaction } from "../db.js";
import { sendError } from "../middleware/errors.js";
import { buildAuditLogQueries, logAuditEvent } from "../audit.js";
import { propagateLunchTemplate, type LunchTemplateAssignment } from "../../src/lunch-template.js";

const router = Router();

const fail = (res: import("express").Response, err: unknown) => sendError(res, err, "admin");

const optionalQueryString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const isValidAuditTimestamp = (value: string | undefined) =>
  value === undefined || !Number.isNaN(Date.parse(value));

// ─── Transaction-type description (routing metadata) ───────────────────────────
//
// transaction_types.description stores a JSON blob of TransactionTypeMetadata
// (summary, keywords, commonPhrases, requiredDocuments, …) that the chatbot
// parses for routing. The admin only edits the human-facing `summary`, so the
// write path parse-merges: read the existing blob, replace ONLY `.summary`, and
// re-serialize — never clobbering the structured siblings. A naive plain-string
// overwrite would make the chatbot's parseDescription fall back to defaults and
// silently wipe keywords/commonPhrases/requiredDocuments.

/** Pull the human-facing summary out of a description JSON blob for display. */
export const extractSummary = (description: string | null): string => {
  if (!description) return "";
  try {
    const parsed: unknown = JSON.parse(description);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { summary?: unknown }).summary === "string"
    ) {
      return (parsed as { summary: string }).summary;
    }
    return "";
  } catch {
    // Legacy plain-string description — the whole value is the summary.
    return description;
  }
};

/**
 * Merge a new summary into an existing description blob, preserving all other
 * metadata fields. Returns the existing value unchanged when no summary is
 * supplied (so callers can COALESCE), and a well-formed `{summary}` object when
 * the existing value is missing or legacy-non-JSON.
 */
export const mergeSummaryIntoDescription = (
  existing: string | null,
  summary: string | undefined,
): string | null => {
  if (summary === undefined) return existing;
  let meta: Record<string, unknown> = {};
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (parsed && typeof parsed === "object") meta = parsed as Record<string, unknown>;
    } catch {
      // Legacy plain-string description: start fresh; the string was itself the
      // summary and is being replaced anyway, so nothing structured is lost.
    }
  }
  meta.summary = summary;
  return JSON.stringify(meta);
};

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
    await logAuditEvent(req, {
      action: "create",
      entityType: "office",
      entityId: rows[0].id,
      details: { name },
    });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/offices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, address, totalDesks, runRatePct } = req.body;
    const { rows: beforeRows } = await pool.query(
      `SELECT id, name, address, total_desks, run_rate_pct FROM offices WHERE id = $1`,
      [id],
    );
    const { rows: afterRows } = await pool.query(
      `UPDATE offices SET name = COALESCE($2, name), address = COALESCE($3, address),
       total_desks = COALESCE($4, total_desks), run_rate_pct = COALESCE($5, run_rate_pct)
       WHERE id = $1
       RETURNING id, name, address, total_desks, run_rate_pct`,
      [id, name ?? null, address, totalDesks ?? null, runRatePct ?? null],
    );
    await logAuditEvent(req, {
      action: "update",
      entityType: "office",
      entityId: id,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/offices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM offices WHERE id = $1
       RETURNING id, name, address, total_desks, run_rate_pct`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "office",
        entityId: id,
        before: rows[0],
      });
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Office Hours ────────────────────────────────────────────────────────────
router.post("/office-hours", async (req, res) => {
  try {
    const { officeId, dayOfWeek, openTime, closeTime } = req.body;
    const { rows: beforeRows } = await pool.query(
      `SELECT id, office_id, day_of_week, open_time::text, close_time::text
       FROM office_hours WHERE office_id = $1 AND day_of_week = $2`,
      [officeId, dayOfWeek],
    );
    const { rows: afterRows } = await pool.query(
      `INSERT INTO office_hours (office_id, day_of_week, open_time, close_time)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (office_id, day_of_week) DO UPDATE SET open_time = $3, close_time = $4
       RETURNING id, office_id, day_of_week, open_time::text, close_time::text`,
      [officeId, dayOfWeek, openTime, closeTime],
    );
    await logAuditEvent(req, {
      action: "update",
      entityType: "office_hours",
      entityId: afterRows[0]?.id ?? officeId,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/office-hours/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM office_hours WHERE id = $1
       RETURNING id, office_id, day_of_week, open_time::text, close_time::text`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "office_hours",
        entityId: id,
        before: rows[0],
      });
    }
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
    await logAuditEvent(req, {
      action: "create",
      entityType: "lunch_shift",
      entityId: rows[0].id,
      details: { officeId, shiftNum, startTime, endTime },
    });
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
    const { rows } = await pool.query(
      `DELETE FROM office_lunch_shifts WHERE id = $1
       RETURNING id, office_id, shift_num, start_time::text, end_time::text`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "lunch_shift",
        entityId: id,
        before: rows[0],
      });
    }
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
    // Surface the human-facing summary so the admin UI can edit it without
    // parsing the metadata JSON blob itself.
    res.json(rows.map((r) => ({ ...r, summary: extractSummary(r.description) })));
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
      summary,
      avgDurationMin,
      status,
      availableFrom,
      availableUntil,
      isOnlineEligible,
      onlineRedirectUrl,
    } = req.body;
    if (!txnTypeId || !name || !avgDurationMin)
      return res.status(400).json({ error: "txnTypeId, name, avgDurationMin required" });
    // Seed the metadata blob from the given summary (empty siblings, matching the
    // chatbot's DEFAULT_METADATA shape); null when no summary supplied.
    const description = mergeSummaryIntoDescription(null, summary);
    const { rows } = await pool.query(
      `INSERT INTO transaction_types (txn_type_id, office_id, name, description, avg_duration_min, status, available_from, available_until, is_online_eligible, online_redirect_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
      [
        txnTypeId,
        officeId || null,
        name,
        description,
        avgDurationMin,
        status || "active",
        availableFrom || null,
        availableUntil || null,
        isOnlineEligible || false,
        onlineRedirectUrl || null,
      ],
    );
    await logAuditEvent(req, {
      action: "create",
      entityType: "transaction_type",
      entityId: rows[0].id,
      details: { txnTypeId, name },
    });
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
      summary,
      avgDurationMin,
      status,
      availableFrom,
      availableUntil,
      isOnlineEligible,
      onlineRedirectUrl,
    } = req.body;
    const { rows: beforeRows } = await pool.query(
      `SELECT id, txn_type_id, office_id, name, description, avg_duration_min,
              status, available_from::text, available_until::text,
              is_online_eligible, online_redirect_url
       FROM transaction_types WHERE id = $1`,
      [id],
    );
    // Parse-merge: replace only the summary sub-field, preserving keywords,
    // commonPhrases, requiredDocuments, etc. Undefined summary → COALESCE keeps
    // the existing blob unchanged.
    const description = mergeSummaryIntoDescription(beforeRows[0]?.description ?? null, summary);
    const { rows: afterRows } = await pool.query(
      `UPDATE transaction_types SET
       name = COALESCE($2, name),
       description = COALESCE($3, description),
       avg_duration_min = COALESCE($4, avg_duration_min),
       status = COALESCE($5, status),
       available_from = $6,
       available_until = $7,
       is_online_eligible = COALESCE($8, is_online_eligible),
       online_redirect_url = $9
       WHERE id = $1
       RETURNING id, txn_type_id, office_id, name, description, avg_duration_min,
                 status, available_from::text, available_until::text,
                 is_online_eligible, online_redirect_url`,
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
    await logAuditEvent(req, {
      action: "update",
      entityType: "transaction_type",
      entityId: id,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/transaction-types/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM transaction_types WHERE id = $1
       RETURNING id, txn_type_id, office_id, name, description, avg_duration_min,
                 status, available_from::text, available_until::text,
                 is_online_eligible, online_redirect_url`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "transaction_type",
        entityId: id,
        before: rows[0],
      });
    }
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
    await logAuditEvent(req, {
      action: "create",
      entityType: "clerk",
      entityId: rows[0].id,
      details: { firstName, lastName, email },
    });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/clerks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { firstName, lastName, email, status, skillIds, officeIds } = req.body;
    const { rows: beforeRows } = await pool.query(
      `SELECT id, first_name, last_name, email, status, skill_ids, office_ids
       FROM clerks WHERE id = $1`,
      [id],
    );
    const { rows: afterRows } = await pool.query(
      `UPDATE clerks SET
       first_name = COALESCE($2, first_name),
       last_name = COALESCE($3, last_name),
       email = COALESCE($4, email),
       status = COALESCE($5, status),
       skill_ids = COALESCE($6, skill_ids),
       office_ids = COALESCE($7, office_ids)
       WHERE id = $1
       RETURNING id, first_name, last_name, email, status, skill_ids, office_ids`,
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
    await logAuditEvent(req, {
      action: "update",
      entityType: "clerk",
      entityId: id,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/clerks/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM clerks WHERE id = $1
       RETURNING id, first_name, last_name, email, status, skill_ids, office_ids`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "clerk",
        entityId: id,
        before: rows[0],
      });
    }
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
    await logAuditEvent(req, {
      action: "create",
      entityType: "hotbutton",
      entityId: rows[0].id,
      details: { label },
    });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/hotbuttons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sortOrder, label, prompt } = req.body;
    const { rows: beforeRows } = await pool.query(
      `SELECT id, sort_order, label, prompt FROM hotbuttons WHERE id = $1`,
      [id],
    );
    const { rows: afterRows } = await pool.query(
      `UPDATE hotbuttons
       SET sort_order = COALESCE($2, sort_order), label = COALESCE($3, label), prompt = COALESCE($4, prompt)
       WHERE id = $1
       RETURNING id, sort_order, label, prompt`,
      [id, sortOrder ?? null, label || null, prompt || null],
    );
    await logAuditEvent(req, {
      action: "update",
      entityType: "hotbutton",
      entityId: id,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/hotbuttons/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM hotbuttons WHERE id = $1 RETURNING id, sort_order, label, prompt`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "hotbutton",
        entityId: id,
        before: rows[0],
      });
    }
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
    await logAuditEvent(req, {
      action: "create",
      entityType: "prescreen_question",
      entityId: rows[0].id,
      details: { txnTypeId, questionText },
    });
    res.json({ ok: true, id: rows[0].id });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/prescreen-questions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { sortOrder, questionText } = req.body;
    const { rows: beforeRows } = await pool.query(
      `SELECT id, txn_type_id, sort_order, question_text FROM prescreen_questions WHERE id = $1`,
      [id],
    );
    const { rows: afterRows } = await pool.query(
      `UPDATE prescreen_questions
       SET sort_order = COALESCE($2, sort_order), question_text = COALESCE($3, question_text)
       WHERE id = $1
       RETURNING id, txn_type_id, sort_order, question_text`,
      [id, sortOrder ?? null, questionText || null],
    );
    await logAuditEvent(req, {
      action: "update",
      entityType: "prescreen_question",
      entityId: id,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/prescreen-questions/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `DELETE FROM prescreen_questions WHERE id = $1
       RETURNING id, txn_type_id, sort_order, question_text`,
      [id],
    );
    if (rows[0]) {
      await logAuditEvent(req, {
        action: "delete",
        entityType: "prescreen_question",
        entityId: id,
        before: rows[0],
      });
    }
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
    const { rows: beforeRows } = await pool.query(
      `SELECT id, skill_ids FROM clerks WHERE id = $1`,
      [clerkId],
    );
    const { rows: afterRows } = await pool.query(
      `UPDATE clerks SET skill_ids = $2 WHERE id = $1 RETURNING id, skill_ids`,
      [clerkId, skillIds],
    );
    await logAuditEvent(req, {
      action: "update",
      entityType: "clerk_skills",
      entityId: clerkId,
      before: beforeRows[0] ?? null,
      after: afterRows[0] ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Transaction-Office Matrix ───────────────────────────────────────────────
router.get("/txn-office-matrix", async (_req, res) => {
  try {
    const { rows: offices } = await pool.query(
      `SELECT o.id, o.name,
              MIN(oh.open_time)::text AS earliest_open,
              MAX(oh.close_time)::text AS latest_close
       FROM offices o
       LEFT JOIN office_hours oh ON oh.office_id = o.id
       GROUP BY o.id
       ORDER BY o.id`,
    );
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

    const effectiveStatus = status || "active";
    const validStatuses = ["active", "hidden", "internal"];
    if (!validStatuses.includes(effectiveStatus))
      return res.status(400).json({ error: `status must be one of: ${validStatuses.join(", ")}` });

    // Validate time window is within office hours
    if (availableFrom || availableUntil) {
      const { rows: hoursRows } = await pool.query(
        `SELECT MIN(open_time)::text AS earliest_open, MAX(close_time)::text AS latest_close
         FROM office_hours WHERE office_id = $1`,
        [officeId],
      );
      if (hoursRows.length && hoursRows[0].earliest_open) {
        const open = hoursRows[0].earliest_open.slice(0, 5);
        const close = hoursRows[0].latest_close.slice(0, 5);
        const from = availableFrom ? availableFrom.slice(0, 5) : null;
        const until = availableUntil ? availableUntil.slice(0, 5) : null;
        if (from && from < open)
          return res
            .status(400)
            .json({ error: `availableFrom (${from}) is before office opens (${open})` });
        if (until && until > close)
          return res
            .status(400)
            .json({ error: `availableUntil (${until}) is after office closes (${close})` });
      }
    }

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
        effectiveStatus,
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
      `SELECT tf.id, tf.txn_type_id, tt.txn_type_id AS slug, tt.name AS txn_name, tf.steps
       FROM transaction_flows tf
       JOIN transaction_types tt ON tt.id = tf.txn_type_id
       ORDER BY tt.name`,
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

// ─── Clerk Performance Comparison ───────────────────────────────────────────
router.get("/clerk-performance", async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days as string) || 30, 365);
    const interval = `${days} days`;

    const { rows } = await pool.query(
      `SELECT c.id AS clerk_id,
              c.first_name, c.last_name,
              COUNT(*)::int AS total_served,
              ROUND(AVG(sh.duration_sec) / 60.0, 1) AS avg_minutes,
              ROUND(MIN(sh.duration_sec) / 60.0, 1) AS min_minutes,
              ROUND(MAX(sh.duration_sec) / 60.0, 1) AS max_minutes
       FROM service_history sh
       JOIN clerks c ON c.id = sh.clerk_id
       WHERE sh.served_at >= NOW() - $1::interval
         AND sh.clerk_id IS NOT NULL
       GROUP BY c.id, c.first_name, c.last_name
       ORDER BY avg_minutes`,
      [interval],
    );

    const { rows: byTxn } = await pool.query(
      `SELECT c.id AS clerk_id,
              c.first_name, c.last_name,
              tt.name AS txn_name, tt.id AS txn_type_id,
              COUNT(*)::int AS count,
              ROUND(AVG(sh.duration_sec) / 60.0, 1) AS avg_minutes
       FROM service_history sh
       JOIN clerks c ON c.id = sh.clerk_id
       JOIN service_history_txn_types sht ON sht.service_history_id = sh.id
       JOIN transaction_types tt ON tt.id = sht.txn_type_id
       WHERE sh.served_at >= NOW() - $1::interval
         AND sh.clerk_id IS NOT NULL
       GROUP BY c.id, c.first_name, c.last_name, tt.id, tt.name
       ORDER BY c.last_name, tt.name`,
      [interval],
    );

    res.json({ summary: rows, byTransactionType: byTxn });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Audit Log ───────────────────────────────────────────────────────────────

router.get("/audit-log", async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 100, 1), 500);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
    const entityType = optionalQueryString(req.query.entityType);
    const search = optionalQueryString(req.query.search)?.slice(0, 200);
    const startAt = optionalQueryString(req.query.startAt);
    const endAt = optionalQueryString(req.query.endAt);

    if (!isValidAuditTimestamp(startAt) || !isValidAuditTimestamp(endAt)) {
      return res.status(400).json({ error: "startAt and endAt must be valid ISO timestamps" });
    }
    if (startAt && endAt && new Date(startAt) > new Date(endAt)) {
      return res.status(400).json({ error: "startAt must be before endAt" });
    }

    const { query, params, countQuery, countParams } = buildAuditLogQueries({
      limit,
      offset,
      entityType,
      search,
      startAt,
      endAt,
    });
    const { rows } = await pool.query(query, params);
    const { rows: countRows } = await pool.query(countQuery, countParams);

    res.json({ entries: rows, total: countRows[0].total });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Decision Trees ──────────────────────────────────────────────────────────
// Canonical source is transaction_flows.steps (seeded by db/seed-flows.sql).

router.get("/decision-trees", async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT tf.id,
              tt.txn_type_id AS tree_id,
              1 AS version,
              'approved' AS status,
              'system' AS created_by,
              NOW() AS created_at,
              NULL AS approved_by,
              NULL AS approved_at
       FROM transaction_flows tf
       JOIN transaction_types tt ON tt.id = tf.txn_type_id
       ORDER BY tt.txn_type_id`,
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.get("/decision-trees/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(
      `SELECT tf.id,
              tt.txn_type_id AS tree_id,
              1 AS version,
              tf.steps AS content,
              'approved' AS status,
              'system' AS created_by,
              NOW() AS created_at,
              NULL AS approved_by,
              NULL AS approved_at
       FROM transaction_flows tf
       JOIN transaction_types tt ON tt.id = tf.txn_type_id
       WHERE tf.id = $1`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "Decision tree not found" });
    res.json(rows[0]);
  } catch (err) {
    fail(res, err);
  }
});

router.post("/decision-trees", async (req, res) => {
  try {
    const { treeId, content } = req.body;
    if (!treeId || !content) {
      return res.status(400).json({ error: "treeId and content required" });
    }

    // Validate JSON structure
    const tree = typeof content === "string" ? JSON.parse(content) : content;
    if (!tree.txnTypeId || !Array.isArray(tree.baseItems) || !Array.isArray(tree.branches)) {
      return res.status(400).json({
        error: "Invalid tree structure. Required: txnTypeId, baseItems (array), branches (array)",
      });
    }

    // Resolve txn_type_id FK from the slug
    const ttRes = await pool.query(
      `SELECT id FROM transaction_types WHERE txn_type_id = $1 LIMIT 1`,
      [treeId],
    );
    if (!ttRes.rows.length) {
      return res
        .status(400)
        .json({ error: `No transaction type found for '${treeId}'. Create it first.` });
    }
    const txnTypeDbId = ttRes.rows[0].id;

    // Upsert into transaction_flows
    const { rows } = await pool.query(
      `INSERT INTO transaction_flows (txn_type_id, steps)
       VALUES ($1, $2)
       ON CONFLICT (txn_type_id) DO UPDATE SET steps = EXCLUDED.steps
       RETURNING id`,
      [txnTypeDbId, JSON.stringify(tree)],
    );

    const userEmail = req.user?.email ?? req.user?.sub ?? "unknown";
    await logAuditEvent(req, {
      action: "create",
      entityType: "decision_tree",
      entityId: rows[0].id,
      details: { treeId, upsertedBy: userEmail },
    });

    res.json({ ok: true, id: rows[0].id, version: 1 });
  } catch (err) {
    fail(res, err);
  }
});

// Approve is a no-op now — transaction_flows rows are always live.
router.post("/decision-trees/:id/approve", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(`SELECT tf.id FROM transaction_flows tf WHERE tf.id = $1`, [
      id,
    ]);
    if (!rows.length) return res.status(404).json({ error: "Decision tree not found" });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

router.delete("/decision-trees/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    const { rows } = await pool.query(
      `SELECT tf.id, tt.txn_type_id AS tree_id
       FROM transaction_flows tf
       JOIN transaction_types tt ON tt.id = tf.txn_type_id
       WHERE tf.id = $1`,
      [id],
    );
    if (!rows.length) return res.status(404).json({ error: "Decision tree not found" });

    await pool.query(`DELETE FROM transaction_flows WHERE id = $1`, [id]);
    await logAuditEvent(req, {
      action: "delete",
      entityType: "decision_tree",
      entityId: id,
      before: rows[0],
    });
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

// ─── Clerk Schedules (lunch shift assignment) ────────────────────────────────

router.get("/clerk-schedules", async (req, res) => {
  try {
    const { officeId, startDate, endDate } = req.query;
    if (!officeId || !startDate || !endDate) {
      return res.status(400).json({ error: "officeId, startDate, and endDate required" });
    }
    const { rows } = await pool.query(
      `SELECT cs.id, cs.clerk_id, cs.office_id, cs.schedule_date::text, cs.lunch_shift_id
       FROM clerk_schedules cs
       WHERE cs.office_id = $1 AND cs.schedule_date BETWEEN $2 AND $3
       ORDER BY cs.schedule_date, cs.clerk_id`,
      [officeId, startDate, endDate],
    );
    res.json(rows);
  } catch (err) {
    fail(res, err);
  }
});

router.put("/clerk-schedules", async (req, res) => {
  try {
    const { assignments } = req.body as { assignments: LunchTemplateAssignment[] };
    if (
      !Array.isArray(assignments) ||
      assignments.some(
        (assignment) =>
          !Number.isInteger(assignment.clerkId) ||
          !Number.isInteger(assignment.officeId) ||
          !/^\d{4}-\d{2}-\d{2}$/.test(assignment.scheduleDate) ||
          (assignment.lunchShiftId !== null && !Number.isInteger(assignment.lunchShiftId)),
      )
    ) {
      return res.status(400).json({ error: "valid lunch-template assignments required" });
    }
    await withTransaction((client) => propagateLunchTemplate(client, assignments));
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
