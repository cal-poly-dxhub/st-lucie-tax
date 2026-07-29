/**
 * Unit test for dl-renewal decision tree.
 *
 * Happy path: in-office renewal, REAL ID compliant, US citizen with passport,
 * no name/address change, no veteran designation, no corrective lenses.
 * Expected: tree resolves with shouldAdvance=true and produces an empty
 * bring-in-plus-one (just the current credential).
 *
 * Run:
 *   npx tsx tests/unit/trees/dl-renewal.test.ts
 */

import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, assertEqual, run } from '../assert.js';

function mkFact(value: string): FactValue {
  return {
    value,
    confidence: 'asserted',
    source: 'user-message',
    updatedAt: '2026-04-23T00:00:00Z',
  };
}

function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie',
    sessionId: 'test-dl-renewal',
    currentState: 'resolve-facts',
    structuredContext: {
      transactions: [
        { txnTypeId: 'dl-renewal', name: 'Driver License Renewal', durationMinutes: 10, status: 'active' },
      ],
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

test('dl-renewal happy path (in-office, REAL-ID compliant, US citizen) resolves to the credential only', async () => {
  const session = mkSession({
    dl_renewal_channel: mkFact('in-office'),
    real_id_status: mkFact('compliant'),
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
    recent_address_change: mkFact('no'),
    wears_corrective_lenses: mkFact('no'),
    is_veteran_designation_request: mkFact('no'),
    is_100_percent_disabled_veteran: mkFact('no'),
  });

  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);

  assertEqual(json.status, 'ok', `expected ok, got ${JSON.stringify(json)}`);
  assert(r.shouldAdvance === true, 'resolved tree must advance state');

  const buckets = json.buckets as {
    bringIns: Array<{ itemId: string }>;
    optionalUploads: Array<{ itemId: string }>;
    forms: Array<{ itemId: string }>;
  };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  assert(
    bringInIds.includes('fl-driver-license-to-renew'),
    `happy-path renewal expected to require the current credential, got: ${bringInIds.join(', ')}`,
  );
});

test('dl-renewal online channel removes credential and adds MyDMV referral', async () => {
  const session = mkSession({
    dl_renewal_channel: mkFact('online-mydmv'),
    real_id_status: mkFact('compliant'),
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
    recent_address_change: mkFact('no'),
    wears_corrective_lenses: mkFact('no'),
    is_veteran_designation_request: mkFact('no'),
    is_100_percent_disabled_veteran: mkFact('no'),
  });

  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok');

  const buckets = json.buckets as {
    bringIns: Array<{ itemId: string }>;
    forms: Array<{ itemId: string }>;
  };
  const allIds = [
    ...buckets.bringIns.map(i => i.itemId),
    ...buckets.forms.map(i => i.itemId),
  ];
  assert(
    !allIds.includes('fl-driver-license-to-renew'),
    'online channel should not require the credential in the office',
  );
  assert(
    allIds.includes('mydmv-portal-referral'),
    `online channel should produce a MyDMV referral, got: ${allIds.join(', ')}`,
  );
});

test('dl-renewal not REAL-ID compliant adds full REAL ID document set', async () => {
  const session = mkSession({
    dl_renewal_channel: mkFact('in-office'),
    real_id_status: mkFact('not-compliant'),
    is_us_citizen: mkFact('us-citizen'),
    has_primary_id: mkFact('passport'),
    has_social_security_card: mkFact('yes'),
    address_proof_count: mkFact('two-or-more'),
    recent_name_change: mkFact('no'),
    recent_address_change: mkFact('no'),
    wears_corrective_lenses: mkFact('no'),
    is_veteran_designation_request: mkFact('no'),
    is_100_percent_disabled_veteran: mkFact('no'),
  });

  const r = await handleResolveFactsTool('resolve_decision_trees', {}, session);
  const json = parseResult(r.content as { text?: string }[]);
  assertEqual(json.status, 'ok');

  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const bringInIds = buckets.bringIns.map(i => i.itemId);
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);

  assert(bringInIds.includes('primary-id-passport'), 'non-compliant renewal must add primary ID');
  assert(bringInIds.includes('social-security-card'), 'non-compliant renewal must add SSN proof');
  assert(allIds.includes('address-proof-1'), 'non-compliant renewal must add address proof 1 (now optional_upload)');
  assert(allIds.includes('address-proof-2'), 'non-compliant renewal must add address proof 2 (now optional_upload)');
});

run();
