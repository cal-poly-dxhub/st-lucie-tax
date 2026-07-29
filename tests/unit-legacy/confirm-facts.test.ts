/**
 * Unit tests for the confirm-facts review flow.
 *
 * Exercises the underlying engine primitives the /edit-facts endpoint uses —
 * record → apply-implications → resolve — to confirm that editing a fact after
 * initial resolution produces the expected new bucket state and surfaces any
 * newly-unresolved fact keys.
 */

// Steer the data-access layer toward a dead endpoint so any DB write fails
// fast — mutation of session.structuredContext.facts happens BEFORE the DB
// call, so assertions work even when persistence fails.
process.env.DYNAMODB_TABLE_NAME = 'st-lucie-unit-test-nonexistent';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.AWS_ENDPOINT_URL_DYNAMODB = 'http://127.0.0.1:1';

import type { Session, FactValue } from '@st-lucie/shared-types';
import {
  handleResolveFactsTool,
  collectRequiredFactKeysForActiveTxns,
} from '../../services/chatbot/src/tools/resolve-facts/tools.js';
import { handleRecordFactsTool } from '../../services/chatbot/src/tools/record-facts/tools.js';
import { buildTranscriptEmail } from '../../services/chatbot/src/email/transcript-template.js';
import { test, assert, run } from './assert.js';

function mkFact(value: string): FactValue {
  return {
    value,
    confidence: 'asserted',
    source: 'user-message',
    updatedAt: '2026-04-29T00:00:00Z',
  };
}

function mkSession(txnTypeId: string, facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie',
    sessionId: 'test-' + Math.random().toString(36).slice(2),
    currentState: 'resolve-facts',
    structuredContext: {
      transactions: [
        { txnTypeId, name: txnTypeId, durationMinutes: 15, status: 'active' },
      ],
      documents: [],
      preScreening: { answers: {}, completedTxnTypes: [] },
      facts,
    },
    stateConversationTurns: [],
    incompletePreWork: false,
    channel: 'web',
    createdAt: '2026-04-29T00:00:00Z',
    updatedAt: '2026-04-29T00:00:00Z',
  };
}

const DL_TRANSFER_HAPPY: Record<string, FactValue> = {
  is_us_citizen: mkFact('us-citizen'),
  has_primary_id: mkFact('passport'),
  has_social_security_card: mkFact('yes'),
  address_proof_count: mkFact('two-or-more'),
  needs_real_id_upgrade: mkFact('yes'),
  recent_name_change: mkFact('no'),
  is_new_fl_resident: mkFact('yes'),
  oos_license_status: mkFact('valid-in-hand'),
  came_from_type: mkFact('us-state'),
  lawful_presence_docs: mkFact('na-us-citizen'),
  wears_corrective_lenses: mkFact('no'),
  is_military_active_duty: mkFact('no'),
};

// Helper that mimics the edit-facts endpoint. updateSession() failures from
// record-facts are swallowed — mutation of session.structuredContext.facts
// happens before the DB write, so assertions still reflect the edit.
async function simulateEdit(
  session: Session,
  edits: Array<{ factKey: string; value: string }>,
): Promise<void> {
  for (const e of edits) delete session.structuredContext.facts[e.factKey];
  try {
    await handleRecordFactsTool(
      'record_facts',
      {
        facts: edits.map(e => ({
          factKey: e.factKey,
          value: e.value,
          confidence: 'asserted',
          source: 'user-message',
        })),
      },
      session,
    );
  } catch { /* ignore DB stub failure */ }
  const edited = new Set(edits.map(e => e.factKey));
  for (const [k, v] of Object.entries(session.structuredContext.facts)) {
    if (v.source === 'inference' && !edited.has(k)) {
      delete session.structuredContext.facts[k];
    }
  }
  try {
    await handleRecordFactsTool('record_facts', { facts: [] }, session);
  } catch { /* ignore */ }
  await handleResolveFactsTool('resolve_decision_trees', {}, session);
}

test('editing address_proof_count from two-or-more to zero swaps bucket contents', async () => {
  const session = mkSession('dl-transfer', { ...DL_TRANSFER_HAPPY });
  await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const before = session.structuredContext.resolvedBuckets!;
  // Address proofs live in optional_upload since the TCSLC 2026-07 upload-review flip.
  const beforeIds = [...before.bringIns, ...before.optionalUploads].map(i => i.itemId);
  assert(beforeIds.includes('address-proof-1'), 'baseline has address-proof-1');
  assert(beforeIds.includes('address-proof-2'), 'baseline has address-proof-2');

  await simulateEdit(session, [{ factKey: 'address_proof_count', value: 'zero' }]);
  const after = session.structuredContext.resolvedBuckets!;
  const afterBringIds = after.bringIns.map(i => i.itemId);
  const afterFormIds = after.forms.map(i => i.itemId);
  // Editing count->zero must remove the proofs from EVERY bucket, not just bring-in.
  const afterAllIds = [...after.bringIns, ...after.optionalUploads, ...after.forms].map(i => i.itemId);
  assert(!afterAllIds.includes('address-proof-1'), 'address-proof-1 removed after edit');
  assert(!afterAllIds.includes('address-proof-2'), 'address-proof-2 removed after edit');
  assert(
    afterBringIds.includes('declaration-of-domicile')
      || afterFormIds.includes('declaration-of-domicile'),
    'declaration-of-domicile added after edit',
  );
});

test('editing is_us_citizen to permanent-resident re-triggers implication cascade', async () => {
  // Start with a citizen scenario where lawful_presence_docs is inferred
  // (not explicitly answered by the user).
  const baseline: Record<string, FactValue> = {
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    needs_real_id_upgrade: mkFact('yes'),
    recent_name_change: mkFact('no'),
    is_new_fl_resident: mkFact('yes'),
    oos_license_status: mkFact('valid-in-hand'),
    came_from_type: mkFact('us-state'),
    wears_corrective_lenses: mkFact('no'),
    is_military_active_duty: mkFact('no'),
  };
  const session = mkSession('dl-transfer', baseline);
  // Seed inferred lawful_presence_docs by re-asserting is_us_citizen through
  // the record-facts path (which runs applyImplications). Failure-tolerant
  // because updateSession hits a dead DDB endpoint in this test.
  try {
    await handleRecordFactsTool(
      'record_facts',
      {
        facts: [{
          factKey: 'is_us_citizen',
          value: 'us-citizen',
          confidence: 'asserted',
          source: 'user-message',
        }],
      },
      session,
    );
  } catch { /* ignore */ }
  await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const lp = session.structuredContext.facts['lawful_presence_docs'];
  assert(
    lp?.value === 'na-us-citizen' && lp.source === 'inference',
    `lawful_presence_docs should be inferred=na-us-citizen, got: ${JSON.stringify(lp)}`,
  );

  await simulateEdit(session, [{ factKey: 'is_us_citizen', value: 'permanent-resident' }]);

  // After wiping inferred facts + re-implying, lawful_presence_docs no longer
  // has an implication rule (only us-citizen → na-us-citizen), so the diff
  // flags it as unresolved.
  const required = collectRequiredFactKeysForActiveTxns(['dl-transfer']);
  const unresolved: string[] = [];
  for (const k of required) {
    const v = session.structuredContext.facts[k];
    if (!v || v.confidence === 'unknown') unresolved.push(k);
  }
  assert(
    unresolved.includes('lawful_presence_docs'),
    `expected lawful_presence_docs to be newly-unresolved after citizenship change, got: ${unresolved.join(',')}`,
  );
});

test('buildTranscriptEmail renders subject + services + facts + buckets + transcript', async () => {
  const session = mkSession('dl-transfer', { ...DL_TRANSFER_HAPPY });
  await handleResolveFactsTool('resolve_decision_trees', {}, session);

  const email = buildTranscriptEmail({
    session,
    transcript: [
      { role: 'user', content: 'I just moved to Florida from Georgia.' },
      { role: 'assistant', content: 'Got it — I can help with the transfer.' },
    ],
  });

  assert(email.subject.includes('St. Lucie'), 'subject names the office');
  assert(email.subject.toLowerCase().includes('dl-transfer'), 'subject names the transaction');
  assert(email.textBody.includes('YOUR ANSWERS'), 'textBody has answers section');
  assert(email.textBody.includes('BRING TO YOUR APPOINTMENT'), 'textBody has bring-in section');
  assert(email.textBody.includes('CONVERSATION TRANSCRIPT'), 'textBody has transcript section');
  assert(email.textBody.includes('I just moved to Florida'), 'transcript includes user turn');
  assert(email.htmlBody.includes('<h2>Your answers</h2>'), 'htmlBody has answers heading');
  assert(email.htmlBody.includes('<h2>Services</h2>'), 'htmlBody has services heading');
});

run();
