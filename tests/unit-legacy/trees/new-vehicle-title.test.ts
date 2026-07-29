import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-new-title', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'new-vehicle-title', name: 'New Vehicle Title', durationMinutes: 20, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('new-vehicle-title minor-no-co-purchaser is blocked', async () => {
  const s = mkSession({
    new_vehicle_purchase_source: mkFact('franchise-dealer'),
    has_fl_insurance: mkFact('yes'),
    has_odometer_disclosure: mkFact('yes-on-title'),
    vehicle_model_year_range: mkFact('2011-or-newer'),
    has_lien_or_lease: mkFact('none'),
    owners_joined: mkFact('single-owner'),
    purchaser_age_status: mkFact('minor-no-co-purchaser'),
    initial_reg_exemption_path: mkFact('none'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.includes('BLOCKED') && n.note.includes('Minor')), 'minor-no-co-purchaser blocks');
});

test('new-vehicle-title private-out-of-state adds bill of sale + VIN verification', async () => {
  const s = mkSession({
    new_vehicle_purchase_source: mkFact('private-out-of-state'),
    has_fl_insurance: mkFact('yes'),
    has_odometer_disclosure: mkFact('yes-bill-of-sale'),
    vehicle_model_year_range: mkFact('2011-or-newer'),
    has_lien_or_lease: mkFact('none'),
    owners_joined: mkFact('single-owner'),
    purchaser_age_status: mkFact('adult-18-plus'),
    initial_reg_exemption_path: mkFact('none'),
    // Required facts; passenger-car + manufactured fire no extra branch, so the
    // bill-of-sale / VIN-verification assertions below are unaffected.
    vehicle_class: mkFact('passenger-car'),
    vehicle_construction_type: mkFact('manufactured'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const all = [...buckets.bringIns.map(i => i.itemId), ...buckets.optionalUploads.map(i => i.itemId), ...buckets.forms.map(i => i.itemId)];
  assert(all.includes('bill-of-sale-purchase-agreement'), 'OOS private purchase requires bill of sale (now optional_upload)');
  assert(all.includes('vin-verification-completed'), 'OOS private purchase requires VIN verification');
});

run();
