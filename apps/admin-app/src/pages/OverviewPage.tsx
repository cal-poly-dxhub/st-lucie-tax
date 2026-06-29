/**
 * Admin home page — summary cards, state breakdown, recent activity feed,
 * and a filterable session table. Auto-refreshes every 60s; manual refresh
 * button next to the title for impatient operators.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSummary,
  fetchSessions,
  setSessionReviewed,
  type Summary,
  type SessionRow,
  type ListSessionsParams,
} from '../api';

interface Props {
  onOpenSession: (sessionId: string) => void;
}

const REFRESH_MS = 60_000;

// Hard-coded beta-launch cutoff. Anything created before this is automated
// Playwright/eval traffic from earlier today and shouldn't pollute the
// real-tester view. 2026-05-21 14:39:44 PT = 21:39:44 UTC.
const BETA_LAUNCH_CUTOFF_ISO = '2026-05-21T21:39:44.000Z';
const POST_LAUNCH_STORAGE_KEY = 'stlucie-admin-post-launch-only';
const SHOW_TEST_SESSIONS_STORAGE_KEY = 'stlucie-admin-show-test-sessions';

// Module-level cache that OUTLIVES the component. The overview unmounts when
// you open a session; without this the list would refetch (slow — it pulls
// every session) every time you hit Back. We hydrate from this instantly and
// only fetch when it's empty; the 60s interval + manual Refresh keep it fresh.
// Keyed by the fetch params (showTestSessions) so flipping that filter still
// refetches rather than showing the wrong set.
interface OverviewCache { key: string; summary: Summary | null; sessions: SessionRow[] | null; }
let overviewCache: OverviewCache | null = null;

export function OverviewPage({ onOpenSession }: Props) {
  const initialShowTest = (() => {
    try { return localStorage.getItem(SHOW_TEST_SESSIONS_STORAGE_KEY) === '1'; } catch { return false; }
  })();
  const cacheHit = overviewCache && overviewCache.key === String(initialShowTest) ? overviewCache : null;
  const [summary, setSummary] = useState<Summary | null>(cacheHit?.summary ?? null);
  const [sessions, setSessions] = useState<SessionRow[] | null>(cacheHit?.sessions ?? null);
  const [filters, setFilters] = useState<ListSessionsParams>({});
  const [postLaunchOnly, setPostLaunchOnly] = useState<boolean>(() => {
    try { return localStorage.getItem(POST_LAUNCH_STORAGE_KEY) === '1'; } catch { return false; }
  });
  const [showTestSessions, setShowTestSessions] = useState<boolean>(initialShowTest);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function togglePostLaunch(next: boolean) {
    setPostLaunchOnly(next);
    try { localStorage.setItem(POST_LAUNCH_STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
  }

  function toggleShowTestSessions(next: boolean) {
    setShowTestSessions(next);
    try { localStorage.setItem(SHOW_TEST_SESSIONS_STORAGE_KEY, next ? '1' : '0'); } catch { /* ignore */ }
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
      setError(err instanceof Error ? (err as Error & { displayMessage?: string }).displayMessage ?? err.message : 'Load failed.');
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
    const haveFreshCache = overviewCache?.key === String(showTestSessions) && overviewCache?.sessions != null;
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
      setError('Could not update reviewed status. Try again.');
    }
  }, []);

  const filteredSessions = useMemo(() => {
    if (!sessions) return sessions;
    if (!postLaunchOnly) return sessions;
    return sessions.filter((s) => (s.createdAt || '') >= BETA_LAUNCH_CUTOFF_ISO);
  }, [sessions, postLaunchOnly]);

  const filteredActivity = useMemo(() => {
    if (!summary) return [];
    if (!postLaunchOnly) return summary.recentActivity;
    return summary.recentActivity.filter((a) => (a.at || '') >= BETA_LAUNCH_CUTOFF_ISO);
  }, [summary, postLaunchOnly]);

  const filteredComments = useMemo(() => {
    if (!summary?.recentComments) return [];
    if (!postLaunchOnly) return summary.recentComments;
    return summary.recentComments.filter((c) => (c.at || '') >= BETA_LAUNCH_CUTOFF_ISO);
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
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let today = 0;
    let last7d = 0;
    const stateBreakdown: Record<string, number> = {};
    let good = 0, bad = 0, comment = 0, submission = 0;
    let withAny = 0;
    for (const s of filteredSessions) {
      const t = Date.parse(s.createdAt || '') || 0;
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
    <div className="overview-page">
      <header className="overview-header">
        <h1>Overview</h1>
        <div className="overview-header-actions">
          <label className="post-launch-toggle" title={`Filter to sessions created after ${BETA_LAUNCH_CUTOFF_ISO}`}>
            <input
              type="checkbox"
              checked={postLaunchOnly}
              onChange={(e) => togglePostLaunch(e.target.checked)}
            />
            Post beta launch only
          </label>
          <label className="post-launch-toggle" title="Include sessions tagged as test/probe/smoke-check">
            <input
              type="checkbox"
              checked={showTestSessions}
              onChange={(e) => toggleShowTestSessions(e.target.checked)}
            />
            Show test sessions
          </label>
          <button className="ghost-btn" onClick={refresh} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {summary && displayed && (
        <>
          <section className="summary-cards">
            <Card label={postLaunchOnly ? 'Sessions (since launch)' : 'Sessions today'} value={postLaunchOnly ? displayed.sessionCounts.total : displayed.sessionCounts.today} />
            <Card label="Last 7 days" value={displayed.sessionCounts.last7d} />
            <Card label="Total sessions" value={displayed.sessionCounts.total} />
            <Card label="With feedback" value={displayed.feedback.sessionsWithAny} />
          </section>

          <section className="overview-twoCol">
            <div className="overview-block">
              <h2>Feedback</h2>
              <ul className="kv-list">
                <li><span>✓ Good</span><strong>{displayed.feedback.good}</strong></li>
                <li><span>✗ Bad</span><strong>{displayed.feedback.bad}</strong></li>
                <li><span>💬 Comment</span><strong>{displayed.feedback.comment}</strong></li>
                <li><span>📤 Submissions</span><strong>{displayed.feedback.submissions}</strong></li>
              </ul>
            </div>

            <div className="overview-block">
              <h2>State breakdown</h2>
              {states.length === 0 ? (
                <p className="muted">No sessions yet.</p>
              ) : (
                <ul className="kv-list">
                  {states.map(([state, count]) => (
                    <li key={state}>
                      <span>{state}</span>
                      <strong>{count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="overview-block">
            <h2>Recent activity</h2>
            {filteredActivity.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <ul className="activity-list">
                {filteredActivity.map((a, i) => (
                  <li key={i} onClick={() => onOpenSession(a.sessionId)}>
                    <span className={`activity-tag activity-${a.kind.split('.')[0]}`}>{a.kind}</span>
                    <span className="activity-detail">{a.detail ?? ''}</span>
                    <span className="activity-time">{formatRelative(a.at)}</span>
                    <code className="activity-sid">{a.sessionId.slice(0, 8)}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="overview-block">
            <h2>Latest comments</h2>
            {filteredComments.length === 0 ? (
              <p className="muted">No tester comments yet.</p>
            ) : (
              <ul className="comments-list">
                {filteredComments.map((c, i) => (
                  <li key={i} onClick={() => onOpenSession(c.sessionId)}>
                    <div className="comments-row-meta">
                      <span className={`comments-tag comments-tag--${c.kind}`}>
                        {c.kind === 'submission-notes' ? '📤 transcript' : '💬 reply'}
                      </span>
                      {c.betaTesterEmail && <span className="muted">{c.betaTesterEmail}</span>}
                      <span className="muted comments-row-time">{formatRelative(c.at)}</span>
                      <code className="activity-sid">{c.sessionId.slice(0, 8)}</code>
                    </div>
                    <div className="comments-text">{c.text}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="overview-block">
        <div className="row-between">
          <h2>Sessions</h2>
          <FilterBar filters={filters} onChange={setFilters} states={states.map(([s]) => s)} />
        </div>

        {filteredSessions === null && !error ? (
          <p className="muted">Loading…</p>
        ) : filteredSessions && filteredSessions.length === 0 ? (
          <p className="muted">No sessions match these filters.</p>
        ) : (
          <table className="session-table">
            <thead>
              <tr>
                <th title="Mark when you've reviewed this session's feedback">Reviewed</th>
                <th>Session</th>
                <th>Email</th>
                <th>State</th>
                <th>Active txns</th>
                <th>Feedback</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(filteredSessions ?? []).map((s) => (
                <tr key={s.sessionId} onClick={() => onOpenSession(s.sessionId)} className={s.reviewed ? 'session-row--reviewed' : undefined}>
                  <td
                    className="reviewed-cell"
                    onClick={(e) => e.stopPropagation()}
                    title={s.reviewed ? 'Reviewed — click to unmark' : 'Not yet reviewed'}
                  >
                    <input
                      type="checkbox"
                      checked={s.reviewed === true}
                      onChange={(e) => toggleReviewed(s.sessionId, e.target.checked)}
                      aria-label="Reviewed"
                    />
                  </td>
                  <td>
                    <code>{s.sessionId.slice(0, 8)}…</code>
                    {s.isTestSession && <span className="badge badge-test" title="Tagged as test session">TEST</span>}
                  </td>
                  <td>{s.betaTesterEmail ?? <span className="muted">—</span>}</td>
                  <td><code className="state-pill">{s.currentState}</code></td>
                  <td>{s.activeTxnTypeIds.length === 0 ? <span className="muted">—</span> : s.activeTxnTypeIds.join(', ')}</td>
                  <td>{renderBadges(s.feedbackBadges)}</td>
                  <td>{formatRelative(s.createdAt)}</td>
                  <td><button className="ghost-btn">Open →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="summary-card">
      <div className="summary-card-value">{value}</div>
      <div className="summary-card-label">{label}</div>
    </div>
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
    <div className="filter-bar">
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
      <select
        value={filters.state ?? ''}
        onChange={(e) => onChange({ ...filters, state: e.target.value || undefined })}
        className="filter-select"
      >
        <option value="">All states</option>
        {states.map((s) => <option key={s} value={s}>{s}</option>)}
      </select>
      <input
        className="filter-input"
        placeholder="Email contains…"
        value={filters.email ?? ''}
        onChange={(e) => onChange({ ...filters, email: e.target.value || undefined })}
      />
    </div>
  );
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button className={`filter-chip ${active ? 'active' : ''}`} onClick={onClick} type="button">
      {children}
    </button>
  );
}

function renderBadges(b: SessionRow['feedbackBadges']) {
  if (!b) return <span className="muted">—</span>;
  const total = b.good + b.bad + b.comment + b.submission;
  if (total === 0) return <span className="muted">—</span>;
  return (
    <span className="badges">
      {b.good > 0 && <span className="badge badge-good">✓ {b.good}</span>}
      {b.bad > 0 && <span className="badge badge-bad">✗ {b.bad}</span>}
      {b.comment > 0 && <span className="badge badge-comment">💬 {b.comment}</span>}
      {b.submission > 0 && <span className="badge badge-submission">📤 {b.submission}</span>}
    </span>
  );
}

function formatRelative(iso: string): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!t) return iso;
  const diffMs = Date.now() - t;
  const m = Math.round(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
