import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-spec', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'specialty-plate', name: 'Specialty Plate', durationMinutes: 10, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('specialty-plate voucher gift requires recipient info', async () => {
  const s = mkSession({
    specialty_plate_flow: mkFact('voucher-gift'),
    has_specialty_plate_eligibility_proof: mkFact('na-no-eligibility-required'),
    voucher_recipient: mkFact('gift'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('recipient-plate-or-license-info'), 'gift voucher needs recipient info (now optional_upload)');
});

test('specialty-plate missing eligibility proof is blocked', async () => {
  const s = mkSession({
    specialty_plate_flow: mkFact('new-plate-on-existing-vehicle'),
    has_specialty_plate_eligibility_proof: mkFact('no'),
    voucher_recipient: mkFact('na-not-voucher'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.startsWith('BLOCKED')), 'missing eligibility proof should block');
});

run();
