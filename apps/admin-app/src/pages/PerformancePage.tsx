/**
 * Performance dashboard.
 *
 * Chart conventions follow the repo's dataviz guidance: one y-axis per chart
 * (never a dual axis), sequential civic blue where the job is magnitude, a
 * second categorical hue only where two distinct series share a plot, hairline
 * gridlines, thin marks, and a table view for every chart's underlying numbers.
 *
 * The two-slot categorical pair (civic blue #12639d, warn orange #d97706) was
 * validated against the page surface: worst-pair CVD ΔE 24.1, normal-vision
 * 32.9, both clear of the floors, and both clear 3:1 contrast.
 */

import { useCallback, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Badge,
  Button,
  Card,
  SectionLabel,
  Table,
  TBody,
  TD,
  TEmpty,
  TH,
  THead,
  TR,
} from "@st-lucie/ui";
import {
  approveDurationRecommendation,
  fetchClerkPerformance,
  fetchDurationRecommendations,
  fetchPerformanceMetrics,
  rejectDurationRecommendation,
  type ClerkPerformance,
  type DurationRecommendation,
  type PerformanceMetrics,
} from "@/config-api";
import { useResource } from "./config/use-resource";
import { ErrorBanner, Section, Spinner } from "./config/parts";

/* ── Chart tokens ────────────────────────────────────────────────────────────
   Hex rather than CSS vars: Recharts passes these to SVG fill/stroke, and the
   civic tokens live in an @theme block that SVG attributes can't resolve. */
const SERIES_1 = "#12639d"; // civic-500 — structural / primary magnitude
const SERIES_2 = "#d97706"; // warn-500 — second series only
const GRID = "#d6e6f4"; // civic-100 hairline
const AXIS_INK = "#4585bf"; // civic-400, recessive
const SURFACE = "#ffffff";

const RANGES = [7, 14, 30] as const;

/** Postgres ROUND() returns numeric, which node-postgres yields as a string. */
const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const fmt = (v: number | null, suffix = "") =>
  v === null ? "—" : `${v.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}`;

/**
 * Recharts formatters receive `ValueType | undefined`, so every callback would
 * otherwise need its own guard. These narrow once.
 */
const asNumber = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Tooltip formatter for a minutes value under a fixed series name. */
const minutesTooltip = (label: string) => (v: unknown) =>
  [`${fmt(asNumber(v))} min`, label] as [string, string];

/** Bar label formatter — returns "" to suppress rather than render "null". */
const labelMinutes = (v: unknown) => {
  const n = asNumber(v);
  return n === null ? "" : fmt(n);
};

/** "2026-07-28T00:00:00.000Z" → "Jul 28" */
const shortDay = (day: string) => {
  const d = new Date(day);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
};

interface Data {
  metrics: PerformanceMetrics;
  clerks: ClerkPerformance;
  recommendations: DurationRecommendation[];
}

export function PerformancePage() {
  const [days, setDays] = useState<number>(30);

  const load = useCallback(async (): Promise<Data> => {
    const [metrics, clerks, recommendations] = await Promise.all([
      fetchPerformanceMetrics(days),
      fetchClerkPerformance(days),
      fetchDurationRecommendations(),
    ]);
    return { metrics, clerks, recommendations };
  }, [days]);

  const { data, error, loading, saving, mutate } = useResource<Data>(load);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-civic-900">Performance</h1>
          <p className="mt-1 text-sm text-civic-500">
            Service times and volume from completed visits.
          </p>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={days === r ? "civic" : "outline"}
              onClick={() => setDays(r)}
              className="px-3 py-1.5"
              aria-pressed={days === r}
            >
              {r} days
            </Button>
          ))}
        </div>
      </div>

      {error ? (
        <ErrorBanner>{error}</ErrorBanner>
      ) : loading && !data ? (
        <Spinner />
      ) : !data ? null : (
        <>
          <KpiRow metrics={data.metrics} days={days} />
          <AvgByTransaction metrics={data.metrics} />
          <DailyServiceTime metrics={data.metrics} />
          <DailyVolume metrics={data.metrics} />
          <OfficeComparison metrics={data.metrics} />
          <ClerkTable clerks={data.clerks} />
          <Recommendations recommendations={data.recommendations} saving={saving} mutate={mutate} />
        </>
      )}
    </div>
  );
}

// ─── KPI tiles ───────────────────────────────────────────────────────────────

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-4">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2 text-3xl font-semibold text-civic-900">{value}</div>
      {hint && <p className="mt-1 text-xs text-civic-400">{hint}</p>}
    </Card>
  );
}

function KpiRow({ metrics, days }: { metrics: PerformanceMetrics; days: number }) {
  const totalServed = metrics.dailyVolume.reduce((sum, d) => sum + d.customers_served, 0);

  // Weight each day's average by its own sample count — a flat mean of daily
  // means would overweight quiet days.
  const weighted = metrics.dailyTimes.reduce(
    (acc, d) => {
      const avg = num(d.avg_minutes);
      if (avg === null || !d.count) return acc;
      return { total: acc.total + avg * d.count, count: acc.count + d.count };
    },
    { total: 0, count: 0 },
  );
  const avgService = weighted.count ? weighted.total / weighted.count : null;

  const busiest = metrics.dailyVolume.reduce<{ day: string; customers_served: number } | null>(
    (best, d) => (best === null || d.customers_served > best.customers_served ? d : best),
    null,
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatTile
        label="Customers served"
        value={totalServed.toLocaleString()}
        hint={`Last ${days} days`}
      />
      <StatTile
        label="Avg service time"
        value={fmt(avgService, " min")}
        hint="Weighted by volume"
      />
      <StatTile
        label="Avg wait time"
        value={fmt(num(metrics.waitTimes.avg_wait_minutes), " min")}
        hint={`${metrics.waitTimes.sample_count.toLocaleString()} visits measured`}
      />
      <StatTile
        label="Busiest day"
        value={busiest ? shortDay(busiest.day) : "—"}
        hint={busiest ? `${busiest.customers_served.toLocaleString()} served` : undefined}
      />
    </div>
  );
}

// ─── Chart chrome ────────────────────────────────────────────────────────────

const axisProps = {
  stroke: AXIS_INK,
  tick: { fill: AXIS_INK, fontSize: 11 },
  tickLine: false,
} as const;

const tooltipProps = {
  contentStyle: {
    borderRadius: 12,
    border: `1px solid ${GRID}`,
    fontSize: 12,
    boxShadow: "0 12px 32px -18px rgba(8,37,57,0.45)",
  },
  labelStyle: { color: "#0b3556", fontWeight: 600 },
} as const;

/** Chart with a collapsible table of the same numbers — never color-alone. */
function ChartCard({
  title,
  description,
  children,
  table,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  table: React.ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <Section
      title={title}
      description={description}
      actions={
        <Button variant="outline" onClick={() => setShowTable((s) => !s)} className="px-3 py-1.5">
          {showTable ? "Hide table" : "Table view"}
        </Button>
      }
    >
      {children}
      {showTable && <div className="mt-4">{table}</div>}
    </Section>
  );
}

function EmptyPlot({ children = "No data for this period." }: { children?: string }) {
  return <p className="py-16 text-center text-sm text-civic-400">{children}</p>;
}

// ─── Avg minutes by transaction ──────────────────────────────────────────────

/**
 * Horizontal bars: transaction names are long, and the job is magnitude
 * comparison, so one sequential hue rather than a color per bar.
 */
function AvgByTransaction({ metrics }: { metrics: PerformanceMetrics }) {
  const rows = useMemo(
    () =>
      metrics.avgByTxn
        .map((r) => ({
          name: r.txn_name,
          minutes: num(r.avg_minutes) ?? 0,
          samples: r.sample_count,
        }))
        .sort((a, b) => b.minutes - a.minutes),
    [metrics],
  );

  return (
    <ChartCard
      title="Average service time by transaction"
      description="Longest first. Drives the duration recommendations below."
      table={
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Transaction</TH>
              <TH align="right">Avg minutes</TH>
              <TH align="right">Visits</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TEmpty colSpan={3}>No completed visits in this period.</TEmpty>
            ) : (
              rows.map((r) => (
                <TR key={r.name}>
                  <TD>{r.name}</TD>
                  <TD align="right" className="tnum">
                    {fmt(r.minutes)}
                  </TD>
                  <TD align="right" className="tnum">
                    {r.samples.toLocaleString()}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      }
    >
      {rows.length === 0 ? (
        <EmptyPlot />
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34)}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 48, bottom: 4, left: 8 }}
          >
            <CartesianGrid horizontal={false} stroke={GRID} />
            <XAxis
              type="number"
              {...axisProps}
              unit=" min"
              axisLine={{ stroke: GRID }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              width={200}
              {...axisProps}
              axisLine={false}
              interval={0}
            />
            <Tooltip
              {...tooltipProps}
              formatter={minutesTooltip("Average")}
              cursor={{ fill: "rgba(18,99,157,0.06)" }}
            />
            <Bar
              dataKey="minutes"
              fill={SERIES_1}
              maxBarSize={20}
              radius={[0, 4, 4, 0]}
              label={{
                position: "right",
                fill: "#52514e",
                fontSize: 11,
                formatter: labelMinutes,
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// ─── Daily service time ──────────────────────────────────────────────────────

function DailyServiceTime({ metrics }: { metrics: PerformanceMetrics }) {
  const rows = useMemo(
    () =>
      metrics.dailyTimes.map((d) => ({
        day: shortDay(d.day),
        minutes: num(d.avg_minutes),
        count: d.count,
      })),
    [metrics],
  );

  return (
    <ChartCard
      title="Average service time per day"
      description="One point per day. A rising line usually means longer transactions, not slower clerks — check the mix below."
      table={
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Day</TH>
              <TH align="right">Avg minutes</TH>
              <TH align="right">Visits</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TEmpty colSpan={3}>No completed visits in this period.</TEmpty>
            ) : (
              rows.map((r) => (
                <TR key={r.day}>
                  <TD>{r.day}</TD>
                  <TD align="right" className="tnum">
                    {fmt(r.minutes)}
                  </TD>
                  <TD align="right" className="tnum">
                    {r.count.toLocaleString()}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      }
    >
      {rows.length === 0 ? (
        <EmptyPlot />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" {...axisProps} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} unit=" min" width={56} />
            <Tooltip {...tooltipProps} formatter={minutesTooltip("Average")} />
            <Line
              type="monotone"
              dataKey="minutes"
              stroke={SERIES_1}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              connectNulls
              dot={{ r: 4, fill: SERIES_1, stroke: SURFACE, strokeWidth: 2 }}
              activeDot={{ r: 5, fill: SERIES_1, stroke: SURFACE, strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// ─── Daily volume ────────────────────────────────────────────────────────────

function DailyVolume({ metrics }: { metrics: PerformanceMetrics }) {
  const rows = useMemo(
    () =>
      metrics.dailyVolume.map((d) => ({
        day: shortDay(d.day),
        served: d.customers_served,
      })),
    [metrics],
  );

  const peak = rows.reduce((max, r) => Math.max(max, r.served), 0);

  return (
    <ChartCard
      title="Customers served per day"
      description="The busiest day is labeled; hover any column for its count."
      table={
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Day</TH>
              <TH align="right">Customers served</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TEmpty colSpan={2}>No completed visits in this period.</TEmpty>
            ) : (
              rows.map((r) => (
                <TR key={r.day}>
                  <TD>{r.day}</TD>
                  <TD align="right" className="tnum">
                    {r.served.toLocaleString()}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      }
    >
      {rows.length === 0 ? (
        <EmptyPlot />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 20, right: 16, bottom: 4, left: 0 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="day" {...axisProps} axisLine={{ stroke: GRID }} minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} width={48} allowDecimals={false} />
            <Tooltip
              {...tooltipProps}
              formatter={(v: unknown) => [(asNumber(v) ?? 0).toLocaleString(), "Served"]}
              cursor={{ fill: "rgba(18,99,157,0.06)" }}
            />
            <Bar
              dataKey="served"
              fill={SERIES_1}
              maxBarSize={24}
              radius={[4, 4, 0, 0]}
              label={{
                position: "top",
                fill: "#52514e",
                fontSize: 11,
                // Label only the peak — a number on every column goes unread.
                formatter: (v: unknown) => {
                  const n = asNumber(v);
                  return n !== null && n === peak ? n.toLocaleString() : "";
                },
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartCard>
  );
}

// ─── Office comparison ───────────────────────────────────────────────────────

/**
 * Service and wait time per office.
 *
 * Both series are minutes, so they share one y-axis — never a second scale.
 * Two series means a legend is required, so identity is not color-alone.
 */
function OfficeComparison({ metrics }: { metrics: PerformanceMetrics }) {
  const rows = useMemo(
    () =>
      metrics.officeMetrics.map((o) => ({
        name: o.office_name,
        service: num(o.avg_service_minutes) ?? 0,
        wait: num(o.avg_wait_minutes) ?? 0,
        served: o.total_served,
      })),
    [metrics],
  );

  return (
    <ChartCard
      title="Office comparison"
      description="Service and wait time in minutes on one scale."
      table={
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Office</TH>
              <TH align="right">Avg service</TH>
              <TH align="right">Avg wait</TH>
              <TH align="right">Served</TH>
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TEmpty colSpan={4}>No completed visits in this period.</TEmpty>
            ) : (
              rows.map((r) => (
                <TR key={r.name}>
                  <TD>{r.name}</TD>
                  <TD align="right" className="tnum">
                    {fmt(r.service)}
                  </TD>
                  <TD align="right" className="tnum">
                    {fmt(r.wait)}
                  </TD>
                  <TD align="right" className="tnum">
                    {r.served.toLocaleString()}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>
      }
    >
      {rows.length === 0 ? (
        <EmptyPlot />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-4">
            <LegendKey color={SERIES_1} label="Avg service time" />
            <LegendKey color={SERIES_2} label="Avg wait time" />
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }} barGap={2}>
              <CartesianGrid vertical={false} stroke={GRID} />
              <XAxis dataKey="name" {...axisProps} axisLine={{ stroke: GRID }} interval={0} />
              <YAxis {...axisProps} axisLine={false} unit=" min" width={56} />
              <Tooltip
                {...tooltipProps}
                formatter={(v: unknown, key: unknown) => [
                  `${fmt(asNumber(v))} min`,
                  key === "service" ? "Avg service" : "Avg wait",
                ]}
                cursor={{ fill: "rgba(18,99,157,0.06)" }}
              />
              <Bar dataKey="service" fill={SERIES_1} maxBarSize={22} radius={[4, 4, 0, 0]} />
              <Bar dataKey="wait" fill={SERIES_2} maxBarSize={22} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </ChartCard>
  );
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-civic-600">
      <span className="size-2.5 rounded-full" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

// ─── Clerk performance ───────────────────────────────────────────────────────

/**
 * Per-clerk service time.
 *
 * A table rather than a chart: clerk-vs-clerk speed is sensitive, and the
 * transaction mix explains most of the spread — the expandable per-transaction
 * breakdown is the honest framing, and a ranked bar chart is not.
 */
function ClerkTable({ clerks }: { clerks: ClerkPerformance }) {
  const [openId, setOpenId] = useState<number | null>(null);

  const byClerk = useMemo(() => {
    const m = new Map<number, ClerkPerformance["byTransactionType"]>();
    for (const r of clerks.byTransactionType) {
      const arr = m.get(r.clerk_id) ?? [];
      arr.push(r);
      m.set(r.clerk_id, arr);
    }
    return m;
  }, [clerks]);

  return (
    <Section
      title="Clerk service times"
      description="Averages depend heavily on which transactions a clerk handles — expand a row before comparing."
    >
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Clerk</TH>
            <TH align="right" className="w-24">
              Served
            </TH>
            <TH align="right" className="w-24">
              Avg
            </TH>
            <TH align="right" className="w-24">
              Fastest
            </TH>
            <TH align="right" className="w-24">
              Slowest
            </TH>
            <TH align="right" className="w-28" />
          </TR>
        </THead>
        <TBody>
          {clerks.summary.length === 0 ? (
            <TEmpty colSpan={6}>No clerk activity in this period.</TEmpty>
          ) : (
            clerks.summary.flatMap((c) => {
              const open = openId === c.clerk_id;
              const detail = byClerk.get(c.clerk_id) ?? [];
              const rows = [
                <TR key={c.clerk_id}>
                  <TD className="font-medium text-civic-800">
                    {c.first_name} {c.last_name}
                  </TD>
                  <TD align="right" className="tnum">
                    {c.total_served.toLocaleString()}
                  </TD>
                  <TD align="right" className="tnum">
                    {fmt(num(c.avg_minutes))}
                  </TD>
                  <TD align="right" className="tnum text-civic-500">
                    {fmt(num(c.min_minutes))}
                  </TD>
                  <TD align="right" className="tnum text-civic-500">
                    {fmt(num(c.max_minutes))}
                  </TD>
                  <TD align="right">
                    <Button
                      variant="ghost"
                      onClick={() => setOpenId(open ? null : c.clerk_id)}
                      aria-expanded={open}
                      className="px-2 py-1"
                    >
                      {open ? "Hide" : "By type"}
                    </Button>
                  </TD>
                </TR>,
              ];
              if (open) {
                rows.push(
                  <TR key={`${c.clerk_id}-detail`} className="hover:bg-transparent">
                    <TD colSpan={6} className="bg-civic-50/40">
                      {detail.length === 0 ? (
                        <p className="py-2 text-sm text-civic-400">
                          No per-transaction breakdown available.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-1 py-1">
                          {detail.map((d) => (
                            <li
                              key={d.txn_type_id}
                              className="flex items-center justify-between gap-4 text-sm"
                            >
                              <span className="text-civic-700">{d.txn_name}</span>
                              <span className="tnum text-civic-500">
                                {fmt(num(d.avg_minutes), " min")} · {d.count.toLocaleString()}{" "}
                                served
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TD>
                  </TR>,
                );
              }
              return rows;
            })
          )}
        </TBody>
      </Table>
    </Section>
  );
}

// ─── Duration recommendations ────────────────────────────────────────────────

type Mutate = (action: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;

/**
 * Nightly worker output. Approving writes the recommended duration onto the
 * transaction type, which changes how long every future block is scheduled for.
 */
function Recommendations({
  recommendations,
  saving,
  mutate,
}: {
  recommendations: DurationRecommendation[];
  saving: boolean;
  mutate: Mutate;
}) {
  const pending = recommendations.filter((r) => r.status === "pending");
  const decided = recommendations.filter((r) => r.status !== "pending");

  const delta = (r: DurationRecommendation) => r.recommended_avg_min - r.current_avg_min;

  return (
    <Section
      title="Duration recommendations"
      description="Suggested by the nightly worker from observed service times. Approving updates the transaction's scheduled duration immediately."
    >
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH>Transaction</TH>
            <TH align="right" className="w-24">
              Current
            </TH>
            <TH align="right" className="w-28">
              Suggested
            </TH>
            <TH align="right" className="w-24">
              Change
            </TH>
            <TH align="right" className="w-24">
              Sample
            </TH>
            <TH align="right" className="w-52" />
          </TR>
        </THead>
        <TBody>
          {pending.length === 0 ? (
            <TEmpty colSpan={6}>No pending recommendations.</TEmpty>
          ) : (
            pending.map((r) => {
              const d = delta(r);
              return (
                <TR key={r.id}>
                  <TD className="font-medium text-civic-800">{r.txn_name}</TD>
                  <TD align="right" className="tnum">
                    {r.current_avg_min} min
                  </TD>
                  <TD align="right" className="tnum">
                    {r.recommended_avg_min} min
                  </TD>
                  <TD align="right" className="tnum">
                    <span className={d > 0 ? "text-warn-700" : "text-go-700"}>
                      {d > 0 ? "+" : ""}
                      {d} min
                    </span>
                  </TD>
                  <TD align="right" className="tnum text-civic-500">
                    {r.sample_size.toLocaleString()}
                  </TD>
                  <TD align="right">
                    <span className="inline-flex items-center gap-1">
                      <Button
                        variant="go"
                        disabled={saving}
                        onClick={() =>
                          mutate(
                            () => approveDurationRecommendation(r.id),
                            `${r.txn_name} set to ${r.recommended_avg_min} min.`,
                          )
                        }
                        className="px-2 py-1"
                      >
                        Approve
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={saving}
                        onClick={() =>
                          mutate(
                            () => rejectDurationRecommendation(r.id),
                            "Recommendation rejected.",
                          )
                        }
                        className="px-2 py-1"
                      >
                        Reject
                      </Button>
                    </span>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {decided.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-sm font-bold text-civic-800">Previously decided</h3>
          <ul className="flex flex-col gap-1.5">
            {decided.map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <Badge tone={r.status === "approved" ? "go" : "neutral"}>{r.status}</Badge>
                <span className="text-civic-700">{r.txn_name}</span>
                <span className="tnum text-civic-400">
                  {r.current_avg_min} → {r.recommended_avg_min} min
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}
