/**
 * Admin home page — summary cards, state breakdown, recent activity feed,
 * and a filterable session table. Auto-refreshes every 60s; manual refresh
 * button next to the title for impatient operators.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card as UiCard,
  Check,
  Input,
  SectionLabel,
  Select,
  Table,
  TBody,
  TD,
  TEmpty,
  TH,
  THead,
  TR,
} from "@st-lucie/ui";
import {
  fetchSummary,
  fetchSessions,
  setSessionReviewed,
  type Summary,
  type SessionRow,
  type ListSessionsParams,
} from "../api";

interface Props {
  onOpenSession: (sessionId: string) => void;
}

const REFRESH_MS = 60_000;

// Hard-coded beta-launch cutoff. Anything created before this is automated
// Playwright/eval traffic from earlier today and shouldn't pollute the
// real-tester view. 2026-05-21 14:39:44 PT = 21:39:44 UTC.
const BETA_LAUNCH_CUTOFF_ISO = "2026-05-21T21:39:44.000Z";
const POST_LAUNCH_STORAGE_KEY = "stlucie-admin-post-launch-only";
const SHOW_TEST_SESSIONS_STORAGE_KEY = "stlucie-admin-show-test-sessions";

// Module-level cache that OUTLIVES the component. The overview unmounts when
// you open a session; without this the list would refetch (slow — it pulls
// every session) every time you hit Back. We hydrate from this instantly and
// only fetch when it's empty; the 60s interval + manual Refresh keep it fresh.
// Keyed by the fetch params (showTestSessions) so flipping that filter still
// refetches rather than showing the wrong set.
interface OverviewCache {
  key: string;
  summary: Summary | null;
  sessions: SessionRow[] | null;
}
let overviewCache: OverviewCache | null = null;

export function OverviewPage({ onOpenSession }: Props) {
  const initialShowTest = (() => {
    try {
      return localStorage.getItem(SHOW_TEST_SESSIONS_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  })();
  const cacheHit =
    overviewCache && overviewCache.key === String(initialShowTest) ? overviewCache : null;
  const [summary, setSummary] = useState<Summary | null>(cacheHit?.summary ?? null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(cacheHit?.sessions ?? null);
  const [filters, setFilters] = useState<ListSessionsParams>({});
  const [postLaunchOnly, setPostLaunchOnly] = useState<boolean>(() => {
    try {
      return localStorage.getItem(POST_LAUNCH_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [showTestSessions, setShowTestSessions] = useState<boolean>(initialShowTest);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePostLaunch(next: boolean) {
    setPostLaunchOnly(next);
    try {
      localStorage.setItem(POST_LAUNCH_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  function toggleShowTestSessions(next: boolean) {
    setShowTestSessions(next);
    try {
      localStorage.setItem(SHOW_TEST_SESSIONS_STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, l] = await Promise.all([
        fetchSummary(),
        fetchSessions({ ...filters, includeTestSessions: showTestSessions }),
      ]);
      setSummary(s);
      setSessions(l.items);
      // Write through to the cross-navigation cache.
      overviewCache = { key: String(showTestSessions), summary: s, sessions: l.items };
    } catch (err) {
      setError(
        err instanceof Error
          ? ((err as Error & { displayMessage?: string }).displayMessage ?? err.message)
          : "Load failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, showTestSessions]);

  useEffect(() => {
    // Skip the initial fetch if we hydrated from cache for THIS filter set
    // (returning from a session view) — the data's already on screen. The
    // background interval still refreshes it, and Refresh / filter changes
    // always refetch. A filter change makes the cache key mismatch, so the
    // guard falls through and we fetch the correct set.
    const haveFreshCache =
      overviewCache?.key === String(showTestSessions) && overviewCache?.sessions != null;
    if (!haveFreshCache) refresh();
    const t = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [refresh, showTestSessions]);

  // Toggle the admin "reviewed" flag. Optimistic: flip the row immediately,
  // roll back if the PATCH fails. Does NOT trigger a full refresh so the
  // operator's scroll position + filters stay put. Also patches the
  // cross-navigation cache so the flip survives a round-trip to a session view.
  const patchCache = (sessionId: string, reviewed: boolean) => {
    if (overviewCache?.sessions) {
      overviewCache.sessions = overviewCache.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, reviewed } : s,
      );
    }
  };
  const toggleReviewed = useCallback(async (sessionId: string, next: boolean) => {
    setSessions((prev) =>
      prev ? prev.map((s) => (s.sessionId === sessionId ? { ...s, reviewed: next } : s)) : prev,
    );
    patchCache(sessionId, next);
    try {
      await setSessionReviewed(sessionId, next);
    } catch {
      // Roll back on failure.
      patchCache(sessionId, !next);
      setSessions((prev) =>
        prev ? prev.map((s) => (s.sessionId === sessionId ? { ...s, reviewed: !next } : s)) : prev,
      );
      setError("Could not update reviewed status. Try again.");
    }
  }, []);

  const filteredSessions = useMemo(() => {
    if (!sessions) return sessions;
    if (!postLaunchOnly) return sessions;
    return sessions.filter((s) => (s.createdAt || "") >= BETA_LAUNCH_CUTOFF_ISO);
  }, [sessions, postLaunchOnly]);

  const filteredActivity = useMemo(() => {
    if (!summary) return [];
    if (!postLaunchOnly) return summary.recentActivity;
    return summary.recentActivity.filter((a) => (a.at || "") >= BETA_LAUNCH_CUTOFF_ISO);
  }, [summary, postLaunchOnly]);

  const filteredComments = useMemo(() => {
    if (!summary?.recentComments) return [];
    if (!postLaunchOnly) return summary.recentComments;
    return summary.recentComments.filter((c) => (c.at || "") >= BETA_LAUNCH_CUTOFF_ISO);
  }, [summary, postLaunchOnly]);

  // When the toggle is ON, every aggregate (summary cards, state breakdown,
  // feedback counts) recomputes from the filtered session list rather than
  // from the server-side summary. The session list already carries
  // createdAt + currentState + per-session feedback badges, so the math is
  // exact. When OFF, we use the raw summary from the server.
  const displayed = useMemo(() => {
    if (!summary) return null;
    if (!postLaunchOnly || !filteredSessions) {
      return {
        sessionCounts: summary.sessionCounts,
        stateBreakdown: summary.stateBreakdown,
        feedback: summary.feedback,
      };
    }
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let today = 0;
    let last7d = 0;
    const stateBreakdown: Record<string, number> = {};
    let good = 0,
      bad = 0,
      comment = 0,
      submission = 0;
    let withAny = 0;
    for (const s of filteredSessions) {
      const t = Date.parse(s.createdAt || "") || 0;
      if (t >= todayStart.getTime()) today += 1;
      if (t >= sevenDaysAgo) last7d += 1;
      stateBreakdown[s.currentState] = (stateBreakdown[s.currentState] ?? 0) + 1;
      const b = s.feedbackBadges;
      if (b) {
        good += b.good;
        bad += b.bad;
        comment += b.comment;
        submission += b.submission;
        if (b.good + b.bad + b.comment + b.submission > 0) withAny += 1;
      }
    }
    return {
      sessionCounts: { today, last7d, total: filteredSessions.length },
      stateBreakdown,
      feedback: { good, bad, comment, submissions: submission, sessionsWithAny: withAny },
    };
  }, [summary, postLaunchOnly, filteredSessions]);

  const states = useMemo(() => {
    if (!displayed) return [];
    return Object.entries(displayed.stateBreakdown).sort((a, b) => b[1] - a[1]);
  }, [displayed]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-civic-900">Sessions</h1>
          <p className="mt-1 text-sm text-civic-500">
            Chatbot conversations, tester feedback, and review status.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ToggleLabel
            checked={postLaunchOnly}
            onChange={togglePostLaunch}
            title={`Filter to sessions created after ${BETA_LAUNCH_CUTOFF_ISO}`}
          >
            Post beta launch only
          </ToggleLabel>
          <ToggleLabel
            checked={showTestSessions}
            onChange={toggleShowTestSessions}
            title="Include sessions tagged as test/probe/smoke-check"
          >
            Show test sessions
          </ToggleLabel>
          <Button variant="outline" onClick={refresh} loading={loading} className="px-3 py-1.5">
            {loading ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-stop-200 bg-stop-50 px-4 py-3 text-sm font-medium text-stop-700"
        >
          {error}
        </div>
      )}

      {summary && displayed && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label={postLaunchOnly ? "Sessions (since launch)" : "Sessions today"}
              value={postLaunchOnly ? displayed.sessionCounts.total : displayed.sessionCounts.today}
            />
            <StatCard label="Last 7 days" value={displayed.sessionCounts.last7d} />
            <StatCard label="Total sessions" value={displayed.sessionCounts.total} />
            <StatCard label="With feedback" value={displayed.feedback.sessionsWithAny} />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Block title="Feedback">
              <KvList
                items={[
                  { key: "Good", label: "✓ Good", value: displayed.feedback.good },
                  { key: "Bad", label: "✗ Bad", value: displayed.feedback.bad },
                  { key: "Comment", label: "💬 Comment", value: displayed.feedback.comment },
                  {
                    key: "Submissions",
                    label: "📤 Submissions",
                    value: displayed.feedback.submissions,
                  },
                ]}
              />
            </Block>

            <Block title="State breakdown">
              {states.length === 0 ? (
                <Muted>No sessions yet.</Muted>
              ) : (
                <KvList
                  items={states.map(([state, count]) => ({
                    key: state,
                    label: state,
                    value: count,
                    mono: true,
                  }))}
                />
              )}
            </Block>
          </section>

          <Block title="Recent activity">
            {filteredActivity.length === 0 ? (
              <Muted>No activity yet.</Muted>
            ) : (
              <ul className="flex flex-col divide-y divide-civic-50">
                {filteredActivity.map((a, i) => (
                  <li key={i}>
                    <button
                      onClick={() => onOpenSession(a.sessionId)}
                      className="flex w-full flex-wrap items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-civic-50"
                    >
                      <Badge tone={activityTone(a.kind)}>{a.kind}</Badge>
                      <span className="min-w-0 flex-1 truncate text-civic-700">
                        {a.detail ?? ""}
                      </span>
                      <span className="text-xs text-civic-400">{formatRelative(a.at)}</span>
                      <code className="font-mono text-xs text-civic-400">
                        {a.sessionId.slice(0, 8)}
                      </code>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          <Block title="Latest comments">
            {filteredComments.length === 0 ? (
              <Muted>No tester comments yet.</Muted>
            ) : (
              <ul className="flex flex-col divide-y divide-civic-50">
                {filteredComments.map((c, i) => (
                  <li key={i}>
                    <button
                      onClick={() => onOpenSession(c.sessionId)}
                      className="flex w-full flex-col gap-1 rounded-md px-2 py-2.5 text-left transition-colors hover:bg-civic-50"
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={c.kind === "submission-notes" ? "civic" : "neutral"}>
                          {c.kind === "submission-notes" ? "📤 transcript" : "💬 reply"}
                        </Badge>
                        {c.betaTesterEmail && (
                          <span className="text-xs text-civic-500">{c.betaTesterEmail}</span>
                        )}
                        <span className="ml-auto text-xs text-civic-400">
                          {formatRelative(c.at)}
                        </span>
                        <code className="font-mono text-xs text-civic-400">
                          {c.sessionId.slice(0, 8)}
                        </code>
                      </span>
                      <span className="text-sm text-civic-700">{c.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Block>
        </>
      )}

      <Block
        title="Sessions"
        actions={
          <FilterBar filters={filters} onChange={setFilters} states={states.map(([s]) => s)} />
        }
      >
        {filteredSessions === null && !error ? (
          <Muted>Loading…</Muted>
        ) : (
          <Table>
            <THead>
              <TR className="hover:bg-transparent">
                <TH className="w-24">Reviewed</TH>
                <TH>Session</TH>
                <TH>Email</TH>
                <TH>State</TH>
                <TH>Active txns</TH>
                <TH>Feedback</TH>
                <TH>Created</TH>
                <TH align="right" className="w-24" />
              </TR>
            </THead>
            <TBody>
              {(filteredSessions ?? []).length === 0 ? (
                <TEmpty colSpan={8}>No sessions match these filters.</TEmpty>
              ) : (
                (filteredSessions ?? []).map((s) => (
                  <TR
                    key={s.sessionId}
                    className={`cursor-pointer ${s.reviewed ? "opacity-60" : ""}`}
                  >
                    {/* The checkbox owns its own click; the rest of the row opens
                        the session. */}
                    <TD align="center" onClick={(e) => e.stopPropagation()}>
                      <Check
                        checked={s.reviewed === true}
                        onChange={(e) => toggleReviewed(s.sessionId, e.target.checked)}
                        aria-label="Reviewed"
                        title={s.reviewed ? "Reviewed — click to unmark" : "Not yet reviewed"}
                      />
                    </TD>
                    <TD onClick={() => onOpenSession(s.sessionId)}>
                      <span className="flex items-center gap-2">
                        <code className="font-mono text-xs text-civic-600">
                          {s.sessionId.slice(0, 8)}…
                        </code>
                        {s.isTestSession && (
                          <Badge tone="warn" className="!text-[10px]">
                            test
                          </Badge>
                        )}
                      </span>
                    </TD>
                    <TD onClick={() => onOpenSession(s.sessionId)}>
                      {s.betaTesterEmail ?? <Muted inline>—</Muted>}
                    </TD>
                    <TD onClick={() => onOpenSession(s.sessionId)}>
                      <code className="rounded-md bg-civic-950/5 px-2 py-0.5 font-mono text-[11px] text-civic-700">
                        {s.currentState}
                      </code>
                    </TD>
                    <TD onClick={() => onOpenSession(s.sessionId)}>
                      {s.activeTxnTypeIds.length === 0 ? (
                        <Muted inline>—</Muted>
                      ) : (
                        <span className="text-xs text-civic-600">
                          {s.activeTxnTypeIds.join(", ")}
                        </span>
                      )}
                    </TD>
                    <TD onClick={() => onOpenSession(s.sessionId)}>
                      {renderBadges(s.feedbackBadges)}
                    </TD>
                    <TD
                      onClick={() => onOpenSession(s.sessionId)}
                      className="text-xs text-civic-500"
                    >
                      {formatRelative(s.createdAt)}
                    </TD>
                    <TD align="right">
                      <Button
                        variant="ghost"
                        onClick={() => onOpenSession(s.sessionId)}
                        className="px-2 py-1"
                      >
                        Open →
                      </Button>
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        )}
      </Block>
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

function Muted({ children, inline }: { children: React.ReactNode; inline?: boolean }) {
  return inline ? (
    <span className="text-civic-400">{children}</span>
  ) : (
    <p className="py-6 text-center text-sm text-civic-400">{children}</p>
  );
}

function ToggleLabel({
  checked,
  onChange,
  title,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-civic-600"
      title={title}
    >
      <Check checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <UiCard className="p-4">
      <SectionLabel>{label}</SectionLabel>
      <div className="mt-2 text-3xl font-semibold text-civic-900">{value.toLocaleString()}</div>
    </UiCard>
  );
}

function Block({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <UiCard className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>{title}</SectionLabel>
        {actions}
      </div>
      {children}
    </UiCard>
  );
}

function KvList({
  items,
}: {
  items: { key: string; label: string; value: number; mono?: boolean }[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-civic-50">
      {items.map((it) => (
        <li key={it.key} className="flex items-center justify-between gap-4 py-2 text-sm">
          <span className={it.mono ? "font-mono text-xs text-civic-600" : "text-civic-600"}>
            {it.label}
          </span>
          <strong className="tnum font-semibold text-civic-900">{it.value.toLocaleString()}</strong>
        </li>
      ))}
    </ul>
  );
}

function FilterBar({
  filters,
  onChange,
  states,
}: {
  filters: ListSessionsParams;
  onChange: (next: ListSessionsParams) => void;
  states: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterChip
        active={!!filters.hasFeedback}
        onClick={() => onChange({ ...filters, hasFeedback: !filters.hasFeedback })}
      >
        Has feedback
      </FilterChip>
      <FilterChip
        active={!!filters.hasBad}
        onClick={() => onChange({ ...filters, hasBad: !filters.hasBad })}
      >
        ✗ Has bad
      </FilterChip>
      <FilterChip
        active={!!filters.hasSubmission}
        onClick={() => onChange({ ...filters, hasSubmission: !filters.hasSubmission })}
      >
        📤 Submitted
      </FilterChip>
      <Select
        value={filters.state ?? ""}
        onChange={(e) => onChange({ ...filters, state: e.target.value || undefined })}
        aria-label="Filter by state"
        className="w-40 px-2 py-1.5 text-xs"
      >
        <option value="">All states</option>
        {states.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </Select>
      <Input
        placeholder="Email contains…"
        value={filters.email ?? ""}
        onChange={(e) => onChange({ ...filters, email: e.target.value || undefined })}
        aria-label="Filter by email"
        className="w-44 px-2 py-1.5 text-xs"
      />
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors",
        active
          ? "bg-civic-500 text-white ring-civic-500"
          : "bg-white text-civic-600 ring-civic-200 hover:bg-civic-50",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/** Activity kinds share a prefix per domain; tone by that prefix. */
function activityTone(kind: string): "go" | "stop" | "civic" | "neutral" {
  const domain = kind.split(".")[0];
  if (domain === "feedback") return "civic";
  if (domain === "error") return "stop";
  if (domain === "session") return "go";
  return "neutral";
}

function renderBadges(b: SessionRow["feedbackBadges"]) {
  if (!b) return <Muted inline>—</Muted>;
  const total = b.good + b.bad + b.comment + b.submission;
  if (total === 0) return <Muted inline>—</Muted>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {b.good > 0 && <Badge tone="go">✓ {b.good}</Badge>}
      {b.bad > 0 && <Badge tone="stop">✗ {b.bad}</Badge>}
      {b.comment > 0 && <Badge tone="neutral">💬 {b.comment}</Badge>}
      {b.submission > 0 && <Badge tone="civic">📤 {b.submission}</Badge>}
    </span>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!t) return iso;
  const diffMs = Date.now() - t;
  const m = Math.round(diffMs / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
