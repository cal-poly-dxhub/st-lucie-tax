/**
 * SmartQuickReplies — context-aware quick-reply chips under the chat input.
 *
 * Shows one of three modes depending on the current session state:
 *   - "canned" hot buttons (landing / initial identify-transaction)
 *   - state-appropriate one-tap replies (verify-identity, upload-docs, schedule)
 *   - resolve-facts: next unresolved fact's allowedValues as clickable chips
 *     with human-friendly labels so the customer never has to type enum
 *     strings like "fl-renewal" themselves.
 *
 * The chips are visual UX only — the text they submit is plain English; the
 * LLM reads the message and calls record_facts with the enum value.
 */

import { useEffect, useState } from 'react';
import type { HotButton, FactValue, AllTransaction } from '../api';
import { fetchDebugTrees, fetchAllTransactions, type DebugTree, type DebugFactDefinition } from '../api';
import type { SessionData } from '../hooks/useSession';
import { humanize } from '../utils/humanize';

interface Props {
  session: SessionData;
  /**
   * Legacy prop — kept for callsite compatibility. The landing-state UI
   * now uses a hardcoded 6-family menu plus a "View all transactions"
   * toggle that fetches /chatbot/all-transactions; the DDB-seeded hot
   * buttons are no longer rendered. Callers can pass [] safely.
   */
  hotButtons?: HotButton[];
  onSelect: (text: string) => void;
  disabled: boolean;
}

/**
 * Family-level entry buttons. Click sends a natural-language opener — the
 * bot's suggest_transactions tool then narrows down to the specific txn.
 * Two-tier flow: families first (low-friction), full 31-txn menu via the
 * blue "View all transactions" chip below for testers who already know
 * exactly what they want.
 */
const FAMILY_BUTTONS: Array<{ label: string; opener: string; description: string }> = [
  { label: 'Driver License & ID', opener: 'I have a question about my driver license or ID card', description: 'Renewals, replacements, REAL ID, name/address changes, learner permits, road tests' },
  { label: 'Vehicles & Plates', opener: 'I have a question about a vehicle, title, or license plate', description: 'Title transfers, registration, tag replacement, plate surrender, specialty plates' },
  { label: 'Taxes & Property', opener: 'I have a question about my property taxes', description: 'Property tax payments, tangible personal property, installment plans' },
  { label: 'Business', opener: 'I have a question about my business', description: 'Business tax receipts, short-term rental tax (Airbnb/VRBO)' },
  { label: 'Outdoors & Other', opener: 'I have a question about hunting, fishing, boats, or concealed weapons', description: 'Hunting/fishing licenses, vessel registration, concealed weapons, handicap placards' },
  { label: 'Lost or Replace', opener: 'I lost something or need to replace a credential', description: 'Lost license, lost title, stolen tag, replacement decals' },
];

export function SmartQuickReplies({ session, onSelect, disabled }: Props) {
  const state = session.state;
  const txnIds = session.transactions.map(t => t.txnTypeId);
  const facts: Record<string, FactValue> = session.context?.facts ?? {};

  // Toggle: false = show 6 family chips; true = show full 31-txn menu.
  // Reset whenever the session leaves the landing-state empty bucket.
  const [showAllTxns, setShowAllTxns] = useState(false);
  const [allTxns, setAllTxns] = useState<AllTransaction[] | null>(null);
  const [allTxnsLoading, setAllTxnsLoading] = useState(false);
  useEffect(() => {
    if (!showAllTxns || allTxns !== null) return;
    setAllTxnsLoading(true);
    fetchAllTransactions()
      .then(setAllTxns)
      .catch(() => setAllTxns([]))
      .finally(() => setAllTxnsLoading(false));
  }, [showAllTxns, allTxns]);

  // Tree + fact-definition cache, loaded whenever active transactions change.
  const [trees, setTrees] = useState<DebugTree[]>([]);
  const [defs, setDefs] = useState<DebugFactDefinition[]>([]);
  const txnKey = txnIds.slice().sort().join(',');
  useEffect(() => {
    if (!txnKey) {
      setTrees([]);
      setDefs([]);
      return;
    }
    let cancelled = false;
    fetchDebugTrees(txnKey.split(','))
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
  }, [txnKey]);

  // -------- mode selection --------

  // 1. Landing / empty identify-transaction: tiered family menu.
  // Default view shows the 6 high-level families. The "View all
  // transactions" chip swaps to the full 31-txn list (one chip per
  // active transaction). Hot-button DDB seeds are intentionally ignored
  // here — the family curation is a frontend UX decision and we want
  // a consistent flow regardless of which seeds happen to be in DDB.
  if (
    (state === 'landing' || state === 'identify-transaction') &&
    session.transactions.length === 0
  ) {
    if (showAllTxns) {
      // Full 31-txn menu, grouped by category. Loading state covered while
      // the GET /chatbot/all-transactions call is in flight.
      if (allTxnsLoading || allTxns === null) {
        return (
          <ChipRow label="All transactions">
            <span className="smart-chips-loading">Loading…</span>
          </ChipRow>
        );
      }
      // Group by category, preserving first-seen order from server response.
      const groupOrder: string[] = [];
      const groups = new Map<string, AllTransaction[]>();
      for (const txn of allTxns) {
        const cat = txn.category ?? 'Other';
        if (!groups.has(cat)) {
          groupOrder.push(cat);
          groups.set(cat, []);
        }
        groups.get(cat)!.push(txn);
      }
      return (
        <div className="smart-chips smart-chips--hot-buttons">
          <ChipRow label="">
            <button
              type="button"
              className="smart-chip smart-chip--secondary"
              onClick={() => setShowAllTxns(false)}
              disabled={disabled}
            >
              ← Back to common services
            </button>
          </ChipRow>
          {groupOrder.map(cat => (
            <ChipGroup key={cat} label={cat}>
              {groups.get(cat)!.map(txn => (
                <Chip
                  key={txn.txnTypeId}
                  onClick={() => onSelect(txn.opener)}
                  disabled={disabled}
                  title={txn.summary}
                >
                  {txn.name}
                </Chip>
              ))}
            </ChipGroup>
          ))}
        </div>
      );
    }

    // Default: 6 family chips + the View-all toggle.
    return (
      <div className="smart-chips smart-chips--hot-buttons">
        <ChipRow label="What can we help you with?">
          {FAMILY_BUTTONS.map(fam => (
            <Chip
              key={fam.label}
              onClick={() => onSelect(fam.opener)}
              disabled={disabled}
              title={fam.description}
            >
              {fam.label}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="">
          <button
            type="button"
            className="smart-chip smart-chip--accent"
            onClick={() => setShowAllTxns(true)}
            disabled={disabled}
          >
            View all transactions →
          </button>
        </ChipRow>
      </div>
    );
  }

  // 2. Identify-transaction after at least one service named (but maybe not confirmed)
  if (state === 'identify-transaction' && session.transactions.length > 0) {
    return (
      <ChipRow label="Continue">
        <Chip onClick={() => onSelect("Yes, that's right. Let's continue.")} disabled={disabled}>
          Yes — continue
        </Chip>
        <Chip onClick={() => onSelect('I need to add another service too.')} disabled={disabled}>
          Add another service
        </Chip>
        <Chip onClick={() => onSelect("Actually, that's not what I need.")} disabled={disabled}>
          Pick a different service
        </Chip>
      </ChipRow>
    );
  }

  // 3. resolve-facts: next unresolved fact's allowed values as chips.
  if (state === 'resolve-facts' && trees.length > 0) {
    const nextFact = findNextUnresolvedFact(trees, defs, facts);
    if (nextFact) {
      const { def } = nextFact;
      // Prefer authored valueLabels (which the LLM also receives in its
      // prompt and is instructed to use verbatim). Fall back to humanize()
      // for facts that don't yet have valueLabels.
      const labelFor = (v: string): string =>
        def.valueLabels?.[v] ?? (v === 'unknown' ? 'Not sure' : humanize(v));
      const chips = def.allowedValues
        .filter(v => v !== 'unknown')
        .map(v => ({ value: v, label: labelFor(v) }));
      return (
        <ChipRow label={def.label}>
          {chips.map(c => (
            <Chip
              key={c.value}
              onClick={() => onSelect(c.label)}
              disabled={disabled}
              title={`Record "${c.value}" for ${def.factKey}`}
            >
              {c.label}
            </Chip>
          ))}
        </ChipRow>
      );
    }
  }

  // 4. universal-blockers: yes/no chips for the eligibility questions. The
  // LLM asks one question per response. "Not sure" was dropped because the
  // questions ("license suspended?", "have a photo ID?") are concrete enough
  // that an unsure answer doesn't help the workflow — it just stalls.
  if (state === 'universal-blockers') {
    return (
      <ChipRow label="Quick reply">
        <Chip onClick={() => onSelect('Yes')} disabled={disabled}>Yes</Chip>
        <Chip onClick={() => onSelect('No')} disabled={disabled}>No</Chip>
      </ChipRow>
    );
  }

  // 5. upload-docs state
  if (state === 'upload-docs') {
    return (
      <ChipRow label="Quick actions">
        <Chip onClick={() => onSelect('All uploaded — please continue.')} disabled={disabled}>
          Done uploading
        </Chip>
        <Chip onClick={() => onSelect("I'll bring everything to the office.")} disabled={disabled}>
          Skip — bring to office
        </Chip>
      </ChipRow>
    );
  }

  // (pre-screen quick-replies retired 2026-05-05 — state no longer in the web
  // flow; decision-tree BLOCKED branches + universal-blockers cover its cases.)

  // (schedule chips retired 2026-05-05 — the schedule state is a terminal
  // wrap-up and has no tools to act on slot preferences. Offering ASAP /
  // Tomorrow AM / etc. baited customers into a dead-end conversation.)

  // 6. checkout-check
  if (state === 'checkout-check') {
    return (
      <ChipRow label="How would you like to proceed?">
        <Chip onClick={() => onSelect('I want to complete this online')} disabled={disabled}>Complete online</Chip>
        <Chip onClick={() => onSelect('I want to schedule an in-office appointment')} disabled={disabled}>Schedule in office</Chip>
      </ChipRow>
    );
  }

  return null;
}

// ----------------------------------------------------------------------------

interface ChipRowProps {
  label: string;
  children: React.ReactNode;
}

function ChipRow({ label, children }: ChipRowProps) {
  return (
    <div className="smart-chips">
      <div className="smart-chips-label">{label}</div>
      <div className="smart-chips-row">{children}</div>
    </div>
  );
}

interface ChipGroupProps {
  label: string;
  children: React.ReactNode;
}

/** A single category inside a grouped-hot-buttons block. */
function ChipGroup({ label, children }: ChipGroupProps) {
  return (
    <div className="smart-chips-group">
      <div className="smart-chips-label">{label}</div>
      <div className="smart-chips-row">{children}</div>
    </div>
  );
}

interface ChipProps {
  onClick: () => void;
  disabled: boolean;
  children: React.ReactNode;
  title?: string;
}

function Chip({ onClick, disabled, children, title }: ChipProps) {
  return (
    <button
      type="button"
      className="smart-chip"
      onClick={onClick}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  );
}

// ----------------------------------------------------------------------------

/**
 * Find the first unresolved fact across all active transactions, using the
 * same logic as the backend's list_unresolved_facts. A fact is unresolved if
 * it's not in the facts map OR its confidence is "unknown".
 */
function findNextUnresolvedFact(
  trees: DebugTree[],
  defs: DebugFactDefinition[],
  facts: Record<string, FactValue>,
): { def: DebugFactDefinition } | null {
  // Union of all factsRequired across all active trees, preserving first-seen order.
  const requiredKeys: string[] = [];
  const seen = new Set<string>();
  for (const tree of trees) {
    for (const fk of tree.factsRequired) {
      if (!seen.has(fk)) {
        seen.add(fk);
        requiredKeys.push(fk);
      }
    }
  }
  const defByKey = new Map(defs.map(d => [d.factKey, d]));
  for (const fk of requiredKeys) {
    const fv = facts[fk];
    if (fv && fv.confidence !== 'unknown') continue;
    const def = defByKey.get(fk);
    if (def) return { def };
  }
  return null;
}

