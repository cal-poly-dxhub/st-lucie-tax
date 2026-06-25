import { useEffect, useState, useRef, useCallback } from "react";
import { ChevronLeft, ChevronRight, Calendar } from "lucide-react";
import { api, type ConfigResponse, type ScheduleAppointment } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { Button, Card } from "@/components/ui";

const TXN_COLORS = [
  "#22c55e", "#c2410c", "#16a34a", "#7c3aed", "#a855f7",
  "#0891b2", "#dc2626", "#e11d48", "#0284c7", "#d97706",
  "#2563eb", "#db2777",
];

function timeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToTime(m: number) {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(d: Date, n: number) {
  const o = new Date(d);
  o.setDate(o.getDate() + n);
  return o;
}
function getMondayOfWeek(d: Date) {
  const dt = new Date(d);
  const day = dt.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  dt.setDate(dt.getDate() + diff);
  return dt;
}
function formatDate(d: Date) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}`;
}

interface DragState {
  appt: ScheduleAppointment & { startMin: number; durationMin: number };
  targetDate: string | null;
  targetMin: number | null;
}

export function SchedulePage() {
  const notify = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [officeId, setOfficeId] = useState(1);
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [appointments, setAppointments] = useState<(ScheduleAppointment & { startMin: number; durationMin: number })[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [ghostPos, setGhostPos] = useState({ x: 0, y: 0 });
  const [dropIndicator, setDropIndicator] = useState<{ date: string; pct: number } | null>(null);
  const trackRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const openMin = (() => {
    if (!config) return 480;
    const wh = config.officeHours.find((h) => h.day_of_week >= 1 && h.day_of_week <= 5);
    return wh ? timeToMin(wh.open_time) : 480;
  })();
  const closeMin = (() => {
    if (!config) return 1020;
    const wh = config.officeHours.find((h) => h.day_of_week >= 1 && h.day_of_week <= 5);
    return wh ? timeToMin(wh.close_time) : 1020;
  })();

  const pct = (min: number) => ((min - openMin) / (closeMin - openMin)) * 100;
  const pctWidth = (dur: number) => (dur / (closeMin - openMin)) * 100;

  useEffect(() => {
    api.config().then((cfg) => {
      setConfig(cfg);
      if (cfg.offices[0]) setOfficeId(cfg.offices[0].id);
      const demoDate = cfg.demoDate ? new Date(cfg.demoDate + "T00:00:00") : new Date();
      setWeekStart(getMondayOfWeek(demoDate));
    });
  }, []);

  const loadAppointments = useCallback(async () => {
    if (!weekStart) return;
    const endDate = addDays(weekStart, 4);
    try {
      const data = await api.scheduleAppointments(officeId, isoDate(weekStart), isoDate(endDate));
      setAppointments(
        data.map((a) => ({
          ...a,
          startMin: timeToMin(a.start_time),
          durationMin: Number(a.duration_min),
        })),
      );
    } catch {
      // silent
    }
  }, [officeId, weekStart]);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  function txnColor(txnId: number) {
    const idx = (config?.txnTypes ?? []).findIndex((t) => t.id === txnId);
    return TXN_COLORS[idx % TXN_COLORS.length] || "#666";
  }

  function assignLanes(dayAppts: typeof appointments) {
    const sorted = [...dayAppts].sort((a, b) => a.startMin - b.startMin);
    const laneEnds: number[] = [];
    const assignments = new Map<number, number>();
    for (const appt of sorted) {
      let assigned = -1;
      for (let l = 0; l < laneEnds.length; l++) {
        if (laneEnds[l] <= appt.startMin) {
          assigned = l;
          laneEnds[l] = appt.startMin + appt.durationMin;
          break;
        }
      }
      if (assigned === -1) {
        assigned = laneEnds.length;
        laneEnds.push(appt.startMin + appt.durationMin);
      }
      assignments.set(appt.id, assigned);
    }
    return { assignments, laneCount: Math.max(laneEnds.length, 1) };
  }

  function handleDragStart(appt: typeof appointments[0], e: React.MouseEvent) {
    e.preventDefault();
    setDragState({ appt, targetDate: null, targetMin: null });
    setGhostPos({ x: e.clientX + 12, y: e.clientY - 12 });

    const onMove = (me: MouseEvent) => {
      setGhostPos({ x: me.clientX + 12, y: me.clientY - 12 });
      const el = document.elementFromPoint(me.clientX, me.clientY)?.closest("[data-track-date]") as HTMLElement | null;
      if (el) {
        const rect = el.getBoundingClientRect();
        const xPct = (me.clientX - rect.left) / rect.width;
        const minute = Math.round(openMin + xPct * (closeMin - openMin));
        const snapped = Math.round(minute / 5) * 5;
        setDropIndicator({ date: el.dataset.trackDate!, pct: pct(snapped) });
        setDragState((prev) => prev ? { ...prev, targetDate: el.dataset.trackDate!, targetMin: snapped } : null);
      } else {
        setDropIndicator(null);
        setDragState((prev) => prev ? { ...prev, targetDate: null, targetMin: null } : null);
      }
    };

    const onUp = async () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setDropIndicator(null);

      const state = dragState;
      setDragState(null);

      if (!state?.targetDate || state.targetMin == null) return;
      if (state.targetDate === appt.appointment_date && state.targetMin === appt.startMin) return;

      const newTime = minToTime(state.targetMin) + ":00";
      let result = await api.reschedule(appt.id, state.targetDate, newTime, false);
      if (!result.success && result.error === "capacity_exceeded") {
        if (confirm("This slot exceeds estimated capacity. Move anyway?")) {
          result = await api.reschedule(appt.id, state.targetDate, newTime, true);
        }
      }
      if (result.success) {
        notify("success", `Moved ${appt.first_name} to ${minToTime(state.targetMin)}`);
        loadAppointments();
      } else if (result.error && result.error !== "capacity_exceeded") {
        notify("error", `Cannot move: ${result.error}`);
      }
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  if (!config || !weekStart) {
    return (
      <main className="mx-auto max-w-7xl px-6 py-8">
        <p className="text-civic-400">Loading schedule…</p>
      </main>
    );
  }

  const lunchShifts = (config.lunchShifts ?? [])
    .filter((ls) => ls.office_id === officeId)
    .map((ls) => ({ start: timeToMin(ls.start_time), end: timeToMin(ls.end_time) }));

  const endDate = addDays(weekStart, 4);
  const LANE_H = 36;

  return (
    <main className="mx-auto max-w-full px-6 py-8 space-y-4">
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Calendar className="text-civic-500" size={20} />
            <h2 className="font-display text-lg font-bold text-civic-800">Check-In Schedule</h2>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={officeId}
              onChange={(e) => setOfficeId(Number(e.target.value))}
              className="rounded-lg border border-civic-200 bg-white px-3 py-1.5 text-sm"
            >
              {config.offices.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
            <div className="flex items-center gap-2">
              <Button variant="outline" className="px-2 py-1" onClick={() => setWeekStart(addDays(weekStart, -7))}>
                <ChevronLeft size={16} />
              </Button>
              <span className="min-w-[180px] text-center text-sm font-bold text-civic-700">
                {formatDate(weekStart)} — {formatDate(endDate)}
              </span>
              <Button variant="outline" className="px-2 py-1" onClick={() => setWeekStart(addDays(weekStart, 7))}>
                <ChevronRight size={16} />
              </Button>
            </div>
            <Button
              variant="go"
              className="text-xs px-3 py-1"
              onClick={() => {
                const d = config.demoDate ? new Date(config.demoDate + "T00:00:00") : new Date();
                setWeekStart(getMondayOfWeek(d));
              }}
            >
              Today
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-3">
          {config.txnTypes
            .filter((t) => t.status === "active")
            .map((t, i) => (
              <div key={t.id} className="flex items-center gap-1.5 text-xs text-civic-600">
                <span
                  className="inline-block size-3 rounded-sm"
                  style={{ background: TXN_COLORS[i % TXN_COLORS.length] }}
                />
                {t.name} ({t.duration}m)
              </div>
            ))}
        </div>
      </Card>

      <div className="space-y-4 overflow-x-auto">
        {Array.from({ length: 5 }, (_, dayOffset) => {
          const date = addDays(weekStart, dayOffset);
          const dateStr = isoDate(date);
          const dayAppts = appointments.filter((a) => a.appointment_date === dateStr);
          const { assignments, laneCount } = assignLanes(dayAppts);
          const trackH = laneCount * LANE_H;

          return (
            <div key={dateStr}>
              <div className="mb-1 flex items-center gap-3">
                <span className="text-sm font-bold text-civic-700">{formatDate(date)}</span>
                <span className="text-xs text-civic-400">
                  {dayAppts.length} appointment{dayAppts.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="relative">
                {/* Hour marks */}
                <div className="relative mb-0.5 h-4 border-b border-civic-100">
                  {Array.from(
                    { length: Math.floor(closeMin / 60) - Math.floor(openMin / 60) + 1 },
                    (_, i) => {
                      const h = Math.floor(openMin / 60) + i;
                      return (
                        <span
                          key={h}
                          className="absolute -translate-x-1/2 text-[10px] text-civic-400"
                          style={{ left: `${pct(h * 60)}%` }}
                        >
                          {h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`}
                        </span>
                      );
                    },
                  )}
                </div>

                {/* Track */}
                <div
                  ref={(el) => { if (el) trackRefs.current.set(dateStr, el); }}
                  data-track-date={dateStr}
                  className="relative rounded border border-civic-100 bg-civic-50/30"
                  style={{ height: trackH }}
                >
                  {/* Lane dividers */}
                  {Array.from({ length: laneCount - 1 }, (_, l) => (
                    <div
                      key={l}
                      className="absolute left-0 right-0 h-px bg-civic-100"
                      style={{ top: (l + 1) * LANE_H }}
                    />
                  ))}

                  {/* Lunch overlays */}
                  {lunchShifts.map((ls, i) => (
                    <div
                      key={i}
                      className="absolute top-0 bottom-0 border-l border-r border-dashed border-civic-200 bg-civic-100/30"
                      style={{ left: `${pct(ls.start)}%`, width: `${pctWidth(ls.end - ls.start)}%` }}
                    >
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] uppercase text-civic-400">
                        lunch
                      </span>
                    </div>
                  ))}

                  {/* Drop indicator */}
                  {dropIndicator?.date === dateStr && (
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-go-500 z-20"
                      style={{ left: `${dropIndicator.pct}%` }}
                    >
                      <div className="absolute -top-1 -left-1 size-2.5 rounded-full bg-go-500" />
                    </div>
                  )}

                  {/* Appointment blocks */}
                  {dayAppts.map((appt) => {
                    const lane = assignments.get(appt.id) ?? 0;
                    const left = pct(appt.startMin);
                    const width = pctWidth(appt.durationMin);
                    const isDragging = dragState?.appt.id === appt.id;

                    if (appt.txn_type_ids.length > 1) {
                      let offset = 0;
                      return (
                        <div
                          key={appt.id}
                          className={`absolute flex items-center overflow-hidden rounded-sm cursor-grab border-2 border-civic-800 ${isDragging ? "opacity-40" : ""}`}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                            top: lane * LANE_H + 2,
                            height: LANE_H - 4,
                          }}
                          onMouseDown={(e) => handleDragStart(appt, e)}
                        >
                          {appt.txn_type_ids.map((tid) => {
                            const dur = config.txnTypes.find((t) => t.id === tid)?.duration ?? 0;
                            const segPct = (dur / appt.durationMin) * 100;
                            const segLeft = (offset / appt.durationMin) * 100;
                            offset += dur;
                            return (
                              <div
                                key={tid}
                                className="absolute top-0 h-full"
                                style={{ left: `${segLeft}%`, width: `${segPct}%`, background: txnColor(tid) }}
                              />
                            );
                          })}
                          <span className="relative z-10 w-full text-center text-[10px] font-medium text-white">
                            {appt.first_name} {appt.last_name.charAt(0)}.
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={appt.id}
                        className={`absolute flex items-center justify-center rounded-sm px-1 text-[10px] font-medium text-white cursor-grab ${isDragging ? "opacity-40" : ""}`}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          top: lane * LANE_H + 2,
                          height: LANE_H - 4,
                          background: txnColor(appt.txn_type_ids[0]),
                        }}
                        onMouseDown={(e) => handleDragStart(appt, e)}
                      >
                        {appt.first_name} {appt.last_name.charAt(0)}.
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Drag ghost */}
      {dragState && (
        <div
          className="pointer-events-none fixed z-[9999] rounded px-3 py-1.5 text-xs font-bold text-white opacity-90"
          style={{
            left: ghostPos.x,
            top: ghostPos.y,
            background: dragState.appt.txn_type_ids.length > 1
              ? `linear-gradient(135deg, ${dragState.appt.txn_type_ids.map((id) => txnColor(id)).join(", ")})`
              : txnColor(dragState.appt.txn_type_ids[0]),
          }}
        >
          {dragState.appt.first_name} {dragState.appt.last_name.charAt(0)}.
        </div>
      )}
    </main>
  );
}
