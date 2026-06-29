/**
 * Confirm-answers review card.
 *
 * Renders after resolve-facts when the session enters the `confirm-facts`
 * state. Displays a table of every fact the system collected (asserted +
 * inferred), lets the customer edit any user-asserted value, and surfaces a
 * "Send me a copy" email opt-in. Editing a row re-runs the decision tree
 * on the backend and refreshes the right-side checklist.
 */

import { useEffect, useMemo, useState } from 'react';
import type { FactValue, DebugFactDefinition, SessionContext, EditFactsResponse } from '../api';
import { confirmFacts, editFacts, fetchDebugTrees } from '../api';
import { humanize, confidenceLabel } from '../utils/humanize';
import { AcronymText } from './AcronymText';

type NewHardBlocks = EditFactsResponse['newHardBlocks'];

interface Props {
  sessionId: string;
  facts: Record<string, FactValue>;
  txnTypeIds: string[];
  onConfirmed: (newState: string) => void;
  onFactsUpdated: (patch: Partial<SessionContext>) => void;
}

export function ConfirmFacts({
  sessionId,
  facts,
  txnTypeIds,
  onConfirmed,
  onFactsUpdated,
}: Props) {
  const [defs, setDefs] = useState<DebugFactDefinition[]>([]);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newlyUnresolved, setNewlyUnresolved] = useState<string[]>([]);
  /**
   * Persistent across subsequent edits: once an edit induces a hard block, we
   * keep showing the banner until the customer acknowledges. New edits ADD to
   * this list rather than replace it so a second edit doesn't erase the first
   * block's record.
   */
  const [newHardBlocks, setNewHardBlocks] = useState<NewHardBlocks>([]);
  const [acknowledgedBlocks, setAcknowledgedBlocks] = useState(false);
  const [emailChecked, setEmailChecked] = useState(false);
  const [emailAddress, setEmailAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchDebugTrees(txnTypeIds)
      .then(r => setDefs(r.factDefinitions))
      .catch(() => setDefs([]));
  }, [txnTypeIds]);

  const defByKey = useMemo(() => {
    const m = new Map<string, DebugFactDefinition>();
    for (const d of defs) m.set(d.factKey, d);
    return m;
  }, [defs]);

  // Only show facts relevant to active transactions (skip stray facts).
  const rows = useMemo(() => {
    const relevant = defs.map(d => d.factKey);
    const order = new Map(relevant.map((k, i) => [k, i] as const));
    return Object.entries(facts)
      .filter(([k]) => order.has(k))
      .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
  }, [facts, defs]);

  const handleEdit = async (factKey: string, newValue: string) => {
    setSavingKey(factKey);
    setError(null);
    try {
      const resp = await editFacts(sessionId, [{ factKey, value: newValue }]);
      setNewlyUnresolved(resp.newlyUnresolved);
      if (resp.newHardBlocks && resp.newHardBlocks.length > 0) {
        setNewHardBlocks(prev => {
          const known = new Set(prev.map(b => b.txnTypeId));
          return [...prev, ...resp.newHardBlocks.filter(b => !known.has(b.txnTypeId))];
        });
        setAcknowledgedBlocks(false);
      }
      onFactsUpdated({
        facts: resp.facts,
        resolvedBuckets: resp.resolvedBuckets,
        transactions: resp.transactions,
      });
    } catch (err) {
      console.error('Edit facts failed:', err);
      const typed = err as { displayMessage?: string };
      setError(typed.displayMessage ?? "We couldn't save that change. Try once more.");
    } finally {
      setSavingKey(null);
    }
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = emailChecked && emailAddress.trim()
        ? { address: emailAddress.trim() }
        : undefined;
      const resp = await confirmFacts(sessionId, payload);
      onConfirmed(resp.newState);
    } catch (err: unknown) {
      console.error('Confirm facts failed:', err);
      const typed = err as { body?: { newlyUnresolved?: string[] }; displayMessage?: string };
      if (typed.body?.newlyUnresolved) {
        setNewlyUnresolved(typed.body.newlyUnresolved);
        setError("There's a question above that still needs an answer — once you pick one, we can keep going.");
      } else {
        setError(typed.displayMessage ?? "We couldn't save that just now. Try once more, or refresh if it keeps happening.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const unresolvedDefs = newlyUnresolved
    .map(k => defByKey.get(k))
    .filter((d): d is DebugFactDefinition => !!d);

  // Facts the customer answered "Not sure" (value === 'unknown'). These resolve
  // the question (the flow advanced) but match no decision-tree branch, so any
  // documents gated on them are silently omitted. Surface them here so the
  // customer can give a real answer before finalizing — and so a "not sure"
  // never quietly produces an incomplete checklist. They don't BLOCK confirm
  // (the customer may genuinely not know), but they're clearly flagged.
  const unknownKeys = useMemo(
    () => rows.filter(([, v]) => v.value === 'unknown').map(([k]) => k),
    [rows],
  );
  const unknownDefs = unknownKeys
    .map(k => defByKey.get(k))
    .filter((d): d is DebugFactDefinition => !!d);

  return (
    <div className="confirm-facts">
      <div className="confirm-facts-header">
        <strong>Before we finalize, let's review your answers.</strong>
        <div className="confirm-facts-subhead">
          Click any answer to change it — your checklist on the right will update.
        </div>
      </div>

      {newHardBlocks.length > 0 && (
        <div className="confirm-facts-block-banner">
          <strong>Heads up — that change means we can't do all of these today.</strong>
          <ul>
            {newHardBlocks.map(b => (
              <li key={b.txnTypeId}>
                <div><strong>{b.name}</strong> — can't be done today</div>
                <div className="confirm-facts-block-msg">
                  <AcronymText text={b.blockingInfo.customerMessage} />
                </div>
                {b.blockingInfo.nextSteps && (
                  <div className="confirm-facts-block-next">
                    <strong>What to do next:</strong>{' '}
                    <AcronymText text={b.blockingInfo.nextSteps} />
                  </div>
                )}
              </li>
            ))}
          </ul>
          <label className="confirm-facts-block-ack">
            <input
              type="checkbox"
              checked={acknowledgedBlocks}
              onChange={e => setAcknowledgedBlocks(e.target.checked)}
            />
            <span>Got it — I'll take care of that before I come in.</span>
          </label>
        </div>
      )}

      {unresolvedDefs.length > 0 && (
        <div className="confirm-facts-banner">
          <strong>Just one more thing to answer:</strong>
          <ul>
            {unresolvedDefs.map(d => (
              <li key={d.factKey}><AcronymText text={d.questionText} /></li>
            ))}
          </ul>
          <div className="confirm-facts-banner-sub">Pick an answer below to keep going.</div>
        </div>
      )}

      {unknownDefs.length > 0 && (
        <div className="confirm-facts-banner confirm-facts-banner--unsure">
          <strong>You answered "Not sure" to {unknownDefs.length === 1 ? 'this' : 'these'} — a definite answer helps us get your checklist exactly right:</strong>
          <ul>
            {unknownDefs.map(d => (
              <li key={d.factKey}><AcronymText text={d.questionText} /></li>
            ))}
          </ul>
          <div className="confirm-facts-banner-sub">
            Update {unknownDefs.length === 1 ? 'it' : 'them'} below if you can. If you're still unsure, that's okay — bring related documents just in case, and the office will confirm in person.
          </div>
        </div>
      )}

      <table className="confirm-facts-table">
        <tbody>
          {rows.map(([key, val]) => {
            const def = defByKey.get(key);
            const label = def?.questionText ?? def?.label ?? key;
            const editable = val.source !== 'inference';
            const isSaving = savingKey === key;
            const optionLabel = (v: string): string =>
              def?.valueLabels?.[v] ?? (v === 'unknown' ? 'Not sure' : humanize(v));
            const conf = confidenceLabel(val.confidence);
            const rowClass = newlyUnresolved.includes(key)
              ? 'needs-answer'
              : val.value === 'unknown'
                ? 'answered-unsure'
                : '';
            return (
              <tr key={key} className={rowClass}>
                <td className="confirm-facts-q"><AcronymText text={label} /></td>
                <td className="confirm-facts-a">
                  {editable && def ? (
                    <select
                      value={val.value}
                      disabled={isSaving}
                      onChange={e => handleEdit(key, e.target.value)}
                    >
                      {def.allowedValues.map(v => (
                        <option key={v} value={v}>{optionLabel(v)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="confirm-facts-value">{optionLabel(val.value)}</span>
                  )}
                  <span
                    className={`confirm-facts-badge confirm-facts-badge--${val.confidence}`}
                    title={conf.long}
                  >
                    {conf.short}
                  </span>
                </td>
              </tr>
            );
          })}
          {/* Unresolved rows that don't yet have a fact */}
          {newlyUnresolved
            .filter(k => !facts[k])
            .map(k => {
              const def = defByKey.get(k);
              if (!def) return null;
              const optionLabel = (v: string): string =>
                def.valueLabels?.[v] ?? (v === 'unknown' ? 'Not sure' : humanize(v));
              return (
                <tr key={k} className="needs-answer">
                  <td className="confirm-facts-q"><AcronymText text={def.questionText} /></td>
                  <td className="confirm-facts-a">
                    <select
                      defaultValue=""
                      disabled={savingKey === k}
                      onChange={e => e.target.value && handleEdit(k, e.target.value)}
                    >
                      <option value="" disabled>— Select —</option>
                      {def.allowedValues.map(v => (
                        <option key={v} value={v}>{optionLabel(v)}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
        </tbody>
      </table>

      {/* Email opt-in is gated on VITE_SES_ENABLED. SES isn't provisioned for
          beta — testers download the transcript PDF instead. */}
      {import.meta.env.VITE_SES_ENABLED === '1' && (
        <div className="confirm-facts-email">
          <label>
            <input
              type="checkbox"
              checked={emailChecked}
              onChange={e => setEmailChecked(e.target.checked)}
            />
            <span>
              Send me a copy of my responses{' '}
              <span className="confirm-facts-email-trust">(we won't add you to mailing lists)</span>
            </span>
          </label>
          {emailChecked && (
            <input
              type="email"
              className="confirm-facts-email-input"
              placeholder="you@example.com"
              value={emailAddress}
              onChange={e => setEmailAddress(e.target.value)}
            />
          )}
        </div>
      )}

      {error && <div className="confirm-facts-error">{error}</div>}

      <button
        className="confirm-facts-submit"
        onClick={handleConfirm}
        disabled={
          submitting ||
          unresolvedDefs.length > 0 ||
          (newHardBlocks.length > 0 && !acknowledgedBlocks)
        }
      >
        {submitting ? 'Confirming…' : 'Confirm and continue'}
      </button>
    </div>
  );
}
