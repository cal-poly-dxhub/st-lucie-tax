/**
 * Session detail — full-width chat transcript with feedback pinned beside the
 * message it was left on, then a tabbed Context/Logs/Docs panel underneath.
 * Joins per-message feedback to history rows by messageId.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Card, SectionLabel, Select } from "@st-lucie/ui";
import { fetchSessionDetail, type SessionDetail, type MessageFeedbackEntry } from "../api";

interface Props {
  sessionId: string;
  onBack: () => void;
}

type Tab = "context" | "logs" | "docs";

export function SessionDetailPage({ sessionId, onBack }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("context");
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchSessionDetail(sessionId);
      setDetail(d);
    } catch (err) {
      setError(
        err instanceof Error
          ? ((err as Error & { displayMessage?: string }).displayMessage ?? err.message)
          : "Load failed.",
      );
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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
    return detail.feedback.perMessage.filter((f) => !keys.has(f.resolvedMessageId ?? f.messageId));
  }, [detail]);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onBack} className="px-2 py-1">
          ← Back
        </Button>
        <div className="min-w-0 flex-1">
          <code className="block truncate font-mono text-sm text-civic-800">{sessionId}</code>
          {detail?.metadata && (
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-civic-500">
              <code className="rounded-md bg-civic-950/5 px-2 py-0.5 font-mono text-[11px] text-civic-700">
                {String(detail.metadata.currentState)}
              </code>
              <span>· {String(detail.metadata.channel ?? "web")}</span>
              {typeof detail.metadata.betaTesterEmail === "string" && (
                <span>· {detail.metadata.betaTesterEmail}</span>
              )}
            </div>
          )}
        </div>
        <Button variant="outline" onClick={refresh} loading={loading} className="px-3 py-1.5">
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-stop-200 bg-stop-50 px-4 py-3 text-sm font-medium text-stop-700"
        >
          {error}
        </div>
      )}

      {detail && (
        <>
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-baseline gap-2">
              <SectionLabel>Transcript</SectionLabel>
              <span className="text-xs text-civic-400">
                feedback shown beside the message it was left on
              </span>
            </div>
            {detail.history.length === 0 ? (
              <Muted>No messages.</Muted>
            ) : (
              <ul className="flex flex-col gap-3">
                {detail.history.map((h) => {
                  // Look up by exact messageId first (new sessions), then by sk
                  // (old sessions, where the backend keyed feedback to the row's sk).
                  const fb =
                    (h.messageId ? feedbackByKey.get(h.messageId) : undefined) ??
                    feedbackByKey.get(h.sk) ??
                    [];
                  const isUser = h.role === "user";
                  return (
                    <li key={h.sk} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]">
                      <div
                        className={[
                          "rounded-xl px-4 py-3 ring-1 ring-inset",
                          isUser ? "bg-civic-50 ring-civic-100" : "bg-white ring-civic-100",
                        ].join(" ")}
                      >
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <span
                            className={[
                              "text-[10px] font-bold tracking-widest uppercase",
                              isUser ? "text-civic-600" : "text-go-700",
                            ].join(" ")}
                          >
                            {h.role.toUpperCase()}
                          </span>
                          <span className="text-xs text-civic-400">{h.timestamp}</span>
                        </div>
                        <div className="text-sm whitespace-pre-wrap text-civic-800">
                          {h.content}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {fb.map((f) => (
                          <div
                            key={f.sk}
                            className={[
                              "rounded-xl px-3 py-2 ring-1 ring-inset",
                              f.reaction === "good"
                                ? "bg-go-50 ring-go-200"
                                : f.reaction === "bad"
                                  ? "bg-stop-50 ring-stop-200"
                                  : "bg-civic-50 ring-civic-200",
                            ].join(" ")}
                          >
                            <Badge tone={reactionTone(f.reaction)}>
                              {f.reaction === "good"
                                ? "✓ good"
                                : f.reaction === "bad"
                                  ? "✗ bad"
                                  : "💬 comment"}
                            </Badge>
                            {f.comment && (
                              <p className="mt-1.5 text-xs text-civic-700">{f.comment}</p>
                            )}
                            <span className="mt-1 block text-[11px] text-civic-400">
                              {f.submittedAt}
                            </span>
                          </div>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {/* Anything that couldn't be matched to a message, plus end-of-session
              transcript submissions. */}
          {(orphanFeedback.length > 0 || detail.feedback.submissions.length > 0) && (
            <Card className="flex flex-col gap-5 p-5">
              {orphanFeedback.length > 0 && (
                <div>
                  <div className="mb-3 flex flex-wrap items-baseline gap-2">
                    <SectionLabel>Unmatched feedback</SectionLabel>
                    <span className="text-xs text-civic-400">
                      (couldn&apos;t tie to a specific message)
                    </span>
                  </div>
                  <ul className="flex flex-col divide-y divide-civic-50">
                    {orphanFeedback.map((f) => (
                      <li key={f.sk} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                        <Badge tone={reactionTone(f.reaction)}>{f.reaction}</Badge>
                        <code className="font-mono text-xs text-civic-400">
                          {f.messageId.slice(0, 8)}…
                        </code>
                        {f.comment && <p className="min-w-0 flex-1 text-civic-700">{f.comment}</p>}
                        <span className="ml-auto text-xs text-civic-400">{f.submittedAt}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {detail.feedback.submissions.length > 0 && <SubmissionsList detail={detail} />}
            </Card>
          )}

          {/* Context / Logs / Docs — full-width section at the bottom. */}
          <Card className="p-5">
            <nav className="mb-4 flex flex-wrap gap-1 border-b border-civic-100 pb-px">
              <TabBtn active={tab === "context"} onClick={() => setTab("context")}>
                Context
              </TabBtn>
              <TabBtn active={tab === "logs"} onClick={() => setTab("logs")}>
                Logs ({detail.logs.length})
              </TabBtn>
              <TabBtn active={tab === "docs"} onClick={() => setTab("docs")}>
                Docs ({detail.docs.length})
              </TabBtn>
            </nav>

            <div>
              {tab === "context" && <ContextPane metadata={detail.metadata} />}
              {tab === "logs" && <LogsPane detail={detail} />}
              {tab === "docs" && <DocsPane detail={detail} />}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Presentation helpers ────────────────────────────────────────────────────

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-civic-400">{children}</p>;
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="mt-2 max-h-96 overflow-auto rounded-xl bg-civic-950/[0.04] p-3 font-mono text-xs leading-relaxed text-civic-800">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function reactionTone(reaction: string): "go" | "stop" | "neutral" {
  if (reaction === "good") return "go";
  if (reaction === "bad") return "stop";
  return "neutral";
}

function TabBtn({
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
        "-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
        active
          ? "border-civic-500 text-civic-800"
          : "border-transparent text-civic-500 hover:text-civic-700",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function ContextPane({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata) return <Muted>No metadata.</Muted>;
  const ctx = metadata.structuredContext ?? metadata["structuredContext"];
  return <JsonBlock value={ctx} />;
}

function LogsPane({ detail }: { detail: SessionDetail }) {
  const [filter, setFilter] = useState<string>("");
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const filtered = filter ? detail.logs.filter((l) => l.eventType === filter) : detail.logs;
  const types = Array.from(new Set(detail.logs.map((l) => l.eventType))).sort();

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter by event type"
          className="w-56 px-2 py-1.5 text-xs"
        >
          <option value="">All event types</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
        <span className="text-xs text-civic-400">
          {filtered.length} of {detail.logs.length}
        </span>
      </div>
      {filtered.length === 0 ? (
        <Muted>No logs match.</Muted>
      ) : (
        <ul className="mt-3 flex flex-col divide-y divide-civic-50">
          {filtered.map((l, i) => (
            <li key={l.sk}>
              <button
                type="button"
                onClick={() => setOpenIdx(openIdx === i ? null : i)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-civic-50"
              >
                <span className="text-xs text-civic-400">{l.timestamp}</span>
                <code className="font-mono text-xs text-civic-700">{l.eventType}</code>
                <span className="ml-auto text-civic-400">{openIdx === i ? "▾" : "▸"}</span>
              </button>
              {openIdx === i && <JsonBlock value={l.payload} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubmissionsList({ detail }: { detail: SessionDetail }) {
  return (
    <div>
      <SectionLabel>Transcript submissions</SectionLabel>
      <ul className="mt-3 flex flex-col divide-y divide-civic-50">
        {detail.feedback.submissions.map((s) => (
          <li key={s.sk} className="py-2.5">
            <span className="text-xs text-civic-400">{s.capturedAt}</span>
            {s.notes && <p className="mt-1 text-sm text-civic-700">{s.notes}</p>}
            {s.messageFeedback && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-medium text-civic-600">
                  messageFeedback snapshot
                </summary>
                <JsonBlock value={s.messageFeedback} />
              </details>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocsPane({ detail }: { detail: SessionDetail }) {
  if (detail.docs.length === 0) return <Muted>No documents.</Muted>;
  return (
    <ul className="flex flex-col divide-y divide-civic-50">
      {detail.docs.map((d) => (
        <li key={d.sk} className="py-2.5">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="text-sm font-semibold text-civic-800">{d.documentType}</strong>
            {d.status && <span className="text-xs text-civic-500">· {d.status}</span>}
          </span>
          {d.s3Key && (
            <code className="mt-1 block font-mono text-xs break-all text-civic-400">{d.s3Key}</code>
          )}
          {d.ocrResult !== undefined && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs font-medium text-civic-600">
                OCR result
              </summary>
              <JsonBlock value={d.ocrResult} />
            </details>
          )}
        </li>
      ))}
    </ul>
  );
}
