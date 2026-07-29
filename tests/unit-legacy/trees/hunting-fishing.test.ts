import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-hf', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'hunting-fishing', name: 'Hunting & Fishing License', durationMinutes: 10, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('hunting-fishing senior 65+ resident is fee-exempt', async () => {
  const s = mkSession({
    fwc_license_category: mkFact('saltwater-fishing'),
    fwc_applicant_residency: mkFact('resident'),
    fwc_age_bracket: mkFact('65-plus'),
    fwc_license_duration: mkFact('annual'),
    fwc_is_military_eligible: mkFact('no'),
    fwc_exemption_claim: mkFact('senior-65-plus'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const ids = (json.buckets as { bringIns: Array<{ itemId: string }> }).bringIns.map(i => i.itemId);
  assert(!ids.includes('fwc-license-fee'), 'senior 65+ should be fee-exempt');
  assert(ids.includes('fl-driver-license-to-renew'), 'senior exempt requires FL DL/ID');
});

test('hunting-fishing resident active-duty military gets Gold Sportsman', async () => {
  const s = mkSession({
    fwc_license_category: mkFact('combo'),
    fwc_applicant_residency: mkFact('resident'),
    fwc_age_bracket: mkFact('16-to-64'),
    fwc_license_duration: mkFact('annual'),
    fwc_is_military_eligible: mkFact('yes'),
    fwc_exemption_claim: mkFact('none'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const all = [...buckets.bringIns.map(i => i.itemId), ...buckets.optionalUploads.map(i => i.itemId), ...buckets.forms.map(i => i.itemId)];
  assert(all.includes('military-gold-sportsman-application'), 'military resident gets Gold Sportsman (now optional_upload)');
});

run();
