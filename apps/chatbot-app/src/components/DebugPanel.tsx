/**
 * Debug panel — right-side dev overlay.
 *
 * Shows:
 *   1. All facts the session has recorded, with value + confidence.
 *   2. For each active transaction, the decision tree with every branch
 *      laid out. Each branch's `when` clause is rendered as a GREEN blob
 *      if that fact is known (and matches), a RED blob if missing/unknown,
 *      and a YELLOW blob if known but not matching this branch. The current
 *      path is traced from the root `baseItems` through every matching
 *      branch with a connecting line.
 *
 * Backend contract: GET /chatbot/debug/trees?txnTypeIds=a,b returns the
 * relevant trees plus the fact definitions referenced by them.
 */

import { useEffect, useState } from 'react';
import type { SessionData } from '../hooks/useSession';
import {
  fetchDebugTrees,
  submitSessionFeedback,
  downloadTranscriptPdf,
  type DebugTree,
  type DebugFactDefinition,
  type FactValue,
  type KBSource,
} from '../api';

interface Props {
  session: SessionData;
  onNotesChange: (value: string) => void;
}

export function DebugPanel({ session, onNotesChange }: Props) {
  const [trees, setTrees] = useState<DebugTree[]>([]);
  const [defs, setDefs] = useState<DebugFactDefinition[]>([]);
  const [submitState, setSubmitState] = useState<'idle' | 'submitting' | 'submitted' | 'error'>('idle');
  const [downloadState, setDownloadState] = useState<'idle' | 'downloading' | 'error'>('idle');

  const txnIds = session.transactions.map(t => t.txnTypeId).sort().join(',');
  const facts: Record<string, FactValue> = session.context?.facts ?? {};

  useEffect(() => {
    if (!txnIds) {
      setTrees([]);
      setDefs([]);
      return;
    }
    let cancelled = false;
    fetchDebugTrees(txnIds.split(','))
      .then(data => {
        if (cancelled) return;
        setTrees(data.trees);
        setDefs(data.factDefinitions);
      })
      .catch(() => {
        if (cancelled) return;
        setTrees([]);
        setDefs([]);
      });
    return () => { cancelled = true; };
  }, [txnIds]);

  const defByKey = new Map(defs.map(d => [d.factKey, d]));
  const factKeysSorted = Object.keys(facts).sort();

  // Aggregate every KBSource cited across this session, dedupe by url ?? title.
  const allSources: KBSource[] = (() => {
    const seen = new Map<string, KBSource>();
    for (const m of session.messages) {
      for (const s of m.kbSources ?? []) {
        const key = s.url ?? s.title;
        if (!seen.has(key)) seen.set(key, s);
      }
    }
    return Array.from(seen.values());
  })();

  const handleSubmitTranscript = async () => {
    if (!session.sessionId || submitState === 'submitting') return;
    setSubmitState('submitting');
    try {
      await submitSessionFeedback(session.sessionId, {
        notes: session.generalFeedbackNotes,
        messageFeedback: session.messageFeedback,
        capturedAt: new Date().toISOString(),
      });
      setSubmitState('submitted');
      setTimeout(() => setSubmitState('idle'), 2500);
    } catch (err) {
      console.error('Submit transcript failed:', err);
      setSubmitState('error');
      setTimeout(() => setSubmitState('idle'), 2500);
    }
  };

  const handleDownloadTranscript = async () => {
    if (!session.sessionId || downloadState === 'downloading') return;
    setDownloadState('downloading');
    try {
      const blob = await downloadTranscriptPdf(session.sessionId, {
        notes: session.generalFeedbackNotes,
        messageFeedback: session.messageFeedback,
        messages: session.messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
          messageId: m.messageId,
        })),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `transcript-${session.sessionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDownloadState('idle');
    } catch (err) {
      console.error('Download transcript failed:', err);
      setDownloadState('error');
      setTimeout(() => setDownloadState('idle'), 2500);
    }
  };

  return (
    <div className="debug-panel">
      {/* -------- FEEDBACK SECTION (beta-tester capture) -------- */}
      <section className="debug-section debug-feedback">
        <h3>Feedback</h3>
        <textarea
          className="debug-feedback-textarea"
          value={session.generalFeedbackNotes}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="General notes about this session — what worked, what didn't, ideas…"
          rows={4}
        />
        <div className="debug-feedback-actions">
          <button
            type="button"
            className="debug-feedback-btn debug-feedback-btn--primary"
            onClick={handleSubmitTranscript}
            disabled={!session.sessionId || submitState === 'submitting'}
          >
            {submitState === 'submitting' ? 'Submitting…'
              : submitState === 'submitted' ? '✓ Submitted'
              : submitState === 'error' ? 'Retry submit'
              : 'Submit Transcript'}
          </button>
          <button
            type="button"
            className="debug-feedback-btn"
            onClick={handleDownloadTranscript}
            disabled={!session.sessionId || downloadState === 'downloading'}
          >
            {downloadState === 'downloading' ? 'Building PDF…'
              : downloadState === 'error' ? 'Retry download'
              : 'Download Transcript'}
          </button>
        </div>
        <div className="debug-feedback-contact">
          Contact Mason directly at{' '}
          <a href="mailto:maintainer@example.com">maintainer@example.com</a>{' '}
          for questions and concerns.
        </div>
      </section>

      <hr className="debug-divider" />

      <h2>Debug</h2>

      {/* -------- FACTS SECTION -------- */}
      <section className="debug-section">
        <h3>Facts <span className="debug-count">({factKeysSorted.length})</span></h3>
        {factKeysSorted.length === 0 && (
          <p className="debug-empty">No facts recorded yet.</p>
        )}
        <ul className="debug-facts-list">
          {factKeysSorted.map(k => {
            const fv = facts[k];
            const def = defByKey.get(k);
            const color = confidenceColor(fv.confidence);
            return (
              <li key={k} className="debug-fact-row">
                <span
                  className="debug-fact-blob"
                  style={{ background: color }}
                  title={`${fv.confidence} via ${fv.source}`}
                />
                <div className="debug-fact-body">
                  <div className="debug-fact-key">{k}</div>
                  <div className="debug-fact-value">
                    <code>{fv.value}</code>
                    <span className="debug-fact-meta"> ({fv.confidence} · {fv.source})</span>
                  </div>
                  {def && def.label !== k && (
                    <div className="debug-fact-label">{def.label}</div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* -------- TREES SECTION -------- */}
      <section className="debug-section">
        <h3>Decision trees <span className="debug-count">({trees.length})</span></h3>
        {trees.length === 0 && (
          <p className="debug-empty">No active transactions with a tree yet.</p>
        )}
        {trees.map(tree => (
          <TreeView key={tree.txnTypeId} tree={tree} facts={facts} defByKey={defByKey} />
        ))}
      </section>

      {/* -------- SOURCES SECTION (RAG + KB citations rolled up) -------- */}
      <section className="debug-section debug-sources">
        <h3>Sources <span className="debug-count">({allSources.length})</span></h3>
        {allSources.length === 0 && (
          <p className="debug-empty">No knowledge-base sources cited yet.</p>
        )}
        {allSources.length > 0 && (
          <ul className="debug-sources-list">
            {allSources.map((s, i) => (
              <li key={s.url ?? s.title} className="debug-source-row">
                <span className="debug-source-index">[{i + 1}]</span>
                {s.url ? (
                  <a className="debug-source-link" href={s.url} target="_blank" rel="noopener noreferrer">
                    {s.title}
                  </a>
                ) : (
                  <span className="debug-source-link debug-source-link--unlinked">{s.title}</span>
                )}
                <span className="debug-source-type">{s.type}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** Render a single decision tree with all branches + gating fact blobs. */
function TreeView({
  tree,
  facts,
  defByKey,
}: {
  tree: DebugTree;
  facts: Record<string, FactValue>;
  defByKey: Map<string, DebugFactDefinition>;
}) {
  // Determine which branches match the current fact set.
  const branchResults = tree.branches.map(b => {
    const whenEntries = Object.entries(b.when);
    const checks = whenEntries.map(([key, expected]) => {
      const fv = facts[key];
      if (!fv) return { key, expected, status: 'missing' as const };
      if (fv.confidence === 'unknown') return { key, expected, status: 'unknown' as const, got: fv.value };
      if (fv.value === expected) return { key, expected, status: 'match' as const, got: fv.value };
      return { key, expected, status: 'mismatch' as const, got: fv.value };
    });
    const status: 'active' | 'rejected' | 'pending' =
      checks.every(c => c.status === 'match') ? 'active'
      : checks.some(c => c.status === 'mismatch') ? 'rejected'
      : 'pending';
    return { branch: b, checks, status };
  });

  const requiredFactStatuses = tree.factsRequired.map(fk => {
    const fv = facts[fk];
    if (!fv) return { key: fk, status: 'missing' as const };
    if (fv.confidence === 'unknown') return { key: fk, status: 'unknown' as const, value: fv.value };
    return { key: fk, status: 'known' as const, value: fv.value };
  });

  const knownCount = requiredFactStatuses.filter(s => s.status === 'known').length;
  const totalRequired = requiredFactStatuses.length;
  const progress = totalRequired === 0 ? 1 : knownCount / totalRequired;

  return (
    <div className="debug-tree">
      <div className="debug-tree-header">
        <span className="debug-tree-title">{tree.txnTypeId}</span>
        <span className="debug-tree-progress">{knownCount}/{totalRequired} facts</span>
      </div>

      <div className="debug-tree-progress-bar">
        <div
          className="debug-tree-progress-fill"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>

      {/* Required facts strip */}
      <div className="debug-tree-facts-strip">
        {requiredFactStatuses.map(s => (
          <span
            key={s.key}
            className={`debug-fact-chip debug-fact-chip--${s.status}`}
            title={`${s.key}${'value' in s && s.value ? ` = ${s.value}` : ''}`}
          >
            {s.key}
          </span>
        ))}
      </div>

      {/* Base items */}
      <div className="debug-tree-base">
        <div className="debug-tree-sublabel">base items</div>
        <ul className="debug-tree-items">
          {tree.baseItems.map(itemId => (
            <li key={itemId}><code>{itemId}</code></li>
          ))}
        </ul>
      </div>

      {/* Branches */}
      <div className="debug-tree-branches">
        {branchResults.map((br, idx) => (
          <BranchRow
            key={idx}
            index={idx}
            branch={br.branch}
            checks={br.checks}
            status={br.status}
            defByKey={defByKey}
          />
        ))}
      </div>
    </div>
  );
}

type BranchCheck =
  | { key: string; expected: string; status: 'missing' }
  | { key: string; expected: string; status: 'unknown'; got: string }
  | { key: string; expected: string; status: 'match'; got: string }
  | { key: string; expected: string; status: 'mismatch'; got: string };

function BranchRow({
  index,
  branch,
  checks,
  status,
  defByKey,
}: {
  index: number;
  branch: DebugTree['branches'][number];
  checks: BranchCheck[];
  status: 'active' | 'rejected' | 'pending';
  defByKey: Map<string, DebugFactDefinition>;
}) {
  const addCount = branch.addItems?.length ?? 0;
  const removeCount = branch.removeItems?.length ?? 0;

  return (
    <div className={`debug-branch debug-branch--${status}`}>
      <div className="debug-branch-header">
        <span className="debug-branch-index">#{index + 1}</span>
        <span className={`debug-branch-status debug-branch-status--${status}`}>{status}</span>
        {addCount > 0 && <span className="debug-branch-delta debug-branch-delta--add">+{addCount}</span>}
        {removeCount > 0 && <span className="debug-branch-delta debug-branch-delta--remove">−{removeCount}</span>}
      </div>

      <div className="debug-branch-checks">
        {checks.map((c, i) => (
          <div key={i} className={`debug-check debug-check--${c.status}`}>
            <span className="debug-check-blob" />
            <span className="debug-check-key">{c.key}</span>
            <span className="debug-check-expected">= <code>{c.expected}</code></span>
            {'got' in c && (
              <span className="debug-check-got"> (got: <code>{c.got}</code>)</span>
            )}
          </div>
        ))}
      </div>

      {branch.note && <div className="debug-branch-note">{branch.note}</div>}

      {(addCount > 0 || removeCount > 0) && (
        <div className="debug-branch-items">
          {branch.addItems?.map(id => (
            <span key={`add-${id}`} className="debug-delta-item debug-delta-item--add"><code>+{id}</code></span>
          ))}
          {branch.removeItems?.map(id => (
            <span key={`rm-${id}`} className="debug-delta-item debug-delta-item--remove"><code>−{id}</code></span>
          ))}
        </div>
      )}
    </div>
  );
}

function confidenceColor(conf: FactValue['confidence']): string {
  switch (conf) {
    case 'asserted': return '#22c55e';   // green
    case 'inferred': return '#3b82f6';   // blue
    case 'unknown':  return '#ef4444';   // red
  }
}
