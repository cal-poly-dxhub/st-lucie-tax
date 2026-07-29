import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-placard', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'handicap-placard', name: 'Handicap Placard', durationMinutes: 10, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

/**
 * Build a fully-populated placard fact set with sensible defaults; tests
 * override only the facts they care about. Without all 15 facts, the
 * resolve_decision_trees gate returns {status:'blocked', missing:[...]}
 * and bucket assertions fail with a TypeError on `.buckets.forms`.
 */
function defaultFacts(): Record<string, FactValue> {
  return {
    placard_scenario: mkFact('original'),
    placard_applicant_type: mkFact('individual-florida-id'),
    placard_physician_cert_age_months: mkFact('less-than-12'),
    placard_duration: mkFact('permanent'),
    placard_qualifying_condition: mkFact('cant-walk-200ft'),
    placard_certifier_type: mkFact('md-do'),
    placard_replacement_reason: mkFact('na-not-replacement'),
    placard_has_police_report: mkFact('na-not-stolen'),
    placard_special_exception_needed: mkFact('no'),
    placard_visitor_has_isa: mkFact('na-not-visitor'),
    placard_prior_temporary_within_12mo: mkFact('na-not-temporary'),
    placard_additional_permit_type: mkFact('none'),
    placard_org_id_type: mkFact('na-not-organization'),
    placard_minor_or_guardian_signing: mkFact('disabled-person-signs'),
    placard_country_of_origin_for_visitor: mkFact('na-not-visitor'),
  };
}

test('handicap-placard expired physician cert is blocked', async () => {
  const s = mkSession({ ...defaultFacts(), placard_physician_cert_age_months: mkFact('more-than-12') });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.startsWith('BLOCKED')), 'expired cert blocks');
  // The transaction itself should flip to blocked status.
  assert(s.structuredContext.transactions[0].status === 'blocked', 'transaction is now blocked');
});

test('handicap-placard original permanent FL — Florida DL/ID + HSMV 83039, no fee', async () => {
  const s = mkSession(defaultFacts());
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(bringInIds.includes('florida-dl-or-id'), 'permanent FL requires Florida DL/ID');
  assert(allIds.includes('hsmv-83039'), 'permanent FL requires HSMV 83039 (now optional_upload)');
  assert(!bringInIds.some(id => id.startsWith('payment-')), 'permanent FL placard has no fee');
});

test('handicap-placard original temporary FL — adds $15 payment', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_duration: mkFact('temporary'),
    placard_prior_temporary_within_12mo: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  assert(ids.includes('payment-15-original-temporary'), 'first temporary in 12mo requires $15');
  assert(ids.includes('florida-dl-or-id'), 'still requires Florida DL/ID');
});

test('handicap-placard second temporary within 12mo — fee waived', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_duration: mkFact('temporary'),
    placard_prior_temporary_within_12mo: mkFact('yes'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  assert(!ids.some(id => id.startsWith('payment-')), 'second temp within 12mo has no fee');
});

test('handicap-placard visitor with ISA placard — terminal, no items', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_applicant_type: mkFact('individual-out-of-state'),
    placard_visitor_has_isa: mkFact('yes'),
    placard_country_of_origin_for_visitor: mkFact('us-state'),
    placard_org_id_type: mkFact('na-not-organization'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  assert(buckets.bringIns.length === 0, 'visitor with ISA needs nothing to bring');
  assert(buckets.forms.length === 0, 'visitor with ISA needs no forms');
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.includes('international wheelchair symbol')), 'note explains ISA recognition');
});

test('handicap-placard visitor without ISA — visitor temporary $15', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_applicant_type: mkFact('individual-out-of-state'),
    placard_visitor_has_isa: mkFact('no'),
    placard_country_of_origin_for_visitor: mkFact('us-state'),
    placard_org_id_type: mkFact('na-not-organization'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(bringInIds.includes('payment-15-visitor-temporary'), 'visitor temp is $15');
  assert(bringInIds.includes('visitor-acceptable-photo-id'), 'visitor uses broader ID list');
  assert(allIds.includes('hsmv-83039'), 'visitor still needs HSMV 83039 (now optional_upload)');
  assert(!bringInIds.includes('florida-dl-or-id'), 'visitor does NOT need Florida DL/ID');
});

test('handicap-placard out-of-country visitor — home-country permit copy substitutes', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_applicant_type: mkFact('individual-out-of-country'),
    placard_country_of_origin_for_visitor: mkFact('foreign-country'),
    placard_org_id_type: mkFact('na-not-organization'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('home-country-permit-copy'), 'foreign visitor uses home-country permit (now optional_upload)');
  assert(!allIds.includes('hsmv-83039'), 'foreign visitor with home permit copy does NOT need HSMV 83039');
});

test('handicap-placard organization — FEID-or-FL-sales-tax, no Sunbiz', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_applicant_type: mkFact('organization'),
    placard_org_id_type: mkFact('feid'),
    placard_visitor_has_isa: mkFact('na-not-visitor'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('org-feid-or-fl-sales-tax'), 'organization needs FEID or FL sales-tax # (now optional_upload)');
  assert(!allIds.includes('business-entity-proof'), 'Sunbiz-based business-entity-proof is NOT used for placard');
});

test('handicap-placard special exception — no FL DL/ID required', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_special_exception_needed: mkFact('yes'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(!bringInIds.includes('florida-dl-or-id'), 'special exception waives Florida DL/ID');
  assert(allIds.includes('hsmv-83039'), 'still requires HSMV 83039 with Special Exception line signed (now optional_upload)');
});

test('handicap-placard optometrist signing non-sight condition is blocked', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_certifier_type: mkFact('optometrist-sight-only'),
    placard_qualifying_condition: mkFact('cant-walk-200ft'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.includes('optometrist')), 'optometrist scope-of-practice block fires');
  assert(s.structuredContext.transactions[0].status === 'blocked', 'transaction blocked');
});

test('handicap-placard optometrist signing legal blindness is OK', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_certifier_type: mkFact('optometrist-sight-only'),
    placard_qualifying_condition: mkFact('legally-blind'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('hsmv-83039'), 'optometrist + legal blindness flows normally (now optional_upload)');
  assert(s.structuredContext.transactions[0].status === 'active', 'transaction is NOT blocked');
});

test('handicap-placard out-of-state physician without statement is blocked', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_certifier_type: mkFact('out-of-state-md'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.includes('out-of-state physician')), 'out-of-state-md block fires');
  assert(s.structuredContext.transactions[0].status === 'blocked', 'transaction blocked');
});

test('handicap-placard replacement stolen WITH police report — fee waived', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_scenario: mkFact('replacement'),
    placard_replacement_reason: mkFact('stolen'),
    placard_has_police_report: mkFact('yes'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  const formIds = buckets.forms.map(i => i.itemId);
  assert(formIds.includes('hsmv-83146'), 'replacement uses HSMV 83146');
  assert(bringInIds.includes('police-report-stolen-placard'), 'police report required when invoked');
  assert(!bringInIds.includes('payment-1-replacement'), 'fee waived with police report');
});

test('handicap-placard replacement stolen WITHOUT police report — $1 fee', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_scenario: mkFact('replacement'),
    placard_replacement_reason: mkFact('stolen'),
    placard_has_police_report: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  assert(buckets.forms.some(i => i.itemId === 'hsmv-83146'), 'replacement uses HSMV 83146');
  assert(ids.includes('payment-1-replacement'), '$1 fee applies without police report');
  assert(!ids.includes('police-report-stolen-placard'), 'no police report item when reportless');
});

test('handicap-placard replacement lost-in-transit < 180d — fee waived', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_scenario: mkFact('replacement'),
    placard_replacement_reason: mkFact('lost-in-transit'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }> };
  const ids = buckets.bringIns.map(i => i.itemId);
  assert(!ids.includes('payment-1-replacement'), 'lost-in-transit waiver: no fee');
});

test('handicap-placard renewal individual — adds expiring registration copy', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_scenario: mkFact('renewal'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('expiring-placard-registration-copy'), 'renewal needs expiring registration copy (now optional_upload)');
  assert(allIds.includes('hsmv-83039'), 'renewal needs fresh HSMV 83039 (now optional_upload)');
});

test('handicap-placard renewal with VA letter — substitutes for HSMV 83039', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_scenario: mkFact('renewal'),
    placard_certifier_type: mkFact('va-letter-27-333'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('va-form-letter-27-333'), 'VA letter is the medical-cert substitute (now optional_upload)');
  assert(!allIds.includes('hsmv-83039'), 'HSMV 83039 not required when VA letter is used');
});

test('handicap-placard frequent-traveler additional permit (permanent only)', async () => {
  const s = mkSession({
    ...defaultFacts(),
    placard_additional_permit_type: mkFact('frequent-traveler'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const branchNotes = (json.branchNotes as Array<{ note: string }>) ?? [];
  assert(branchNotes.some(n => n.note.includes('Frequent-traveler')), 'frequent-traveler note fires');
});

run();
