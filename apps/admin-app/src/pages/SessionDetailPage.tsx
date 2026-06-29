/**
 * Session detail — chat transcript on the left, tabbed Context/Logs/Feedback/Docs
 * panel on the right. Joins per-message feedback to history rows by messageId.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchSessionDetail,
  type SessionDetail,
  type MessageFeedbackEntry,
} from '../api';

interface Props {
  sessionId: string;
  onBack: () => void;
}

type Tab = 'context' | 'logs' | 'docs';

export function SessionDetailPage({ sessionId, onBack }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('context');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchSessionDetail(sessionId);
      setDetail(d);
    } catch (err) {
      setError(err instanceof Error ? (err as Error & { displayMessage?: string }).displayMessage ?? err.message : 'Load failed.');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => { refresh(); }, [refresh]);

  // Index feedback under one key each: the backend's resolvedMessageId (old
  // sessions, equals a history row's `sk`) when present, else the exact
  // messageId (new sessions, equals history.messageId). A transcript row then
  // looks itself up by messageId first, then by sk — covering both cases.
  const feedbackByKey = useMemo(() => {
    const m = new Map<string, MessageFeedbackEntry[]>();
    if (!detail) return m;
    for (const f of detail.feedback.perMessage) {
      const key = f.resolvedMessageId ?? f.messageId;
      if (!key) continue;
      const arr = m.get(key) ?? [];
      arr.push(f);
      m.set(key, arr);
    }
    return m;
  }, [detail]);

  // Feedback whose key matched no transcript row at all — surfaced in the
  // bottom section so nothing is silently dropped.
  const orphanFeedback = useMemo(() => {
    if (!detail) return [] as MessageFeedbackEntry[];
    const keys = new Set<string>();
    for (const h of detail.history) {
      if (h.messageId) keys.add(h.messageId);
      keys.add(h.sk);
    }
    return detail.feedback.perMessage.filter(
      (f) => !keys.has(f.resolvedMessageId ?? f.messageId),
    );
  }, [detail]);

  return (
    <div className="detail-page">
      <header className="detail-header">
        <button className="ghost-btn" onClick={onBack}>← Back</button>
        <div className="detail-title">
          <code className="detail-sid">{sessionId}</code>
          {detail?.metadata && (
            <div className="detail-meta">
              <span className="state-pill">{String(detail.metadata.currentState)}</span>
              <span className="muted"> · {String(detail.metadata.channel ?? 'web')}</span>
              {typeof detail.metadata.betaTesterEmail === 'string' && (
                <span className="muted"> · {detail.metadata.betaTesterEmail}</span>
              )}
            </div>
          )}
        </div>
        <button className="ghost-btn" onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && <div className="error-banner" role="alert">{error}</div>}

      {detail && (
        <>
          <section className="detail-transcript-full">
            <h2>Transcript <span className="muted">· feedback shown beside the message it was left on</span></h2>
            {detail.history.length === 0 ? (
              <p className="muted">No messages.</p>
            ) : (
              <ul className="transcript-list">
                {detail.history.map((h) => {
                  // Look up by exact messageId first (new sessions), then by sk
                  // (old sessions, where the backend keyed feedback to the row's sk).
                  const fb =
                    (h.messageId ? feedbackByKey.get(h.messageId) : undefined) ??
                    feedbackByKey.get(h.sk) ??
                    [];
                  return (
                    <li key={h.sk} className={`transcript-row transcript-row--${h.role}`}>
                      <div className="transcript-msg">
                        <div className="transcript-meta">
                          <span className="transcript-role">{h.role.toUpperCase()}</span>
                          <span className="muted">{h.timestamp}</span>
                        </div>
                        <div className="transcript-body">{h.content}</div>
                      </div>
                      <div className="transcript-fb">
                        {fb.length === 0 ? (
                          <span className="transcript-fb-empty" aria-hidden="true" />
                        ) : (
                          fb.map((f) => (
                            <div key={f.sk} className={`fb-card fb-card--${f.reaction}`}>
                              <span className={`badge badge-${f.reaction}`}>
                                {f.reaction === 'good' ? '✓ good' : f.reaction === 'bad' ? '✗ bad' : '💬 comment'}
                              </span>
                              {f.comment && <p className="fb-comment">{f.comment}</p>}
                              <span className="muted fb-time">{f.submittedAt}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* Anything that couldn't be matched to a message, plus end-of-session
              transcript submissions. */}
          {(orphanFeedback.length > 0 || detail.feedback.submissions.length > 0) && (
            <section className="detail-extra">
              {orphanFeedback.length > 0 && (
                <>
                  <h3>Unmatched feedback <span className="muted">(couldn't tie to a specific message)</span></h3>
                  <ul className="feedback-list">
                    {orphanFeedback.map((f) => (
                      <li key={f.sk}>
                        <span className={`badge badge-${f.reaction}`}>{f.reaction}</span>
                        <code className="muted">{f.messageId.slice(0, 8)}…</code>
                        {f.comment && <p>{f.comment}</p>}
                        <span className="muted">{f.submittedAt}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {detail.feedback.submissions.length > 0 && <SubmissionsList detail={detail} />}
            </section>
          )}

          {/* Context / Logs / Docs — moved to a full-width section at the bottom. */}
          <section className="detail-bottom">
            <nav className="detail-tabs">
              <TabBtn active={tab === 'context'} onClick={() => setTab('context')}>Context</TabBtn>
              <TabBtn active={tab === 'logs'} onClick={() => setTab('logs')}>Logs ({detail.logs.length})</TabBtn>
              <TabBtn active={tab === 'docs'} onClick={() => setTab('docs')}>Docs ({detail.docs.length})</TabBtn>
            </nav>

            <div className="detail-tabBody">
              {tab === 'context' && <ContextPane metadata={detail.metadata} />}
              {tab === 'logs' && <LogsPane detail={detail} />}
              {tab === 'docs' && <DocsPane detail={detail} />}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" className={`tab-btn ${active ? 'active' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

function ContextPane({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return <p className="muted">No metadata.</p>;
  const ctx = metadata.structuredContext ?? metadata['structuredContext'];
  return (
    <pre className="json-block">{JSON.stringify(ctx, null, 2)}</pre>
  );
}

function LogsPane({ detail }: { detail: SessionDetail }) {
  const [filter, setFilter] = useState<string>('');
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const filtered = filter ? detail.logs.filter((l) => l.eventType === filter) : detail.logs;
  const types = Array.from(new Set(detail.logs.map((l) => l.eventType))).sort();

  return (
    <div>
      <div className="row-between">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
          <option value="">All event types</option>
          {types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="muted">{filtered.length} of {detail.logs.length}</span>
      </div>
      {filtered.length === 0 ? (
        <p className="muted">No logs match.</p>
      ) : (
        <ul className="log-list">
          {filtered.map((l, i) => (
            <li key={l.sk}>
              <button type="button" className="log-row" onClick={() => setOpenIdx(openIdx === i ? null : i)}>
                <span className="muted">{l.timestamp}</span>
                <code>{l.eventType}</code>
                <span>{openIdx === i ? '▾' : '▸'}</span>
              </button>
              {openIdx === i && (
                <pre className="json-block">{JSON.stringify(l.payload, null, 2)}</pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubmissionsList({ detail }: { detail: SessionDetail }) {
  return (
    <>
      <h3>Transcript submissions</h3>
      <ul className="feedback-list">
        {detail.feedback.submissions.map((s) => (
          <li key={s.sk}>
            <span className="muted">{s.capturedAt}</span>
            {s.notes && <p>{s.notes}</p>}
            {s.messageFeedback && (
              <details>
                <summary>messageFeedback snapshot</summary>
                <pre className="json-block">{JSON.stringify(s.messageFeedback, null, 2)}</pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function DocsPane({ detail }: { detail: SessionDetail }) {
  if (detail.docs.length === 0) return <p className="muted">No documents.</p>;
  return (
    <ul className="doc-list">
      {detail.docs.map((d) => (
        <li key={d.sk}>
          <strong>{d.documentType}</strong>
          {d.status && <span className="muted"> · {d.status}</span>}
          {d.s3Key && <div className="muted"><code>{d.s3Key}</code></div>}
          {d.ocrResult !== undefined && (
            <details>
              <summary>OCR result</summary>
              <pre className="json-block">{JSON.stringify(d.ocrResult, null, 2)}</pre>
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
