/**
 * Unit tests for the /authid-result flow helpers (services/chatbot/src/authid/
 * result-flow.ts). These cover the handler's BRANCHING + session mutations
 * with plain objects and injected functions — no live AuthID, no DynamoDB, no
 * Bedrock, no physical document.
 *
 * The point: prove the chatbot handles ANY AuthID poll/result outcome
 * non-blockingly — pending re-polls, transport failure persists + holds at the
 * gate, reject holds without writing identity, pass/review writes identity —
 * and that NO failure/pending outcome advances state (so Skip + retry stay
 * reachable).
 *
 * Run:
 *   npx tsx tests/unit/authid-result.test.ts
 */

import { test, assert, assertEqual, run } from './assert.js';
import {
  pollProofStatus,
  classifyProof,
  applyProofOutcomeToSession,
  applyAuthIdFailureToSession,
  type PollDeps,
} from '../../services/chatbot/src/authid/result-flow.js';
import type { ProofResultRaw } from '../../services/chatbot/src/authid/types.js';
import type { Session } from '../../packages/shared-types/src/session.js';

// --- fixtures --------------------------------------------------------------

/** A no-op sleep so the poll loop runs instantly under test. */
const noSleep = () => Promise.resolve();

/** Build PollDeps whose getOperationStatus returns the given Status sequence. */
function statusDeps(sequence: number[], maxAttempts = 4): { deps: PollDeps; calls: () => number; sleeps: () => number } {
  let i = 0;
  let statusCalls = 0;
  let sleepCalls = 0;
  const deps: PollDeps = {
    getOperationStatus: async () => {
      statusCalls += 1;
      const Status = sequence[Math.min(i, sequence.length - 1)];
      i += 1;
      return { Status };
    },
    sleep: async () => {
      sleepCalls += 1;
      await noSleep();
    },
    maxAttempts,
    intervalMs: 2000,
  };
  return { deps, calls: () => statusCalls, sleeps: () => sleepCalls };
}

function proofResult(overrides?: Partial<ProofResultRaw['Payload']['Data']>): ProofResultRaw {
  return {
    Name: 'GetForeignIDDocument',
    OperationId: 'op-1',
    Payload: {
      Data: {
        VerificationSteps: {},
        Document: {
          Description: 'Document Image',
          Type: '2',
          CapMethod: 2,
          RawData: [],
          Data: [
            { Key: 'FullName', Value: 'JANE SAMPLE' },
            { Key: 'DateOfBirth', Value: '1990-04-15' },
            { Key: 'Address', Value: '123 MAIN ST' },
            { Key: 'DateOfExpiry', Value: '2099-12-31' },
          ],
        },
        Matched: true,
        MatchProbabilty: 0.999,
        MatchScore: 7,
        LivenessDetectionResult: { IsLive: true },
        BarcodeSecurity: 'PASS',
        padResult: 'PASS',
        documentInjectionAttackDetectionResult: 'PASS',
        selfieInjectionAttackDetectionResult: 'PASS',
        ...overrides,
      },
    },
  };
}

function baseSession(): Session {
  return {
    tenantId: 'stlucie',
    sessionId: 's-1',
    currentState: 'verify-identity',
    structuredContext: {
      transactions: [],
      documents: [],
      preScreening: { answers: {}, completedTxnTypes: [] },
      facts: {},
    },
    stateConversationTurns: [],
    incompletePreWork: false,
    channel: 'web',
    authIdOperationId: 'op-1',
    pendingAuthIdProof: { embedUrl: 'https://id-uat.authid.ai/?i=op-1&s=x', operationId: 'op-1', mode: 'proof' },
    createdAt: '2026-07-29T00:00:00Z',
    updatedAt: '2026-07-29T00:00:00Z',
  };
}

// --- pollProofStatus -------------------------------------------------------

test('pollProofStatus: Status 1 → ready (as soon as it appears)', async () => {
  const { deps, calls, sleeps } = statusDeps([0, 0, 1]);
  const r = await pollProofStatus('op-1', deps);
  assertEqual(r, { outcome: 'ready' });
  assertEqual(calls(), 3, 'polled until Status 1');
  assertEqual(sleeps(), 2, 'slept between the first three attempts only');
});

test('pollProofStatus: Status 3 → failed{status:3}', async () => {
  const { deps } = statusDeps([3]);
  const r = await pollProofStatus('op-1', deps);
  assertEqual(r, { outcome: 'failed', status: 3 });
});

test('pollProofStatus: Status 2 → failed{status:2}', async () => {
  const { deps } = statusDeps([2]);
  const r = await pollProofStatus('op-1', deps);
  assertEqual(r, { outcome: 'failed', status: 2 });
});

test('pollProofStatus: never terminal within budget → pending (NOT an error)', async () => {
  const { deps, calls, sleeps } = statusDeps([0], 4);
  const r = await pollProofStatus('op-1', deps);
  assertEqual(r, { outcome: 'pending' });
  assertEqual(calls(), 4, 'exactly maxAttempts status checks');
  assertEqual(sleeps(), 3, 'sleeps only BETWEEN attempts — never after the last');
});

// --- classifyProof ---------------------------------------------------------

test('classifyProof: reject holds the session', () => {
  const c = classifyProof(proofResult({ Matched: false }));
  assertEqual(c.decision.outcome, 'reject');
  assertEqual(c.holdsSession, true);
});

test('classifyProof: pass does not hold the session', () => {
  const c = classifyProof(proofResult());
  assertEqual(c.decision.outcome, 'pass');
  assertEqual(c.holdsSession, false);
  assertEqual(c.extracted.fullName, 'JANE SAMPLE');
});

test('classifyProof: review does not hold the session', () => {
  const c = classifyProof(proofResult({ padResult: 'FAIL' }));
  assertEqual(c.decision.outcome, 'review');
  assertEqual(c.holdsSession, false);
});

// --- applyProofOutcomeToSession --------------------------------------------

test('applyProofOutcomeToSession: reject holds — no identity, in-flight cleared, state unchanged', () => {
  const session = baseSession();
  const c = classifyProof(proofResult({ Matched: false }));
  applyProofOutcomeToSession(session, c, { matchedAt: '2026-07-29T12:00:00Z' });

  assertEqual(session.currentState, 'verify-identity');
  assertEqual(session.structuredContext.identity, undefined);
  assertEqual(session.authIdOperationId, undefined);
  assertEqual(session.pendingAuthIdProof, undefined);
  assertEqual(session.authIdProofResult?.decision, 'reject');
  assert((session.authIdProofResult?.failureReasons.length ?? 0) > 0, 'reject records reasons');
});

test('applyProofOutcomeToSession: pass writes identity + summary + clears in-flight', () => {
  const session = baseSession();
  const c = classifyProof(proofResult());
  applyProofOutcomeToSession(session, c, { matchedAt: '2026-07-29T12:00:00Z' });

  assertEqual(session.structuredContext.identity, {
    name: 'JANE SAMPLE',
    dob: '1990-04-15',
    address: '123 MAIN ST',
    confirmed: true,
  });
  assertEqual(session.authIdProofResult?.decision, 'pass');
  assertEqual(session.authIdOperationId, undefined);
  assertEqual(session.pendingAuthIdProof, undefined);
  // Helper must NOT advance state — the route owns advanceState.
  assertEqual(session.currentState, 'verify-identity');
});

test('applyProofOutcomeToSession: review writes identity like pass', () => {
  const session = baseSession();
  const c = classifyProof(proofResult({ padResult: 'FAIL' }));
  applyProofOutcomeToSession(session, c, { matchedAt: '2026-07-29T12:00:00Z' });
  assertEqual(session.structuredContext.identity?.confirmed, true);
  assertEqual(session.authIdProofResult?.decision, 'review');
});

// --- applyAuthIdFailureToSession -------------------------------------------

test('applyAuthIdFailureToSession: persists failed summary, clears in-flight, holds at gate', () => {
  const session = baseSession();
  applyAuthIdFailureToSession(session, { status: 3, matchedAt: '2026-07-29T12:00:00Z' });

  assertEqual(session.authIdProofResult?.decision, 'failed');
  assertEqual(session.authIdProofResult?.failureReasons, ['authid-status-3']);
  assertEqual(session.authIdOperationId, undefined);
  assertEqual(session.pendingAuthIdProof, undefined);
  // Non-blocking invariant: still at the gate, no identity written.
  assertEqual(session.currentState, 'verify-identity');
  assertEqual(session.structuredContext.identity, undefined);
});

void run();
