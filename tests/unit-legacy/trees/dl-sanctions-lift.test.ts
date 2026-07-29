import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-sanctions', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'dl-sanctions-lift', name: 'DL Reinstatement', durationMinutes: 20, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('unpaid citation with no court clearance is blocked', async () => {
  const s = mkSession({
    sanction_type: mkFact('traffic-citation-unpaid'),
    sanction_status: mkFact('current-suspension'),
    has_cleared_underlying_issue: mkFact('no-still-owed'),
    has_completed_required_course: mkFact('na-not-required'),
    has_sr22_insurance: mkFact('na-not-required'),
    has_dui_iid_requirement: mkFact('no-not-dui'),
    wants_hardship_license: mkFact('na-not-eligible'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.startsWith('BLOCKED') && n.note.includes('unpaid traffic')), 'unpaid citation with no clearance blocks');
});

test('unpaid citation cleared — just pay reinstatement fee', async () => {
  const s = mkSession({
    sanction_type: mkFact('traffic-citation-unpaid'),
    sanction_status: mkFact('expired-but-not-reinstated'),
    has_cleared_underlying_issue: mkFact('yes'),
    has_completed_required_course: mkFact('na-not-required'),
    has_sr22_insurance: mkFact('na-not-required'),
    has_dui_iid_requirement: mkFact('no-not-dui'),
    wants_hardship_license: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  assert(json.status === 'ok', 'resolve must succeed');
  const ids = (json.buckets as { bringIns: Array<{ itemId: string }> }).bringIns.map(i => i.itemId);
  assert(ids.includes('reinstatement-fee'), 'reinstatement fee required');
});

test('child-support suspension is blocked AND not eligible for hardship', async () => {
  const s = mkSession({
    sanction_type: mkFact('child-support'),
    sanction_status: mkFact('current-suspension'),
    has_cleared_underlying_issue: mkFact('no-still-owed'),
    has_completed_required_course: mkFact('na-not-required'),
    has_sr22_insurance: mkFact('na-not-required'),
    has_dui_iid_requirement: mkFact('no-not-dui'),
    wants_hardship_license: mkFact('na-not-eligible'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.startsWith('BLOCKED') && /child[-\s]support/i.test(n.note)), 'child-support blocks');
  assert(branchNotes.some(n => n.note.includes('not eligible for a hardship')), 'child-support not eligible for hardship');
});

test('DUI hardship path adds Licensed DUI Program + ADI + hardship application', async () => {
  const s = mkSession({
    sanction_type: mkFact('dui'),
    sanction_status: mkFact('current-revocation'),
    has_cleared_underlying_issue: mkFact('yes'),
    has_completed_required_course: mkFact('yes-licensed-dui-program'),
    has_sr22_insurance: mkFact('na-not-required'),
    has_dui_iid_requirement: mkFact('yes-iid-active'),
    wants_hardship_license: mkFact('yes'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const all = [...buckets.bringIns.map(i => i.itemId), ...buckets.optionalUploads.map(i => i.itemId), ...buckets.forms.map(i => i.itemId)];
  assert(all.includes('licensed-dui-program-completion'), 'DUI hardship needs DUI program completion (now optional_upload)');
  assert(all.includes('adi-course-completion'), 'DUI hardship needs ADI completion (now optional_upload)');
  assert(all.includes('hardship-license-application'), 'hardship app required');
  assert(all.includes('iid-installation-proof'), 'IID required (now optional_upload)');
});

test('habitual-traffic-offender expired revocation needs ADI + fee', async () => {
  const s = mkSession({
    sanction_type: mkFact('habitual-traffic-offender'),
    sanction_status: mkFact('expired-but-not-reinstated'),
    has_cleared_underlying_issue: mkFact('yes'),
    has_completed_required_course: mkFact('yes-adi-or-traffic-school'),
    has_sr22_insurance: mkFact('na-not-required'),
    has_dui_iid_requirement: mkFact('no-not-dui'),
    wants_hardship_license: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('adi-course-completion'), 'HTO needs ADI (now optional_upload)');
  assert(ids.includes('reinstatement-fee'), 'reinstatement fee always');
});

test('financial-responsibility without SR-22 adds SR-22 requirement', async () => {
  const s = mkSession({
    sanction_type: mkFact('financial-responsibility'),
    sanction_status: mkFact('current-suspension'),
    has_cleared_underlying_issue: mkFact('yes'),
    has_completed_required_course: mkFact('na-not-required'),
    has_sr22_insurance: mkFact('no'),
    has_dui_iid_requirement: mkFact('no-not-dui'),
    wants_hardship_license: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const ids = (json.buckets as { bringIns: Array<{ itemId: string }> }).bringIns.map(i => i.itemId);
  assert(ids.includes('sr22-filing-from-insurer'), 'FR without SR-22 needs SR-22');
});

run();
