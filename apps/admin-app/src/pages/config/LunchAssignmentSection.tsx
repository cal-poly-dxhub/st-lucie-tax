import { useCallback, useMemo, useState } from "react";
import { Button, Select } from "@st-lucie/ui";
import {
  fetchClerkSchedules,
  fetchClerks,
  fetchOffices,
  saveClerkSchedules,
  type Clerk,
  type ClerkSchedule,
  type LunchShift,
  type Office,
} from "@/config-api";
import { useResource } from "./use-resource";
import { ErrorBanner, Section, Spinner } from "./parts";

interface Data {
  clerks: Clerk[];
  offices: Office[];
  lunches: LunchShift[];
  schedules: ClerkSchedule[];
}

function weekDates(baseDate: string): string[] {
  const d = new Date(baseDate + "T00:00:00");
  const day = d.getDay(); // 0=Sun
  const mon = new Date(d);
  mon.setDate(d.getDate() - ((day + 6) % 7)); // Monday
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const cur = new Date(mon);
    cur.setDate(mon.getDate() + i);
    dates.push(cur.toISOString().slice(0, 10));
  }
  return dates;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function formatShort(date: string) {
  const d = new Date(date + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function LunchAssignmentSection() {
  const today = new Date().toISOString().slice(0, 10);
  const [officeId, setOfficeId] = useState<number>(0);
  const dates = useMemo(() => weekDates(today), [today]);

  const load = useCallback(async (): Promise<Data> => {
    const [clerksData, officesResponse] = await Promise.all([fetchClerks(), fetchOffices()]);
    const offices = officesResponse.offices;
    const lunches = officesResponse.lunches;
    const oid = officeId || offices[0]?.id || 0;
    const schedules = oid ? await fetchClerkSchedules(oid, dates[0], dates[6]) : [];
    return { clerks: clerksData, offices, lunches, schedules };
  }, [officeId, dates]);

  const { data, error, loading, saving, mutate } = useResource<Data>(load);

  const [edits, setEdits] = useState<Record<string, number | null>>({});

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const { clerks, offices, lunches, schedules } = data;
  const activeOfficeId = officeId || offices[0]?.id || 0;

  const officeClerks = clerks.filter((c) => c.office_ids.includes(activeOfficeId));
  const officeLunches = lunches.filter((l) => l.office_id === activeOfficeId);

  const scheduleMap = new Map<string, ClerkSchedule>();
  for (const s of schedules) {
    scheduleMap.set(`${s.clerk_id}:${s.schedule_date}`, s);
  }

  function getShiftId(clerkId: number, date: string): number | null {
    const key = `${clerkId}:${date}`;
    if (key in edits) return edits[key];
    return scheduleMap.get(key)?.lunch_shift_id ?? null;
  }

  function setShiftId(clerkId: number, date: string, shiftId: number | null) {
    setEdits((prev) => ({ ...prev, [`${clerkId}:${date}`]: shiftId }));
  }

  const hasEdits = Object.keys(edits).length > 0;

  async function saveAll() {
    // Send the complete current-week matrix so unchanged weekdays are also
    // copied to every future week, not just the cells edited in this session.
    const assignments = officeClerks.flatMap((clerk) =>
      dates.map((scheduleDate) => ({
        clerkId: clerk.id,
        officeId: activeOfficeId,
        scheduleDate,
        lunchShiftId: getShiftId(clerk.id, scheduleDate),
      })),
    );
    const ok = await mutate(
      () => saveClerkSchedules(assignments),
      "Lunch template saved for all future weeks.",
    );
    if (ok) setEdits({});
  }

  return (
    <Section
      title="Weekly lunch template"
      description="Set this week's lunch assignments. Saving repeats each weekday's assignment across all future scheduled weeks."
      actions={
        hasEdits ? (
          <Button variant="go" loading={saving} onClick={saveAll}>
            Save template
          </Button>
        ) : undefined
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Select
          aria-label="Office"
          value={String(activeOfficeId)}
          onChange={(e) => {
            setOfficeId(Number(e.target.value));
            setEdits({});
          }}
        >
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>

        <span className="px-2 text-sm font-semibold text-civic-700">
          Current week: {formatShort(dates[0])} – {formatShort(dates[6])}
        </span>
      </div>

      {officeClerks.length === 0 ? (
        <p className="py-4 text-sm text-civic-400">
          No clerks assigned to this office. Assign clerks in the table above first.
        </p>
      ) : officeLunches.length === 0 ? (
        <p className="py-4 text-sm text-civic-400">
          No lunch shifts configured for this office. Add them in the Offices config page.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-civic-100">
                <th className="px-3 py-2 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-civic-400">
                  Clerk
                </th>
                {dates.map((d, i) => (
                  <th
                    key={d}
                    className="px-2 py-2 text-center font-mono text-[10px] font-bold uppercase tracking-wider text-civic-400"
                  >
                    {DOW[i]} {formatShort(d)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {officeClerks.map((c) => (
                <tr key={c.id} className="border-b border-civic-50 hover:bg-civic-50/50">
                  <td className="whitespace-nowrap px-3 py-2 text-sm font-medium text-civic-800">
                    {c.first_name} {c.last_name}
                  </td>
                  {dates.map((d) => (
                    <td key={d} className="px-1 py-1 text-center">
                      <select
                        className="w-full rounded border border-civic-200 bg-white px-1 py-1 text-xs text-civic-700"
                        value={getShiftId(c.id, d) ?? ""}
                        onChange={(e) =>
                          setShiftId(c.id, d, e.target.value ? Number(e.target.value) : null)
                        }
                      >
                        <option value="">—</option>
                        {officeLunches.map((l) => (
                          <option key={l.id} value={l.id}>
                            Shift {l.shift_num} ({l.start_time.slice(0, 5)}–{l.end_time.slice(0, 5)}
                            )
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
