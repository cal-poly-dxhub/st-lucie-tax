import type { Session, FactValue } from '@st-lucie/shared-types';
import { handleResolveFactsTool } from '../../../services/chatbot/src/tools/resolve-facts/tools.js';
import { test, assert, run } from '../assert.js';

function mkFact(v: string): FactValue { return { value: v, confidence: 'asserted', source: 'user-message', updatedAt: '' }; }
function mkSession(facts: Record<string, FactValue>): Session {
  return {
    tenantId: 'stlucie', sessionId: 'test-dup', currentState: 'resolve-facts',
    structuredContext: {
      transactions: [{ txnTypeId: 'duplicate-title', name: 'Duplicate Title', durationMinutes: 10, status: 'active' }],
      documents: [], preScreening: { answers: {}, completedTxnTypes: [] }, facts,
    },
    stateConversationTurns: [], incompletePreWork: false, channel: 'web', createdAt: '', updatedAt: '',
  };
}

test('duplicate-title online path eligible with no lien', async () => {
  const s = mkSession({
    duplicate_title_channel: mkFact('online-mydmv'),
    title_holding_status: mkFact('electronic-held'),
    has_lien_or_lease: mkFact('none'),
    owners_joined: mkFact('single-owner'),
    signing_via_poa: mkFact('no-owner-present'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const all = [...buckets.bringIns.map(i => i.itemId), ...buckets.forms.map(i => i.itemId)];
  assert(all.includes('mydmv-portal-referral'), 'online path should produce MyDMV referral');
  assert(!all.includes('hsmv-82101'), 'online path should not need 82101 form');
});

test('duplicate-title with active lien adds lien-letter', async () => {
  const s = mkSession({
    duplicate_title_channel: mkFact('in-office'),
    title_holding_status: mkFact('electronic-held'),
    has_lien_or_lease: mkFact('lien-active'),
    owners_joined: mkFact('single-owner'),
    signing_via_poa: mkFact('no-owner-present'),
  });
  const r = await handleResolveFactsTool('resolve_decision_trees', {}, s);
  const json = JSON.parse((r.content as any)[0].text);
  const buckets = json.buckets as { bringIns: Array<{ itemId: string }>; optionalUploads: Array<{ itemId: string }>; forms: Array<{ itemId: string }> };
  const allIds = [...buckets.bringIns, ...buckets.optionalUploads, ...buckets.forms].map(i => i.itemId);
  assert(allIds.includes('lien-letter'), 'active lien requires lien-letter (now optional_upload)');
});

run();
