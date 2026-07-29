/**
 * Unit test for real-id-upgrade decision tree.
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
    sessionId: 'test-real-id-upgrade',
    currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'real-id-upgrade', name: 'REAL ID Upgrade', durationMinutes: 15, status: 'active' }],
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

test('real-id-upgrade happy path produces the full REAL ID doc set', async () => {
  const session = mkSession({
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok');
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(ids.includes('primary-id-passport'), 'happy path keeps passport');
  assert(ids.includes('social-security-card'), 'SSN required');
  assert(allIds.includes('address-proof-1') && allIds.includes('address-proof-2'), 'two address proofs required (now optional_upload)');
});

test('real-id-upgrade permanent resident swaps passport for green card', async () => {
  const session = mkSession({
    is_us_citizen: mkFact('permanent-resident'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  const ids = (json.buckets as { bringIns: Array<{ itemId: string }> }).bringIns.map(i => i.itemId);
  assert(!ids.includes('primary-id-passport'), 'passport removed for permanent-resident');
  assert(ids.includes('lawful-presence-green-card'), 'green card added');
});

run();
