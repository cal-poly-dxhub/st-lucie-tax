/**
 * Visit summary side panel.
 *
 * Shows the customer's selected services, current step in the flow, estimated
 * total time, and — ONLY after the decision tree has fully resolved — the
 * final "what to bring" checklist.
 *
 * Why the checklist is gated: until resolve-facts finishes traversing the
 * decision tree, the document requirements are still in flux. Showing an
 * intermediate list would confuse the customer (items appear, then disappear
 * as branches resolve differently than expected).
 *
 * The panel reveals the final list when `session.state` has advanced past
 * `resolve-facts` — i.e. the tree is done mutating.
 */

import type { SessionData } from '../hooks/useSession';
import type { BucketItem, TransactionSummary } from '../api';

interface Props {
  session: SessionData;
  onReset: () => void;
}

const STATE_FLOW = [
  { key: 'landing', label: 'Welcome' },
  { key: 'identify-transaction', label: 'Identify service' },
  { key: 'universal-blockers', label: 'Eligibility check' },
  { key: 'resolve-facts', label: 'Answer questions' },
  { key: 'verify-identity', label: 'Verify identity' },
  { key: 'confirm-facts', label: 'Review answers' },
  { key: 'upload-docs', label: 'Upload docs' },
  { key: 'checkout-check', label: 'Checkout' },
  { key: 'schedule', label: 'Next steps' },
] as const;

const CHECKLIST_READY_STATES = new Set<string>([
  'confirm-facts',
  'upload-docs',
  'checkout-check',
  'schedule',
  'confirm',
]);

export function SidePanel({ session, onReset }: Props) {
  // Prefer the structuredContext transactions (they include status +
  // blockingInfo set by the decision-tree fail-fast and universal-blockers
  // paths). Fall back to the lightweight identifiedTransactions array while
  // context hasn't landed yet (very first few turns).
  const contextTxns = session.context?.transactions ?? [];
  const transactions: TransactionSummary[] = contextTxns.length > 0
    ? contextTxns
    : session.transactions.map(t => ({ ...t, status: 'active' }));
  const hasTransactions = transactions.length > 0;
  const checklistReady = CHECKLIST_READY_STATES.has(session.state);
  const blockedTransactions = transactions.filter(
    t => t.status === 'blocked' && t.blockingInfo,
  );
  const activeTransactions = transactions.filter(t => t.status === 'active');
  const allBlocked = hasTransactions && activeTransactions.length === 0;

  const stepIdx = Math.max(
    STATE_FLOW.findIndex(s => s.key === session.state),
    0,
  );

  return (
    <div className="side-panel">
      <div className="side-panel-header">
        <h2>Your visit</h2>
        {hasTransactions && (
          <button className="side-panel-reset" onClick={onReset} title="Start over">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
            <span>Reset</span>
          </button>
        )}
      </div>

      {/* Step tracker */}
      <div className="step-tracker" aria-label="Visit progress">
        {STATE_FLOW.map((step, i) => {
          const isCurrent = i === stepIdx;
          const isComplete = i < stepIdx;
          return (
            <div
              key={step.key}
              className={`step-tracker-item ${isCurrent ? 'is-current' : ''} ${isComplete ? 'is-complete' : ''}`}
            >
              <div className="step-tracker-dot" aria-hidden>
                {isComplete ? <CheckIcon /> : <span className="step-tracker-num">{i + 1}</span>}
              </div>
              <div className="step-tracker-label">{step.label}</div>
            </div>
          );
        })}
      </div>

      {/* Selected services */}
      <section className="panel-section">
        <h3>Services</h3>
        {!hasTransactions && (
          <p className="empty-state">
            Tell me what you need and I'll find the right services for you.
          </p>
        )}
        {transactions.map(txn => {
          const isBlocked = txn.status === 'blocked';
          return (
            <div
              key={txn.txnTypeId}
              className={`transaction-card ${isBlocked ? 'transaction-card--blocked' : ''}`}
            >
              <div className="transaction-card-name">
                {txn.name}
                {isBlocked && <span className="transaction-card-badge">BLOCKED</span>}
              </div>
              {!isBlocked && (
                <div className="transaction-card-meta">~{txn.durationMinutes} min</div>
              )}
              {isBlocked && txn.blockingInfo && (
                <div className="transaction-card-block-note">
                  <div>{txn.blockingInfo.customerMessage}</div>
                  {txn.blockingInfo.nextSteps && (
                    <div className="transaction-card-block-next">
                      <strong>Next:</strong> {txn.blockingInfo.nextSteps}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {activeTransactions.length > 0 && (
          <div className="transaction-total">
            <span>Total time</span>
            <strong>
              {activeTransactions.reduce((sum, t) => sum + t.durationMinutes, 0)} min
            </strong>
          </div>
        )}
      </section>

      {/* Hard-block summary — shown any time at least one transaction is blocked. */}
      {blockedTransactions.length > 0 && (
        <section className="panel-section panel-section--blocked">
          <h3>Cannot be served today</h3>
          <p className="panel-section-subhead">
            {allBlocked
              ? 'None of the selected services can be processed right now. Please resolve these issues before visiting.'
              : 'These services need action before we can help you. The remaining services (below) can still proceed.'}
          </p>
          <ul className="blocked-list">
            {blockedTransactions.map(txn => (
              <li key={txn.txnTypeId}>
                <strong>{txn.name}</strong>
                {txn.blockingInfo?.nextSteps && (
                  <div className="blocked-next">{txn.blockingInfo.nextSteps}</div>
                )}
                {txn.blockingInfo?.sourceRefs && txn.blockingInfo.sourceRefs.length > 0 && (
                  <div className="blocked-links">
                    {txn.blockingInfo.sourceRefs.map(url => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="form-link">
                        Official info ↗
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Three-bucket checklist — gated until the decision tree has resolved.
          Hidden entirely if every selected transaction is blocked. */}
      {!allBlocked && checklistReady && session.context?.resolvedBuckets && (
        <BucketSections buckets={session.context.resolvedBuckets} />
      )}

      {/* Pre-checklist nudge */}
      {!allBlocked && hasTransactions && !checklistReady && (
        <section className="panel-section panel-section--pending">
          <h3>What to bring</h3>
          <p className="empty-state">
            We'll show you the exact list once we've gathered all the details for your visit.
          </p>
        </section>
      )}

      {/* Appointment confirmation. The scheduling service returns a short
          text confirmation code (not an image), surfaced as appointmentId. */}
      {session.context?.scheduling?.appointmentId && (
        <section className="panel-section">
          <h3>Your appointment</h3>
          {session.context.scheduling.selectedSlot && (
            <div className="appt-details">
              <div className="appt-where">
                {session.context.scheduling.selectedSlot.locationName || 'St. Lucie Tax Collector'}
              </div>
              <div className="appt-when">
                {new Date(`${session.context.scheduling.selectedSlot.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
                {' at '}
                {session.context.scheduling.selectedSlot.startTime?.slice(0, 5)}
              </div>
            </div>
          )}
          <div className="appt-confirmation">Confirmation #{session.context.scheduling.appointmentId}</div>
          <p className="qr-note">Show this confirmation number at check-in.</p>
        </section>
      )}
    </div>
  );
}

function BucketSections({ buckets }: { buckets: NonNullable<SessionData['context']>['resolvedBuckets'] }) {
  if (!buckets) return null;
  const { bringIns, optionalUploads, forms } = buckets;
  if (bringIns.length + optionalUploads.length + forms.length === 0) return null;

  return (
    <>
      {bringIns.length > 0 && (
        <section className="panel-section">
          <h3>Bring to your appointment</h3>
          <ul className="bring-list">
            {bringIns.map(item => (
              <li key={item.itemId}>
                <CheckCircleIcon />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {optionalUploads.length > 0 && (
        <section className="panel-section">
          <h3>Upload before your visit</h3>
          <ul className="bring-list">
            {optionalUploads.map(item => (
              <li key={item.itemId}>
                <UploadIcon />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {forms.length > 0 && (
        <section className="panel-section">
          <h3>Forms to complete before you come</h3>
          <ul className="bring-list">
            {forms.map(item => (
              <li key={item.itemId}>
                <FormIcon />
                <FormLabel item={item} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function FormLabel({ item }: { item: BucketItem }) {
  if (item.source) {
    return (
      <a href={item.source} target="_blank" rel="noopener noreferrer" className="form-link">
        {item.label}
      </a>
    );
  }
  return <span>{item.label}</span>;
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

function FormIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="15" y2="17" />
    </svg>
  );
}
