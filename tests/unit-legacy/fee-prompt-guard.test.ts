import { ok } from 'node:assert';
import { buildSystemPrompt } from '../../services/chatbot/src/prompts/prompt-loader.js';
import { DEFAULT_PROMPTS } from '../../services/chatbot/src/prompts/default-prompts.js';
import type { Session } from '@st-lucie/shared-types';

function mkSession(state: string): Session {
  return {
    tenantId: 'stlucie',
    sessionId: 'test-fee-prompt',
    currentState: state as Session['currentState'],
    structuredContext: {
      transactions: [],
      documents: [],
      preScreening: { answers: {}, completedTxnTypes: [] },
      facts: {},
    },
    stateConversationTurns: [],
    incompletePreWork: false,
    channel: 'web',
    createdAt: '',
    updatedAt: '',
  } as Session;
}

// The fee rule is GLOBAL — injected via the prompt-loader formatting block, so
// it must appear in every state's built prompt, not just one.
for (const state of ['identify-transaction', 'resolve-facts']) {
  const prompt = await buildSystemPrompt(mkSession(state));
  ok(prompt.includes('FEES & DOLLAR AMOUNTS'), `${state}: fee rule header present`);
  ok(prompt.includes('772-462-1650'), `${state}: directs to the office line when no fee data`);
  ok(
    /NEVER add, subtract, sum, or compute a total/i.test(prompt),
    `${state}: the no-sum clause is present`,
  );
  ok(
    /OVERRIDES this section/i.test(prompt),
    `${state}: the state-local-ban override clause is present`,
  );
}

// Non-contradiction: the checkout/schedule state still hard-bans reciting fees,
// and the global override clause defers to it (so the two coexist without
// softening the ban).
ok(
  DEFAULT_PROMPTS['checkout-check'].includes('Do NOT recite fees'),
  'checkout-check state retains its explicit fee ban',
);

console.log('OK');
