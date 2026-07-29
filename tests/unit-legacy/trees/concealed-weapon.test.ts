import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-ccw', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'concealed-weapon', name: 'Concealed Weapon Permit', durationMinutes: 30, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('concealed-weapon happy path (21+ US citizen, has training) resolves with the training doc + fee', async () => {
  const s = mkSession({
    ccw_intent: mkFact('new-application'),
    ccw_applicant_age_bracket: mkFact('21-plus'),
    is_us_citizen: mkFact('us-citizen'),
    ccw_has_training_document: mkFact('yes'),
    recent_name_change: mkFact('no'),
    ccw_has_disqualifying_history: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('ccw-firearms-training-document'), 'needs training doc (now optional_upload)');
  assert(ids.includes('ccw-application-fee'), 'needs fee');
});

test('concealed-weapon under-18 is BLOCKED', async () => {
  const s = mkSession({
    ccw_intent: mkFact('new-application'),
    ccw_applicant_age_bracket: mkFact('under-18'),
    is_us_citizen: mkFact('us-citizen'),
    ccw_has_training_document: mkFact('yes'),
    recent_name_change: mkFact('no'),
    ccw_has_disqualifying_history: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.startsWith('BLOCKED')), 'under-18 must block');
});

test('concealed-weapon renewal path removes training-doc requirement', async () => {
  const s = mkSession({
    ccw_intent: mkFact('renewal'),
    ccw_applicant_age_bracket: mkFact('21-plus'),
    is_us_citizen: mkFact('us-citizen'),
    ccw_has_training_document: mkFact('yes'),
    recent_name_change: mkFact('no'),
    ccw_has_disqualifying_history: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(!allIds.includes('ccw-firearms-training-document'), 'renewal removes training doc');
  assert(allIds.includes('existing-ccw-license'), 'renewal requires existing license (now optional_upload)');
});

run();
