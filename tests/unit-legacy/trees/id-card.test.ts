/**
 * Unit test for id-card decision tree.
 */

import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, assertEqual, run } from '../assert.js';

function mkFact(value: string): FactValue {
  return { value, confidence: 'asserted', source: 'user-message', updatedAt: '2026-04-23T00:00:00Z' };
}

function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie',
    sessionId: 'test-id-card',
    currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'id-card', name: 'Florida ID Card', durationMinutes: 10, status: 'active' }],
      documents: [],
      preScreening: { answers: {}, completedTxnTypes: [] },
      facts,
    },
    stateConversationTurns: [],
    incompletePreWork: false,
    channel: 'web',
    createdAt: '2026-04-23T00:00:00Z',
    updatedAt: '2026-04-23T00:00:00Z',
  };
}

function parseResult(content: { text?: string }[]): Record<string, unknown> {
  return JSON.parse(content[0].text ?? '{}');
}

test('id-card original-first-time happy path produces full REAL ID doc set', async () => {
  const session = mkSession({
    id_card_intent: mkFact('original-first-time'),
    real_id_status: mkFact('not-compliant'),
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
    is_veteran_designation_request: mkFact('no'),
    is_100_percent_disabled_veteran: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok');
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(ids.includes('primary-id-passport'), 'first-time ID needs primary ID');
  assert(ids.includes('social-security-card'), 'first-time ID needs SSN');
  assert(allIds.includes('address-proof-1') && allIds.includes('address-proof-2'), 'two address proofs (now optional_upload)');
});

test('id-card downgrade-from-dl adds the current FL driver license for surrender', async () => {
  const session = mkSession({
    id_card_intent: mkFact('downgrade-from-dl'),
    real_id_status: mkFact('compliant'),
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
    is_veteran_designation_request: mkFact('no'),
    is_100_percent_disabled_veteran: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  const ids = (json.buckets as { bringIns: Array<{ itemId: string }> }).bringIns.map(i => i.itemId);
  assert(ids.includes('fl-driver-license-to-renew'), 'downgrade should require the current DL for surrender');
});

run();
