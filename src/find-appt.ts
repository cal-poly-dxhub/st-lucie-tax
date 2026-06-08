// Scheduling Engine — find one appointment (application-layer search).
//
// Generates candidate (office, date, time) cells in preference order using
// a packing model: candidate start times are (1) office open, (2) end of
// each lunch shift, (3) end of each existing skill-overlapping appointment.
// Each candidate is validated against the DB using the same change-point
// capacity sweep as validate_slot (db/schema.sql), stopping at the first
// hit.
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
  nowTs: string; // 'YYYY-MM-DD HH:MM' — local time, no TZ conversion
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

  const meta = await loadSearchMeta(db, countyId, targetSkills);
  if (meta === null) return null;
  const { offices, totalDurationMin } = meta;

  const candidates = await buildCandidates(
    db,
    input,
    offices,
    totalDurationMin,
  );

  for (const cell of candidates) {
    const hit = await checkCell(db, {
      countyId,
      targetSkills,
      officeId: cell.officeId,
      slotDate: cell.slotDate,
      slotTime: cell.slotTime,
      totalDurationMin,
      nowTs: input.nowTs,
    });
    if (hit !== null) return hit;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Candidate generation — packing model
// ---------------------------------------------------------------------------

interface Candidate {
  officeId: number;
  slotDate: string; // 'YYYY-MM-DD'
  slotTime: string; // 'HH:MM:SS'
}

/**
 * Build candidate start times using the packing model:
 *   1. Office open time (first-of-day)
 *   2. Transaction available_from time (earliest the skill set allows)
 *   3. End of each lunch shift (capacity returns post-lunch)
 *   4. End time of every existing skill-overlapping appointment (pack tightly)
 *
 * Candidates are then sorted by the preference ranking and returned.
 */
async function buildCandidates(
  db: Pool | PoolClient,
  input: FindApptInput,
  offices: OfficeMeta[],
  totalDurationMin: number,
): Promise<Candidate[]> {
  const { countyId, targetSkills, startDate, days } = input;
  const officeIds = offices.map((o) => o.id);

  // Fetch the intersected txn availability window per office (earliest_start
  // = MAX(available_from) across skills). This is the earliest valid start.
  const txnWindowRes = await db.query<{
    office_id: number;
    earliest_start: string | null;
  }>(
    `SELECT ett.office_id,
            MAX(ett.available_from)::text AS earliest_start
     FROM effective_transaction_types ett
     WHERE ett.county_id = $1
       AND ett.office_id = ANY($2::int[])
       AND ett.global_id = ANY($3::int[])
       AND ett.status    = 'active'
     GROUP BY ett.office_id
     HAVING COUNT(*) = $4`,
    [countyId, officeIds, targetSkills, targetSkills.length],
  );
  const earliestStartByOffice = new Map<number, string>();
  for (const r of txnWindowRes.rows) {
    if (r.earliest_start)
      earliestStartByOffice.set(r.office_id, r.earliest_start);
  }

  // Fetch lunch shift end times for all qualifying offices.
  const lunchRes = await db.query<{
    office_id: number;
    end_time: string;
  }>(
    `SELECT office_id, end_time::text
     FROM office_lunch_shifts
     WHERE county_id = $1 AND office_id = ANY($2::int[])`,
    [countyId, officeIds],
  );

  // Fetch ALL appointment intervals in the window (for desk-occupancy filter).
  const endDate = addDays(startDate, days - 1);
  const allApptsRes = await db.query<{
    office_id: number;
    appointment_date: string;
    start_time: string;
    end_time: string;
    skill_overlap: boolean;
  }>(
    `SELECT ad.office_id,
            ad.appointment_date::text,
            ad.appointment_time::text AS start_time,
            (ad.appointment_time + (ad.total_duration_min * interval '1 minute'))::time::text AS end_time,
            (ad.txn_type_ids && $5::int[]) AS skill_overlap
     FROM appointment_durations ad
     WHERE ad.county_id = $1
       AND ad.office_id = ANY($2::int[])
       AND ad.appointment_date BETWEEN $3 AND $4
       AND ad.status NOT IN ('cancelled', 'no_show')`,
    [countyId, officeIds, isoDate(startDate), isoDate(endDate), targetSkills],
  );

  // Index lunch ends by office.
  const lunchEndsByOffice = new Map<number, Set<string>>();
  for (const r of lunchRes.rows) {
    if (!lunchEndsByOffice.has(r.office_id)) {
      lunchEndsByOffice.set(r.office_id, new Set());
    }
    lunchEndsByOffice.get(r.office_id)!.add(r.end_time);
  }

  // Index ALL appointment ends by (office, date) — not just skill-overlapping.
  // A desk frees up when ANY appointment ends, regardless of skill.
  const apptEndsByKey = new Map<string, Set<string>>();
  for (const r of allApptsRes.rows) {
    const key = `${r.office_id}:${r.appointment_date}`;
    if (!apptEndsByKey.has(key)) {
      apptEndsByKey.set(key, new Set());
    }
    apptEndsByKey.get(key)!.add(r.end_time);
  }

  // Index ALL appointment intervals by (office, date) for desk-occupancy check.
  const intervalsByKey = new Map<
    string,
    Array<{ startMin: number; endMin: number }>
  >();
  for (const r of allApptsRes.rows) {
    const key = `${r.office_id}:${r.appointment_date}`;
    if (!intervalsByKey.has(key)) {
      intervalsByKey.set(key, []);
    }
    intervalsByKey.get(key)!.push({
      startMin: toMinutes(r.start_time),
      endMin: toMinutes(r.end_time),
    });
  }

  // Effective scheduled-appointment cap per office: total_desks * run_rate_pct / 100.
  // This reserves remaining desks for walk-ins.
  const effectiveDesksByOffice = new Map<number, number>();
  for (const o of offices) {
    effectiveDesksByOffice.set(
      o.id,
      Math.floor((o.totalDesks * o.runRatePct) / 100),
    );
  }

  const cells: Array<Candidate & { rank: number[] }> = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const date = addDays(startDate, dayOffset);
    const dayOfWeek = dow(date);
    const dateStr = isoDate(date);

    if (input.preferredDow !== null && dayOfWeek !== input.preferredDow)
      continue;

    for (const office of offices) {
      if (input.preferredOffice !== null && office.id !== input.preferredOffice)
        continue;
      const hours = office.hoursByDow.get(dayOfWeek);
      if (!hours) continue;

      const openMin = toMinutes(hours.openTime);
      const closeMin = toMinutes(hours.closeTime);

      // Collect unique candidate start times for this (office, date).
      const startTimes = new Set<string>();

      // 1. Office open time.
      startTimes.add(hours.openTime);

      // 2. Transaction available_from (intersected across skills).
      const earliestStart = earliestStartByOffice.get(office.id);
      if (earliestStart) startTimes.add(earliestStart);

      // 3. End of each lunch shift at this office.
      const lunchEnds = lunchEndsByOffice.get(office.id);
      if (lunchEnds) {
        for (const t of lunchEnds) startTimes.add(t);
      }

      // 4. End of each existing skill-overlapping appointment on this day.
      const apptEnds = apptEndsByKey.get(`${office.id}:${dateStr}`);
      if (apptEnds) {
        for (const t of apptEnds) startTimes.add(t);
      }

      // Filter candidates: must fit within office hours AND have a free desk.
      const intervals = intervalsByKey.get(`${office.id}:${dateStr}`) || [];
      const desks = effectiveDesksByOffice.get(office.id) || 1;

      for (const slotTime of startTimes) {
        const startMin = toMinutes(slotTime);
        if (startMin < openMin) continue;
        if (startMin + totalDurationMin > closeMin) continue;

        if (input.preferredTime === "morning" && startMin >= 12 * 60) continue;
        if (input.preferredTime === "afternoon" && startMin < 12 * 60) continue;

        // Pre-filter A: skip if all desks are occupied at this start time.
        // Count appointments overlapping [startMin, startMin+1).
        let concurrent = 0;
        for (const iv of intervals) {
          if (startMin >= iv.startMin && startMin < iv.endMin) concurrent++;
        }
        if (concurrent >= desks) continue;

        const rank = computeRank(input, {
          officeId: office.id,
          dateStr,
          dow: dayOfWeek,
          slotTime,
        });
        cells.push({ officeId: office.id, slotDate: dateStr, slotTime, rank });
      }
    }
  }

  cells.sort((a, b) => compareRank(a.rank, b.rank));
  return cells;
}

/**
 * Compose a sortable tuple matching the preference priority.
 * Lower components win.
 */
function computeRank(
  input: FindApptInput,
  cell: { officeId: number; dateStr: string; dow: number; slotTime: string },
): number[] {
  const { asap, preferredOffice, preferredDow, preferredTime } = input;

  if (asap) {
    return [
      0,
      0,
      0,
      dateToOrdinal(cell.dateStr),
      toMinutes(cell.slotTime),
      cell.officeId,
    ];
  }

  const officeRank =
    preferredOffice === null || cell.officeId === preferredOffice ? 0 : 1;

  const dowRank = preferredDow === null || cell.dow === preferredDow ? 0 : 1;

  const isMorning = toMinutes(cell.slotTime) < 12 * 60;
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
    toMinutes(cell.slotTime),
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
  totalDesks: number;
  hoursByDow: Map<number, { openTime: string; closeTime: string }>;
}

interface SearchMeta {
  offices: OfficeMeta[];
  totalDurationMin: number;
}

async function loadSearchMeta(
  db: Pool | PoolClient,
  countyId: string,
  targetSkills: number[],
): Promise<SearchMeta | null> {
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

  const officesRes = await db.query<{
    id: number;
    run_rate_pct: number;
    total_desks: number;
  }>(
    `
    SELECT o.id, o.run_rate_pct, o.total_desks
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
    totalDesks: r.total_desks,
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
  nowTs: string;
}

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
    c.nowTs,
  ]);

  if (res.rows.length === 0) return null;
  const r = res.rows[0];
  if (r.available <= 0) return null;
  return {
    officeId: r.office_id,
    slotDate: r.slot_date,
    slotTime: r.slot_time,
    available: r.available,
  };
}

const CELL_QUERY = `
WITH txn_window AS (
  SELECT MAX(ett.available_from)  AS earliest_start,
         MIN(ett.available_until) AS latest_end
  FROM effective_transaction_types ett
  WHERE ett.county_id = $1
    AND ett.office_id = $3
    AND ett.global_id = ANY($2::int[])
    AND ett.status    = 'active'
  HAVING COUNT(*) = cardinality($2::int[])
)
SELECT $3::int  AS office_id,
       $4::text AS slot_date,
       $5::text AS slot_time,
       validate_slot($1, $3, $4::date, $5::time, $2, $6) AS available
FROM txn_window tw
CROSS JOIN office_hours oh
WHERE oh.county_id   = $1
  AND oh.office_id   = $3
  AND oh.day_of_week = EXTRACT(DOW FROM $4::date)::int
  AND ($4::date + $5::time)::timestamp > $7::timestamp
  AND ($5::time >= tw.earliest_start OR tw.earliest_start IS NULL)
  AND (($4::date + $5::time)::timestamp + ($6 * interval '1 minute')
       <= ($4::date + tw.latest_end)::timestamp OR tw.latest_end IS NULL)
  AND ($4::date + $5::time)::timestamp + ($6 * interval '1 minute')
       <= ($4::date + oh.close_time)::timestamp
`;

// ---------------------------------------------------------------------------
// Date / time helpers
// ---------------------------------------------------------------------------

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function isoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dow(d: Date): number {
  return d.getUTCDay();
}

function dateToOrdinal(iso: string): number {
  return Math.floor(new Date(iso + "T00:00:00Z").getTime() / 86400000);
}

function toMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
