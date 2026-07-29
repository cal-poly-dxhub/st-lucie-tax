/**
 * Unit tests for resolve_decision_trees + list_unresolved_facts.
 *
 * Uses the real pilot trees (dl-transfer, vehicle-title-transfer, cdl) loaded
 * from JSON. Does not touch DynamoDB.
 *
 * Run:
 *   npx tsx tests/unit/resolve-decision-trees.test.ts
 */

import type { Session, FactValue } from '@st-lucie/shared-types';
import {
  handleResolveFactsTool,
} from '../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, assertEqual, run } from './assert.js';

function mkFact(value: string): FactValue {
  return {
    value,
    confidence: 'asserted',
    source: 'user-message',
    updatedAt: '2026-04-21T00:00:00Z',
  };
}

function mkSession(
  txnTypeId: string,
  facts: Record<string, FactValue>,
): Session {
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
    createdAt: '2026-04-21T00:00:00Z',
    updatedAt: '2026-04-21T00:00:00Z',
  };
}

function parseResult(content: { text?: string }[]): Record<string, unknown> {
  return JSON.parse(content[0].text ?? '{}');
}

// ----- list_unresolved_facts -----

test('list_unresolved_facts flags every required fact when none are known', async () => {
  const session = mkSession('dl-transfer', {});
  const r = await handleResolveFactsTool('list_unresolved_facts', {}, session);
  const json = parseResult(r.content as { text?: string }[]);

  assertEqual(json.status, 'ok');
  assert(Number(json.unresolvedCount) >= 10, 'dl-transfer requires ~11 facts');
  const unresolved = json.unresolved as Array<{ factKey: string }>;
  const keys = unresolved.map(u => u.factKey);
  assert(keys.includes('is_us_citizen'), 'must flag is_us_citizen');
  assert(keys.includes('has_primary_id'), 'must flag has_primary_id');
});

test('list_unresolved_facts treats confidence=unknown as unresolved', async () => {
  const session = mkSession('dl-transfer', {
    is_us_citizen: {
      value: 'us-citizen',
      confidence: 'unknown',
      source: 'user-message',
      updatedAt: '2026-04-21T00:00:00Z',
    },
  });
  const r = await handleResolveFactsTool('list_unresolved_facts', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  const keys = (json.unresolved as Array<{ factKey: string }>).map(u => u.factKey);
  assert(keys.includes('is_us_citizen'), 'unknown-confidence fact must still be flagged');
});

// ----- resolve_decision_trees -----

test('resolve_decision_trees blocks when facts are missing', async () => {
  const session = mkSession('dl-transfer', {});
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'blocked');
  assertEqual(json.reason, 'missing-facts');
  assert(!r.shouldAdvance, 'blocked result must not advance state');
});

test('dl-transfer with citizen + passport + 2 address proofs produces bring-in bucket', async () => {
  const session = mkSession('dl-transfer', {
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
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok', `expected ok, got ${JSON.stringify(json)}`);
  assert(r.shouldAdvance === true, 'resolved result must advance state');

  const buckets = json.buckets as {
    bringIns: Array<{ itemId: string }>;
    optionalUploads: Array<{ itemId: string }>;
    forms: Array<{ itemId: string }>;
  };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  const optionalUploadIds = buckets.optionalUploads.map(i => i.itemId);
  assert(bringInIds.includes('primary-id-passport'), 'citizen path keeps passport');
  assert(bringInIds.includes('social-security-card'), 'SSN card is a bring-in');
  // Address proofs were flipped bring_in -> optional_upload per the TCSLC
  // 2026-07 upload-review results (residents may submit them ahead of time).
  assert(optionalUploadIds.includes('address-proof-1'), 'address proof 1 is now an optional upload');
  assert(optionalUploadIds.includes('address-proof-2'), 'address proof 2 is now an optional upload');
  assert(!bringInIds.includes('lawful-presence-green-card'), 'citizens do not need green card');
});

test('dl-transfer with permanent-resident swaps passport for green card', async () => {
  const session = mkSession('dl-transfer', {
    is_us_citizen: mkFact('permanent-resident'),
    has_primary_id: mkFact('passport'), // ignored because permanent-resident branch removes passport
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    needs_real_id_upgrade: mkFact('yes'),
    recent_name_change: mkFact('no'),
    is_new_fl_resident: mkFact('yes'),
    oos_license_status: mkFact('valid-in-hand'),
    came_from_type: mkFact('us-state'),
    lawful_presence_docs: mkFact('green-card'),
    wears_corrective_lenses: mkFact('no'),
    is_military_active_duty: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok');
  const bucketsObj = json.buckets as { bringIns: Array<{ itemId: string }> };
  const ids = bucketsObj.bringIns.map(i => i.itemId);
  assert(!ids.includes('primary-id-passport'), 'passport must be removed for permanent-resident');
  assert(ids.includes('lawful-presence-green-card'), 'green card added');
});

test('dl-transfer with zero address proofs swaps to Declaration of Domicile', async () => {
  const session = mkSession('dl-transfer', {
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('zero'),
    needs_real_id_upgrade: mkFact('yes'),
    recent_name_change: mkFact('no'),
    is_new_fl_resident: mkFact('yes'),
    oos_license_status: mkFact('valid-in-hand'),
    came_from_type: mkFact('us-state'),
    lawful_presence_docs: mkFact('na-us-citizen'),
    wears_corrective_lenses: mkFact('no'),
    is_military_active_duty: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  const bucketsObj = json.buckets as {
    bringIns: Array<{ itemId: string }>;
    forms: Array<{ itemId: string }>;
  };
  const bringIds = bucketsObj.bringIns.map(i => i.itemId);
  const formIds = bucketsObj.forms.map(i => i.itemId);
  assert(
    !bringIds.includes('address-proof-1') && !bringIds.includes('address-proof-2'),
    'address proofs removed when count is zero',
  );
  assert(
    bringIds.includes('declaration-of-domicile') || formIds.includes('declaration-of-domicile'),
    'Declaration of Domicile added',
  );
});

test('cdl with >=1yr expiration adds knowledge + skills exams', async () => {
  const session = mkSession('cdl', {
    cdl_origin: mkFact('fl-renewal'),
    cdl_expiration_range: mkFact('expired-more-than-1yr'),
    oos_cdl_valid: mkFact('na-not-oos-transfer'),
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    medical_cert_required: mkFact('yes'),
    medical_cert_in_system: mkFact('yes'),
    has_hazmat_endorsement_request: mkFact('no'),
    has_tsa_fee: mkFact('na-no-hazmat'),
    general_knowledge_exam_passed: mkFact('never-taken'),
    general_knowledge_exam_age: mkFact('never-taken'),
    skills_exam_passed: mkFact('never-taken'),
    clp_age_weeks: mkFact('na-no-clp'),
    is_school_employee: mkFact('no'),
    can_communicate_in_english: mkFact('yes'),
    wears_corrective_lenses: mkFact('no'),
    applicant_age_meets_cdl: mkFact('yes'),
    // Required by the CDL tree (veteran fee-waiver branch). 'no' adds no items,
    // so the knowledge/skills-exam assertions below are unaffected — this just
    // satisfies the required-facts gate so resolution returns ok instead of
    // blocking on a missing fact.
    is_100_percent_disabled_veteran: mkFact('no'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok', `expected ok, got ${JSON.stringify(json)}`);
  const buckets = json.buckets as {
    bringIns: Array<{ itemId: string }>;
    optionalUploads: Array<{ itemId: string }>;
    forms: Array<{ itemId: string }>;
  };
  const allIds = [
    ...buckets.bringIns.map(i => i.itemId),
    ...buckets.optionalUploads.map(i => i.itemId),
    ...buckets.forms.map(i => i.itemId),
  ];
  assert(allIds.includes('cdl-general-knowledge-exam'), 'renewal >=1yr must re-test knowledge');
  assert(allIds.includes('cdl-skills-exam'), 'renewal >=1yr must re-test skills');
});

test('resolve_decision_trees persists resolvedBuckets on session.structuredContext', async () => {
  const session = mkSession('dl-transfer', {
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
  });
  await handleResolveFactsTool('resolve_decision_trees', {}, session);

  const persisted = session.structuredContext.resolvedBuckets;
  assert(!!persisted, 'resolvedBuckets must be written to structuredContext');
  assert(persisted!.bringIns.length > 0, 'bringIns bucket should be populated');
  assert(
    persisted!.bringIns.every(i => i.bucket === 'bring_in'),
    'every bringIn item must have bucket=bring_in',
  );
  assert(
    persisted!.forms.every(i => i.bucket === 'form'),
    'every form item must have bucket=form',
  );
});

run();
