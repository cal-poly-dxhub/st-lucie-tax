import { tenantQuery } from "./db.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TimeSlot {
  office_id: number;
  office_name: string;
  date: string;
  time: string;
}

export interface SlotSearchResult {
  slots: TimeSlot[];
  alternatives: TimeSlot[];
}

export interface BookingPreferences {
  txnTypeIds: number[];
  officeId?: number;
  preferredDay?: number; // 0-6 (day of week)
  timeWindow?: "morning" | "afternoon";
  asap?: boolean;
  startDate?: string;
  maxDays?: number;
  maxSlots?: number;
}

interface OfficeHours {
  day_of_week: number;
  open_time: string;
  close_time: string;
}

interface LunchShift {
  id: number;
  shift_num: number;
  start_time: string;
  end_time: string;
  clerk_count: number;
}

interface OfficeConfig {
  id: number;
  office_id: string;
  name: string;
  total_desks: number;
  run_rate_pct: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export function minToTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

// ─── Core Engine ─────────────────────────────────────────────────────────────

/**
 * Get clerks with a given skill scheduled at an office on a date.
 */
async function scheduledClerksWithSkill(
  countyId: string,
  officeId: number,
  date: string,
  skillId: number,
): Promise<{ id: number; lunch_shift_id: number | null }[]> {
  return tenantQuery<{ id: number; lunch_shift_id: number | null }>(
    countyId,
    `SELECT c.id, cs.lunch_shift_id
     FROM clerk_schedules cs
     JOIN clerks c ON c.id = cs.clerk_id
     WHERE cs.office_id = $1
       AND cs.schedule_date = $2
       AND $3 = ANY(c.skill_ids)
       AND c.status = 'active'`,
    [officeId, date, skillId],
  );
}

/**
 * Get clerks who can handle ALL given skills, scheduled at an office on a date.
 */
async function scheduledClerksWithAllSkills(
  countyId: string,
  officeId: number,
  date: string,
  skillIds: number[],
): Promise<{ id: number; lunch_shift_id: number | null }[]> {
  return tenantQuery<{ id: number; lunch_shift_id: number | null }>(
    countyId,
    `SELECT c.id, cs.lunch_shift_id
     FROM clerk_schedules cs
     JOIN clerks c ON c.id = cs.clerk_id
     WHERE cs.office_id = $1
       AND cs.schedule_date = $2
       AND c.skill_ids @> $3::int[]
       AND c.status = 'active'`,
    [officeId, date, skillIds],
  );
}

/**
 * Get all appointments at an office/date with their computed end times.
 * Returns pre-fetched data for efficient slot scanning.
 */
async function getAppointmentsForDay(
  countyId: string,
  officeId: number,
  date: string,
): Promise<{ id: number; start_min: number; end_min: number; txn_type_ids: number[] }[]> {
  const rows = await tenantQuery<{
    id: number;
    appointment_time: string;
    total_duration: string;
    txn_type_ids: number[];
  }>(
    countyId,
    `SELECT a.id, a.appointment_time::text,
            COALESCE((SELECT SUM(tt.avg_duration_min)
                      FROM unnest(a.txn_type_ids) AS tid
                      JOIN transaction_types tt ON tt.id = tid), 0) AS total_duration,
            a.txn_type_ids
     FROM appointments a
     WHERE a.office_id = $1
       AND a.appointment_date = $2
       AND a.status NOT IN ('cancelled', 'no_show')`,
    [officeId, date],
  );
  return rows.map((r) => ({
    id: r.id,
    start_min: timeToMin(r.appointment_time),
    end_min: timeToMin(r.appointment_time) + Number(r.total_duration),
    txn_type_ids: r.txn_type_ids,
  }));
}

/**
 * Count how many appointments needing skillId are in-progress at timeMin.
 * Uses pre-fetched appointment data.
 */
function countConcurrentFromCache(
  appointments: { id: number; start_min: number; end_min: number; txn_type_ids: number[] }[],
  skillId: number,
  timeMin: number,
): number {
  let count = 0;
  for (const a of appointments) {
    if (a.txn_type_ids.includes(skillId) && a.start_min <= timeMin && a.end_min > timeMin) {
      count++;
    }
  }
  return count;
}

/**
 * Count how many clerks with a skill are on lunch at a given time.
 */
function clerksOnLunchWithSkill(
  clerks: { id: number; lunch_shift_id: number | null }[],
  lunches: LunchShift[],
  timeMin: number,
): number {
  let count = 0;
  for (const clerk of clerks) {
    if (clerk.lunch_shift_id == null) continue;
    const shift = lunches.find((l) => l.id === clerk.lunch_shift_id);
    if (!shift) continue;
    const lStart = timeToMin(shift.start_time);
    const lEnd = timeToMin(shift.end_time);
    if (timeMin >= lStart && timeMin < lEnd) {
      count++;
    }
  }
  return count;
}

/**
 * Check if a slot is available using the per-skill concurrency model.
 *
 * For a candidate time T and transaction(s) requiring skills:
 *   For EACH skill needed:
 *     concurrent_appointments_needing_skill_at_T < clerks_with_skill_on_shift - clerks_on_lunch
 *
 * For multi-transaction: require a single clerk who can handle ALL skills.
 *   concurrent_appointments_needing_ALL_skills_at_T < clerks_with_ALL_skills - on_lunch
 */
export function isSlotAvailable(
  appointments: { id: number; start_min: number; end_min: number; txn_type_ids: number[] }[],
  clerksForSkills: { id: number; lunch_shift_id: number | null }[],
  lunches: LunchShift[],
  txnTypeIds: number[],
  candidateTimeMin: number,
  durationMin: number,
  runRatePct: number,
): boolean {
  // Check availability at every point where supply or demand could change
  // within the candidate appointment window [candidateTimeMin, candidateTimeMin + durationMin)
  const checkPoints = new Set<number>([candidateTimeMin]);

  // Lunch boundaries: supply changes when clerks go to/return from lunch
  for (const lunch of lunches) {
    const lStart = timeToMin(lunch.start_time);
    const lEnd = timeToMin(lunch.end_time);
    if (lStart > candidateTimeMin && lStart < candidateTimeMin + durationMin) {
      checkPoints.add(lStart);
    }
    if (lEnd > candidateTimeMin && lEnd < candidateTimeMin + durationMin) {
      checkPoints.add(lEnd);
    }
  }

  // Appointment start times: demand increases when other appointments begin
  for (const a of appointments) {
    if (a.start_min > candidateTimeMin && a.start_min < candidateTimeMin + durationMin) {
      checkPoints.add(a.start_min);
    }
  }

  for (const checkTime of Array.from(checkPoints).sort((a, b) => a - b)) {
    // Supply: clerks with all required skills, minus those on lunch
    const onLunch = clerksOnLunchWithSkill(clerksForSkills, lunches, checkTime);
    const availableClerks = clerksForSkills.length - onLunch;

    // Apply run_rate_pct to reduce bookable capacity (leaves headroom for walk-ins)
    const bookableSlots = Math.floor((availableClerks * runRatePct) / 100);

    // Demand: count appointments that overlap this time AND need ANY skill from our set
    // (they consume a clerk who could serve us)
    let concurrentAny = 0;
    for (const a of appointments) {
      if (a.start_min <= checkTime && a.end_min > checkTime) {
        const sharesAnySkill = txnTypeIds.some((id) => a.txn_type_ids.includes(id));
        if (sharesAnySkill) {
          concurrentAny++;
        }
      }
    }

    // Adjust for lunch overlap: appointments that started before lunch and are still
    // running are being served by clerks now on lunch. Those clerks are already excluded
    // from supply, so their appointments shouldn't count as demand against remaining clerks.
    const effectiveDemand = Math.max(0, concurrentAny - onLunch);

    if (effectiveDemand >= bookableSlots) {
      return false;
    }
  }

  return true;
}

/** Get office config (hours, lunches). */
export async function getOfficeConfig(countyId: string, officeId: number) {
  const [office] = await tenantQuery<OfficeConfig>(
    countyId,
    "SELECT id, office_id, name, total_desks, run_rate_pct FROM offices WHERE id = $1",
    [officeId],
  );
  const hours = await tenantQuery<OfficeHours>(
    countyId,
    "SELECT day_of_week, open_time::text, close_time::text FROM office_hours WHERE office_id = $1 ORDER BY day_of_week",
    [officeId],
  );
  const lunches = await tenantQuery<LunchShift>(
    countyId,
    "SELECT id, shift_num, start_time::text, end_time::text, clerk_count FROM office_lunch_shifts WHERE office_id = $1 ORDER BY start_time",
    [officeId],
  );
  return { office, hours, lunches };
}

/** Get total duration for a set of transaction types. */
async function getTotalDuration(countyId: string, txnTypeIds: number[]): Promise<number> {
  const rows = await tenantQuery<{ total: string }>(
    countyId,
    "SELECT COALESCE(SUM(avg_duration_min), 0) AS total FROM transaction_types WHERE id = ANY($1)",
    [txnTypeIds],
  );
  return Number(rows[0]?.total ?? 0);
}

/** Get time restrictions for transaction types at an office. */
async function getTimeRestrictions(
  countyId: string,
  txnTypeIds: number[],
  officeId: number,
): Promise<{ available_from: string | null; available_until: string | null }[]> {
  const results: { available_from: string | null; available_until: string | null }[] = [];
  for (const tid of txnTypeIds) {
    const rows = await tenantQuery<{ available_from: string | null; available_until: string | null }>(
      countyId,
      `SELECT available_from::text, available_until::text
       FROM transaction_types
       WHERE id = $1 OR (txn_type_id = (SELECT txn_type_id FROM transaction_types WHERE id = $1) AND office_id = $2)
       ORDER BY office_id NULLS LAST LIMIT 1`,
      [tid, officeId],
    );
    results.push(rows[0] ?? { available_from: null, available_until: null });
  }
  return results;
}

/**
 * Find the next available slot time after a given start time.
 * Variable granularity: the next slot opens when an existing appointment ends.
 */
function findNextSlotTime(
  appointments: { id: number; start_min: number; end_min: number; txn_type_ids: number[] }[],
  currentMin: number,
  closeMin: number,
): number | null {
  // Collect all appointment end times that are after currentMin
  const endTimes = appointments
    .filter((a) => a.end_min > currentMin && a.end_min < closeMin)
    .map((a) => a.end_min);

  if (endTimes.length === 0) return null;

  // Return the earliest end time after current
  endTimes.sort((a, b) => a - b);
  return endTimes[0];
}

/**
 * Main slot finder implementing the design doc's booking flow.
 *
 * Priority fallback order:
 * 1. Skill coverage (hard requirement — reject if no clerk can do all txn types)
 * 2. Preferred office
 * 3. Preferred day
 * 4. Preferred time window (morning/afternoon)
 *
 * Returns matched slots plus 2-3 alternatives that vary the trade-off.
 */
export async function findAvailableSlots(
  countyId: string,
  prefs: BookingPreferences,
): Promise<SlotSearchResult> {
  const { txnTypeIds, officeId, preferredDay, timeWindow, asap, maxSlots = 10 } = prefs;
  const startDate = prefs.startDate ?? "2026-05-12";
  const maxDays = prefs.maxDays ?? 30;

  const duration = await getTotalDuration(countyId, txnTypeIds);
  if (duration === 0) return { slots: [], alternatives: [] };

  // Get all offices (or just preferred)
  const offices = await tenantQuery<OfficeConfig>(
    countyId,
    officeId
      ? "SELECT id, office_id, name, total_desks, run_rate_pct FROM offices WHERE id = $1"
      : "SELECT id, office_id, name, total_desks, run_rate_pct FROM offices",
    officeId ? [officeId] : [],
  );

  const primarySlots: TimeSlot[] = [];
  const alternativeSlots: TimeSlot[] = [];

  // Sort offices: preferred first
  const sortedOffices = officeId
    ? offices
    : [...offices].sort((a, b) => (a.id === officeId ? -1 : b.id === officeId ? 1 : 0));

  for (let d = 0; d < maxDays && primarySlots.length < maxSlots; d++) {
    const date = new Date(startDate + "T12:00:00");
    date.setDate(date.getDate() + d);
    const dateStr = date.toISOString().slice(0, 10);
    const dow = date.getDay();

    // If preferred day set and this isn't it, slots go to alternatives
    const isDayMatch = preferredDay == null || dow === preferredDay;

    for (const office of sortedOffices) {
      if (primarySlots.length >= maxSlots) break;

      const isOfficeMatch = officeId == null || office.id === officeId;

      const config = await getOfficeConfig(countyId, office.id);
      if (!config.office) continue;

      const dayHours = config.hours.find((h) => h.day_of_week === dow);
      if (!dayHours) continue;

      // Check clerk coverage: are there clerks with ALL skills scheduled this day?
      const qualifiedClerks = await scheduledClerksWithAllSkills(
        countyId, office.id, dateStr, txnTypeIds,
      );
      if (qualifiedClerks.length === 0) continue;

      // Get time restrictions
      const restrictions = await getTimeRestrictions(countyId, txnTypeIds, office.id);

      const openMin = timeToMin(dayHours.open_time);
      const closeMin = timeToMin(dayHours.close_time);

      // Determine scannable time window
      let windowStart = openMin;
      let windowEnd = closeMin;

      if (timeWindow === "morning") {
        windowEnd = Math.min(windowEnd, 720); // noon
      } else if (timeWindow === "afternoon") {
        windowStart = Math.max(windowStart, 720);
      }

      // Apply time restrictions (narrow the window)
      for (const r of restrictions) {
        if (r.available_from) windowStart = Math.max(windowStart, timeToMin(r.available_from));
        if (r.available_until) windowEnd = Math.min(windowEnd, timeToMin(r.available_until));
      }

      if (windowStart + duration > windowEnd) continue;

      // Get existing appointments for this day (for concurrency check)
      const dayAppointments = await getAppointmentsForDay(countyId, office.id, dateStr);

      // Variable slot scanning: start at window open, then jump to next opening
      let t = windowStart;
      while (t + duration <= windowEnd && primarySlots.length < maxSlots) {
        const available = isSlotAvailable(
          dayAppointments,
          qualifiedClerks,
          config.lunches,
          txnTypeIds,
          t,
          duration,
          config.office.run_rate_pct,
        );

        if (available) {
          const slot: TimeSlot = {
            office_id: office.id,
            office_name: config.office.name,
            date: dateStr,
            time: minToTime(t),
          };

          const isTimeMatch = timeWindow == null || (
            (timeWindow === "morning" && t < 720) ||
            (timeWindow === "afternoon" && t >= 720)
          );

          if (isOfficeMatch && isDayMatch && isTimeMatch) {
            primarySlots.push(slot);
          } else {
            alternativeSlots.push(slot);
          }

          // Next candidate: after this slot's duration (variable granularity)
          t += duration;
        } else {
          // Jump to next opening: find earliest end time of overlapping appointments
          const nextOpening = findNextSlotTime(dayAppointments, t, windowEnd);
          if (nextOpening != null && nextOpening > t) {
            t = nextOpening;
          } else {
            // No more openings possible; try next minute (fallback for edge cases)
            t++;
          }
        }
      }
    }
  }

  // If ASAP mode, return just the earliest slot across all offices
  if (asap && primarySlots.length === 0 && alternativeSlots.length > 0) {
    primarySlots.push(alternativeSlots.shift()!);
  }

  // Return up to 3 alternatives that vary the trade-off
  const diverseAlternatives = pickDiverseAlternatives(alternativeSlots, officeId, preferredDay, timeWindow);

  return { slots: primarySlots, alternatives: diverseAlternatives };
}

/**
 * Pick 2-3 alternatives that each relax a different preference.
 * E.g., same office different day, same day different office, different time window.
 */
function pickDiverseAlternatives(
  candidates: TimeSlot[],
  preferredOfficeId: number | undefined,
  preferredDay: number | undefined,
  preferredTimeWindow: "morning" | "afternoon" | undefined,
): TimeSlot[] {
  if (candidates.length === 0) return [];

  const result: TimeSlot[] = [];

  // Try to find: same office, different day
  if (preferredOfficeId != null) {
    const sameOffice = candidates.find((s) => s.office_id === preferredOfficeId);
    if (sameOffice) result.push(sameOffice);
  }

  // Try to find: same day (first available), different office
  if (preferredDay != null && result.length < 3) {
    const dayNames = candidates.filter((s) => {
      const d = new Date(s.date + "T12:00:00");
      return d.getDay() === preferredDay && !result.includes(s);
    });
    if (dayNames.length > 0) result.push(dayNames[0]);
  }

  // Try to find: different time window
  if (preferredTimeWindow != null && result.length < 3) {
    const opposite = preferredTimeWindow === "morning" ? 720 : 0;
    const maxT = preferredTimeWindow === "morning" ? 1440 : 720;
    const diffTime = candidates.find((s) => {
      const min = timeToMin(s.time);
      return min >= opposite && min < maxT && !result.includes(s);
    });
    if (diffTime) result.push(diffTime);
  }

  // Fill remaining with earliest available
  while (result.length < 3 && candidates.length > 0) {
    const next = candidates.find((s) => !result.includes(s));
    if (!next) break;
    result.push(next);
  }

  return result.slice(0, 3);
}

/**
 * Check if a specific slot is still available (for atomic booking validation).
 */
export async function checkSlotAvailability(
  countyId: string,
  officeId: number,
  date: string,
  time: string,
  txnTypeIds: number[],
): Promise<boolean> {
  const duration = await getTotalDuration(countyId, txnTypeIds);
  if (duration === 0) return false;

  const config = await getOfficeConfig(countyId, officeId);
  if (!config.office) return false;

  const qualifiedClerks = await scheduledClerksWithAllSkills(
    countyId, officeId, date, txnTypeIds,
  );
  if (qualifiedClerks.length === 0) return false;

  const dayAppointments = await getAppointmentsForDay(countyId, officeId, date);
  const candidateMin = timeToMin(time);

  return isSlotAvailable(
    dayAppointments,
    qualifiedClerks,
    config.lunches,
    txnTypeIds,
    candidateMin,
    duration,
    config.office.run_rate_pct,
  );
}

export { scheduledClerksWithAllSkills, getAppointmentsForDay, getTotalDuration, clerksOnLunchWithSkill, countConcurrentFromCache };
