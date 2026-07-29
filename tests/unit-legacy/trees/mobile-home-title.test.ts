import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-mh-title', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'mobile-home-title', name: 'Mobile Home Title', durationMinutes: 20, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('mobile-home-title OOS dealer adds MCO + bill of sale', async () => {
  const s = mkSession({
    mobile_home_purchase_source: mkFact('oos-dealer'),
    vehicle_origin: mkFact('us-state'),
    has_lien_or_lease: mkFact('none'),
    owns_land_under_mobile_home: mkFact('no'),
    transferring_existing_decal: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(ids.includes('mco-or-signed-title'), 'OOS dealer needs MCO');
  assert(allIds.includes('bill-of-sale-purchase-agreement'), 'OOS dealer needs bill of sale (now optional_upload)');
});

test('mobile-home-title owns land adds DR-402 + RP decal note', async () => {
  const s = mkSession({
    mobile_home_purchase_source: mkFact('fl-dealer'),
    vehicle_origin: mkFact('within-florida'),
    has_lien_or_lease: mkFact('none'),
    owns_land_under_mobile_home: mkFact('yes'),
    transferring_existing_decal: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const all = [...buckets.bringIns.map(i => i.itemId), ...buckets.forms.map(i => i.itemId)];
  assert(all.includes('dr-402-real-property-declaration'), 'owning land requires DR-402');
  assert(all.includes('rp-decal-note'), 'RP decal note added');
});

run();
