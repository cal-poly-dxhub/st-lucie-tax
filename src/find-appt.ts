// Scheduling Engine — find one appointment (application-layer search).
//
// Generates candidate (office, date, time) cells in preference order and
// asks the database whether each one has capacity, stopping at the first
// hit. The DB query (db/find-appt-cell.sql) checks one cell at a time.
//
// In the happy path (low utilization, user gets their preferred office /
// day / time-of-day), this calls the DB 1–3 times and stops. In the worst
// case (saturated office, unsatisfiable preferences) it walks the full
// candidate space — same cost as the heatmap query — and returns null.
//
// The returned slot is a candidate, not a reservation. The caller (the
// book_appointment PL/pgSQL function in db/schema.sql) takes a FOR UPDATE
// lock on clerk_schedules, rechecks capacity for that one cell, and
// inserts. Race losses surface as a recheck failure, not as oversells.

import type { Pool, PoolClient } from "pg";

export interface FindApptInput {
  countyId: string;
  targetSkills: number[];
  asap: boolean;
  preferredOffice: number | null; // office_id, or null = any
  preferredDow: number | null; // 0=Sun..6=Sat, or null = any
  preferredTime: "morning" | "afternoon" | null;
  startDate: Date; // production: new Date()
  days: number; // search-window length
  blockMin: number; // grid resolution, e.g. 15
  nowTs: Date; // production: new Date()
}

export interface FindApptResult {
  officeId: number;
  slotDate: string; // 'YYYY-MM-DD'
  slotTime: string; // 'HH:MM:SS'
  available: number;
}

/**
 * Search the candidate space in preference order, stop at the first cell
 * with capacity. Returns null if nothing in the window matches.
 */
export async function findAppointment(
  db: Pool | PoolClient,
  input: FindApptInput,
): Promise<FindApptResult | null> {
  const { countyId, targetSkills } = input;

  // One up-front query: which offices in this county offer ALL requested
  // skills, and what's the total appointment duration? Both are static for
  // the search.
  const meta = await loadSearchMeta(db, countyId, targetSkills);
  if (meta === null) return null; // no office offers the full skill set
  const { offices, totalDurationMin } = meta;

  // Generate (office, date, blockTime) candidates in preference order, then
  // check each against the DB until one passes.
  for (const cell of candidateCells(input, offices)) {
    const hit = await checkCell(db, {
      countyId,
      targetSkills,
      officeId: cell.officeId,
      slotDate: cell.slotDate,
      slotTime: cell.slotTime,
      totalDurationMin,
      blockMin: input.blockMin,
      nowTs: input.nowTs,
    });
    if (hit !== null) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate generation
// ---------------------------------------------------------------------------

interface Candidate {
  officeId: number;
  slotDate: string; // 'YYYY-MM-DD'
  slotTime: string; // 'HH:MM:SS'
}

/**
 * Yield candidates in the preference order from
 * docs/scheduling-design-writeup.md:
 *   asap     → strict (date, time) ascending across all offices
 *   else     → preferred_office first, then preferred_dow, then
 *              preferred_time, then earliest
 *
 * Implementation: we materialize the full candidate list and sort by a
 * composite key matching the writeup's priority. Materializing is fine —
 * 180 days × 3 offices × ~36 blocks ≈ 19K candidates, each ~50 bytes. The
 * point of doing this in the app instead of in SQL is that the DB-side
 * capacity check runs lazily, one cell at a time.
 */
function* candidateCells(
  input: FindApptInput,
  offices: OfficeMeta[],
): Generator<Candidate> {
  const { startDate, days, blockMin, asap } = input;
  const cells: Array<Candidate & { rank: number[] }> = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const date = addDays(startDate, dayOffset);
    const dow = date.getDay();
    const dateStr = isoDate(date);

    for (const office of offices) {
      const hours = office.hoursByDow.get(dow);
      if (!hours) continue; // office closed that day-of-week

      const minutesOpen =
        toMinutes(hours.closeTime) - toMinutes(hours.openTime);
      // Generate block start times from open to close-blockMin.
      for (let m = 0; m + blockMin <= minutesOpen; m += blockMin) {
        const blockMinutes = toMinutes(hours.openTime) + m;
        const slotTime = fromMinutes(blockMinutes);

        const rank = computeRank(input, {
          officeId: office.id,
          dateStr,
          dow,
          slotTime,
        });
        cells.push({ officeId: office.id, slotDate: dateStr, slotTime, rank });
      }
    }
  }

  // Lexicographic sort on the rank tuple: lower is better.
  cells.sort((a, b) => compareRank(a.rank, b.rank));
  for (const c of cells) yield c;
}

/**
 * Compose a sortable tuple matching the writeup's preference priority.
 * Lower components win.
 */
function computeRank(
  input: FindApptInput,
  cell: { officeId: number; dateStr: string; dow: number; slotTime: string },
): number[] {
  const { asap, preferredOffice, preferredDow, preferredTime } = input;

  // ASAP: pure (date, time) ascending. All other preferences ignored.
  if (asap) {
    return [
      0, // dummy office-pref slot
      0, // dummy dow-pref slot
      0, // dummy time-pref slot
      dateToOrdinal(cell.dateStr),
      timeToMinutes(cell.slotTime),
      cell.officeId,
    ];
  }

  // Office preference: matching office sorts before non-matching.
  const officeRank =
    preferredOffice === null || cell.officeId === preferredOffice ? 0 : 1;

  // Day-of-week preference: matching DOW sorts before non-matching.
  const dowRank =
    preferredDow === null || cell.dow === preferredDow ? 0 : 1;

  // Time-of-day preference: morning < 12:00, afternoon ≥ 12:00.
  const isMorning = timeToMinutes(cell.slotTime) < 12 * 60;
  const timeRank =
    preferredTime === null
      ? 0
      : preferredTime === "morning" && isMorning
        ? 0
        : preferredTime === "afternoon" && !isMorning
          ? 0
          : 1;

  return [
    officeRank,
    dowRank,
    timeRank,
    dateToOrdinal(cell.dateStr),
    timeToMinutes(cell.slotTime),
    cell.officeId,
  ];
}

function compareRank(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

// ---------------------------------------------------------------------------
// DB queries
// ---------------------------------------------------------------------------

interface OfficeMeta {
  id: number;
  runRatePct: number;
  hoursByDow: Map<number, { openTime: string; closeTime: string }>;
}

interface SearchMeta {
  offices: OfficeMeta[];
  totalDurationMin: number;
}

/**
 * Up-front query: total appointment duration + which offices offer all the
 * requested skills + each office's open hours. Static for the search.
 */
async function loadSearchMeta(
  db: Pool | PoolClient,
  countyId: string,
  targetSkills: number[],
): Promise<SearchMeta | null> {
  // Total duration. If any requested skill is missing or inactive, return
  // null — we can't size the appointment.
  const durRes = await db.query<{ total_duration_min: number; n: number }>(
    `
    SELECT
      COALESCE(SUM(g.avg_duration_min), 0)::int AS total_duration_min,
      COUNT(*)::int AS n
    FROM transaction_types g
    WHERE g.county_id  = $1
      AND g.office_id IS NULL
      AND g.id        = ANY($2::int[])
      AND g.status    = 'active'
    `,
    [countyId, targetSkills],
  );
  if (durRes.rows[0].n !== targetSkills.length) return null;
  const totalDurationMin = durRes.rows[0].total_duration_min;

  // Offices that offer ALL requested skills.
  const officesRes = await db.query<{
    id: number;
    run_rate_pct: number;
  }>(
    `
    SELECT o.id, o.run_rate_pct
    FROM offices o
    WHERE o.county_id = $1
      AND (
        SELECT COUNT(*) FROM effective_transaction_types ett
        WHERE ett.county_id = o.county_id
          AND ett.office_id = o.id
          AND ett.global_id = ANY($2::int[])
          AND ett.status    = 'active'
      ) = $3
    ORDER BY o.id
    `,
    [countyId, targetSkills, targetSkills.length],
  );
  if (officesRes.rows.length === 0) return null;

  const officeIds = officesRes.rows.map((r) => r.id);
  // One query for all hours across all qualifying offices.
  const hoursRes = await db.query<{
    office_id: number;
    day_of_week: number;
    open_time: string;
    close_time: string;
  }>(
    `
    SELECT office_id, day_of_week, open_time::text, close_time::text
    FROM office_hours
    WHERE county_id = $1 AND office_id = ANY($2::int[])
    `,
    [countyId, officeIds],
  );

  const offices: OfficeMeta[] = officesRes.rows.map((r) => ({
    id: r.id,
    runRatePct: r.run_rate_pct,
    hoursByDow: new Map(),
  }));
  const officesById = new Map(offices.map((o) => [o.id, o]));
  for (const h of hoursRes.rows) {
    officesById.get(h.office_id)?.hoursByDow.set(h.day_of_week, {
      openTime: h.open_time,
      closeTime: h.close_time,
    });
  }
  return { offices, totalDurationMin };
}

interface CellInput {
  countyId: string;
  targetSkills: number[];
  officeId: number;
  slotDate: string;
  slotTime: string;
  totalDurationMin: number;
  blockMin: number;
  nowTs: Date;
}

/**
 * Per-cell capacity check. Mirrors db/find-appt-cell.sql but in
 * parameterized form for pg's $1/$2/... binding.
 */
async function checkCell(
  db: Pool | PoolClient,
  c: CellInput,
): Promise<FindApptResult | null> {
  const res = await db.query<{
    office_id: number;
    slot_date: string;
    slot_time: string;
    available: number;
  }>(CELL_QUERY, [
    c.countyId,
    c.targetSkills,
    c.officeId,
    c.slotDate,
    c.slotTime,
    c.totalDurationMin,
    c.blockMin,
    c.nowTs,
  ]);

  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  return {
    officeId: r.office_id,
    slotDate: r.slot_date,
    slotTime: r.slot_time,
    available: r.available,
  };
}

// Inlined to keep deployment a single file. Mirrors db/find-appt-cell.sql.
const CELL_QUERY = `
WITH params AS (
  SELECT $1::text  AS county_id,
         $2::int[] AS target_skills,
         $3::int   AS office_id,
         $4::date  AS slot_date,
         $5::time  AS slot_time,
         $6::int   AS total_duration_min,
         $7::int   AS block_min,
         $8::timestamp AS now_ts
),
office_window AS (
  SELECT oh.open_time, oh.close_time, o.run_rate_pct
  FROM offices o
  JOIN office_hours oh
    ON oh.office_id   = o.id
   AND oh.county_id   = o.county_id
   AND oh.day_of_week = EXTRACT(DOW FROM (SELECT slot_date FROM params))::int
  CROSS JOIN params
  WHERE o.id        = params.office_id
    AND o.county_id = params.county_id
),
office_txn_window AS (
  SELECT MAX(ett.available_from)  AS earliest_start,
         MIN(ett.available_until) AS latest_end
  FROM effective_transaction_types ett
  CROSS JOIN params
  WHERE ett.county_id = params.county_id
    AND ett.office_id = params.office_id
    AND ett.global_id = ANY(params.target_skills)
    AND ett.status    = 'active'
  HAVING COUNT(*) = (SELECT cardinality(target_skills) FROM params)
),
appt_blocks AS (
  SELECT (params.slot_time + (n || ' minutes')::interval)::time AS block_time
  FROM params
  CROSS JOIN generate_series(
    0,
    (CEIL(params.total_duration_min::numeric / params.block_min)::int - 1)
      * params.block_min,
    params.block_min
  ) AS n
),
qualified_per_block AS (
  SELECT ab.block_time,
         FLOOR(
           (SELECT count(*)
            FROM clerk_schedules cs
            JOIN clerks c
              ON c.id        = cs.clerk_id
             AND c.county_id = cs.county_id
            LEFT JOIN office_lunch_shifts ols
                   ON ols.id        = cs.lunch_shift_id
                  AND ols.county_id = cs.county_id
                  AND ols.office_id = cs.office_id
            CROSS JOIN params
            WHERE cs.county_id     = params.county_id
              AND cs.office_id     = params.office_id
              AND cs.schedule_date = params.slot_date
              AND c.status         = 'active'
              AND c.skill_ids @> params.target_skills
              AND (ols.id IS NULL
                OR NOT (ols.start_time <= ab.block_time
                    AND ols.end_time   >  ab.block_time)))
           * (SELECT run_rate_pct FROM office_window) / 100.0
         )::int AS qualified
  FROM appt_blocks ab
),
consumed_per_block AS (
  SELECT ab.block_time,
         (SELECT count(*)
          FROM appointment_durations ad
          CROSS JOIN params
          WHERE ad.county_id        = params.county_id
            AND ad.office_id        = params.office_id
            AND ad.appointment_date = params.slot_date
            AND ad.status NOT IN ('cancelled', 'no_show')
            AND ad.start_at <= (params.slot_date + ab.block_time)::timestamp
            AND ad.end_at   >  (params.slot_date + ab.block_time)::timestamp) AS consumed
  FROM appt_blocks ab
)
SELECT
  params.office_id::int  AS office_id,
  params.slot_date::text AS slot_date,
  params.slot_time::text AS slot_time,
  MIN(GREATEST(qpb.qualified - cpb.consumed, 0))::int AS available
FROM qualified_per_block qpb
JOIN consumed_per_block cpb ON cpb.block_time = qpb.block_time
CROSS JOIN params
CROSS JOIN office_window ow
CROSS JOIN office_txn_window otw
WHERE (params.slot_date + params.slot_time)::timestamp > params.now_ts
  AND (otw.earliest_start IS NULL OR params.slot_time >= otw.earliest_start)
  AND (otw.latest_end IS NULL
       OR (params.slot_date + params.slot_time
           + (params.total_duration_min * interval '1 minute'))::timestamp
          <= (params.slot_date + otw.latest_end)::timestamp)
  AND (params.slot_date + params.slot_time
       + (params.total_duration_min * interval '1 minute'))::timestamp
      <= (params.slot_date + ow.close_time)::timestamp
GROUP BY params.office_id, params.slot_date, params.slot_time
HAVING MIN(GREATEST(qpb.qualified - cpb.consumed, 0)) > 0;
`;

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateToOrdinal(iso: string): number {
  // Days since 1970-01-01. Used purely for sort ordering, not arithmetic.
  return Math.floor(new Date(iso + "T00:00:00Z").getTime() / 86400000);
}

function toMinutes(t: string): number {
  // 'HH:MM' or 'HH:MM:SS'
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function timeToMinutes(t: string): number {
  return toMinutes(t);
}

function fromMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`;
}
