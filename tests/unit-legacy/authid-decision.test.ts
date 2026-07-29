/**
 * Unit tests for the AuthID Proof decision matrix.
 *
 * Per https://developer.authid.ai/docs/the-onboarding-inspecting-results,
 * AuthID does not auto-decide outcomes. Each row of the documented matrix
 * is one test below.
 *
 * Run:
 *   npx tsx tests/unit/authid-decision.test.ts
 */

import { test, assert, assertEqual, run } from './assert.js';
import { decide, extractIdentity } from '../../services/chatbot/src/authid/decision.js';
import type { ProofResultRaw } from '../../services/chatbot/src/authid/types.js';

function baseResult(): ProofResultRaw {
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
            { Key: 'DocumentNumber', Value: 'D1234567' },
            { Key: 'DateOfExpiry', Value: '2099-12-31' },
            { Key: 'Address', Value: '123 MAIN ST' },
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
      },
    },
  };
}

test('all-pass result yields outcome=pass with no reasons', () => {
  const r = decide(baseResult());
  assertEqual(r.outcome, 'pass');
  assertEqual(r.reasons, []);
});

test('Matched=false rejects with selfie-document-mismatch', () => {
  const r = baseResult();
  r.Payload.Data.Matched = false;
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('selfie-document-mismatch'), 'should flag mismatch');
});

test('liveness IsLive=false rejects', () => {
  const r = baseResult();
  r.Payload.Data.LivenessDetectionResult.IsLive = false;
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('liveness-failed'), 'should flag liveness');
});

test('selfieInjectionAttack=FAIL rejects', () => {
  const r = baseResult();
  r.Payload.Data.selfieInjectionAttackDetectionResult = 'FAIL';
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('selfie-injection-attack'), 'should flag injection');
});

test('BarcodeSecurity=FAIL rejects', () => {
  const r = baseResult();
  r.Payload.Data.BarcodeSecurity = 'FAIL';
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('barcode-tampered'), 'should flag barcode tamper');
});

test('expired DateOfExpiry rejects', () => {
  const r = baseResult();
  r.Payload.Data.Document.Data = r.Payload.Data.Document.Data.map((kv) =>
    kv.Key === 'DateOfExpiry' ? { Key: 'DateOfExpiry', Value: '2020-01-01' } : kv,
  );
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('document-expired'), 'should flag expiry');
});

test('mismatchMrzOcr=true triggers review', () => {
  const r = baseResult();
  r.Payload.Data.mismatchMrzOcr = true;
  const d = decide(r);
  assertEqual(d.outcome, 'review');
  assert(d.reasons.includes('mrz-ocr-mismatch'), 'should flag MRZ mismatch');
});

test('padResult=FAIL triggers review', () => {
  const r = baseResult();
  r.Payload.Data.padResult = 'FAIL';
  const d = decide(r);
  assertEqual(d.outcome, 'review');
  assert(d.reasons.includes('document-replay-detected'), 'should flag replay');
});

test('documentInjectionAttack=FAIL triggers review', () => {
  const r = baseResult();
  r.Payload.Data.documentInjectionAttackDetectionResult = 'FAIL';
  const d = decide(r);
  assertEqual(d.outcome, 'review');
  assert(d.reasons.includes('document-injection-attack'), 'should flag doc-injection');
});

test('multiple failures: any reject wins over any review', () => {
  const r = baseResult();
  r.Payload.Data.Matched = false;
  r.Payload.Data.padResult = 'FAIL';
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('selfie-document-mismatch'), 'reject reason present');
  assert(d.reasons.includes('document-replay-detected'), 'review reason still present');
});

test('extractIdentity reads documented Key/Value pairs', () => {
  const id = extractIdentity(baseResult());
  assertEqual(id.fullName, 'JANE SAMPLE');
  assertEqual(id.dateOfBirth, '1990-04-15');
  assertEqual(id.address, '123 MAIN ST');
});

test('extractIdentity returns undefined for missing keys, does not throw', () => {
  const sparse = baseResult();
  sparse.Payload.Data.Document.Data = [{ Key: 'FullName', Value: 'JANE' }];
  const id = extractIdentity(sparse);
  assertEqual(id.fullName, 'JANE');
  assertEqual(id.dateOfBirth, undefined);
});

// ---------------------------------------------------------------------------
// FAIL-CLOSED HARDENING — "handle ANYTHING AuthID returns, intentionally."
// The rows above assert the documented FAIL signals. The rows below assert the
// adversarial cases a bad actor actually uses: OMITTED signals, MALFORMED
// payloads, key-case DRIFT, and UNRECOGNIZED values. All of these silently
// PASSed (or threw a 500) before the hardening. `data` is cast to a mutable
// record so a test can delete an optional field or inject a drifted key.
// ---------------------------------------------------------------------------

/** Mutable view of the signal bag, for deleting/renaming fields in a test. */
function sig(r: ProofResultRaw): Record<string, unknown> {
  return r.Payload.Data as unknown as Record<string, unknown>;
}

test('empty signal bag (only Matched+IsLive) fails closed — was a silent pass', () => {
  const r = baseResult();
  const s = sig(r);
  delete s.selfieInjectionAttackDetectionResult;
  delete s.BarcodeSecurity;
  delete s.padResult;
  delete s.documentInjectionAttackDetectionResult;
  r.Payload.Data.Document.Data = r.Payload.Data.Document.Data.filter((kv) => kv.Key !== 'DateOfExpiry');
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('selfie-injection-signal-missing'), 'selfie-injection missing flagged');
  assert(d.reasons.includes('barcode-signal-missing'), 'barcode missing flagged');
  assert(d.reasons.includes('pad-signal-missing'), 'pad missing flagged');
  assert(d.reasons.includes('document-injection-signal-missing'), 'doc-injection missing flagged');
  assert(d.reasons.includes('expiry-missing'), 'expiry missing flagged');
});

test('LivenessDetectionResult undefined does NOT throw and rejects', () => {
  const r = baseResult();
  delete sig(r).LivenessDetectionResult;
  let d: ReturnType<typeof decide> | undefined;
  try {
    d = decide(r);
  } catch (err) {
    assert(false, `decide threw on missing liveness: ${(err as Error).message}`);
  }
  assertEqual(d!.outcome, 'reject');
  assert(d!.reasons.includes('liveness-signal-missing'), 'liveness missing flagged');
});

test('LivenessDetectionResult present but IsLive missing → reject', () => {
  const r = baseResult();
  (sig(r).LivenessDetectionResult as Record<string, unknown>) = {};
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('liveness-signal-missing'), 'liveness missing flagged');
});

test('Matched undefined fails closed (does not pass as if true)', () => {
  const r = baseResult();
  delete sig(r).Matched;
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('match-signal-missing'), 'match missing flagged');
});

test('missing Document does NOT throw in decide() and rejects on expiry', () => {
  const r = baseResult();
  delete sig(r).Document;
  let d: ReturnType<typeof decide> | undefined;
  try {
    d = decide(r);
  } catch (err) {
    assert(false, `decide threw on missing Document: ${(err as Error).message}`);
  }
  assertEqual(d!.outcome, 'reject');
  assert(d!.reasons.includes('expiry-missing'), 'expiry missing flagged');
});

test('extractIdentity does NOT throw when Document is missing', () => {
  const r = baseResult();
  delete sig(r).Document;
  let id: ReturnType<typeof extractIdentity> | undefined;
  try {
    id = extractIdentity(r);
  } catch (err) {
    assert(false, `extractIdentity threw: ${(err as Error).message}`);
  }
  assertEqual(id!.fullName, undefined);
});

test('malformed payload (no Payload.Data) → reject, no throw', () => {
  const cases: unknown[] = [{}, { Payload: {} }, { Payload: { Data: null } }, null, undefined];
  for (const c of cases) {
    let d: ReturnType<typeof decide> | undefined;
    try {
      d = decide(c as ProofResultRaw);
    } catch (err) {
      assert(false, `decide threw on malformed input ${JSON.stringify(c)}: ${(err as Error).message}`);
    }
    assertEqual(d!.outcome, 'reject');
    assertEqual(d!.reasons, ['malformed-result-payload']);
  }
});

test('DateOfExpiry entry missing → reject expiry-missing', () => {
  const r = baseResult();
  r.Payload.Data.Document.Data = r.Payload.Data.Document.Data.filter((kv) => kv.Key !== 'DateOfExpiry');
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('expiry-missing'), 'expiry missing flagged');
});

test('DateOfExpiry unparseable → reject expiry-unparseable', () => {
  const r = baseResult();
  r.Payload.Data.Document.Data = r.Payload.Data.Document.Data.map((kv) =>
    kv.Key === 'DateOfExpiry' ? { Key: 'DateOfExpiry', Value: 'not-a-date' } : kv,
  );
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('expiry-unparseable'), 'expiry unparseable flagged');
});

test('DateOfExpiry top-level fallback is honored when the Document entry is absent', () => {
  const r = baseResult();
  r.Payload.Data.Document.Data = r.Payload.Data.Document.Data.filter((kv) => kv.Key !== 'DateOfExpiry');
  sig(r).DateOfExpiry = '2099-12-31';
  const d = decide(r);
  assertEqual(d.outcome, 'pass');
  assertEqual(d.reasons, []);
});

test('deterministic clock: expiry compared against injected now', () => {
  const r = baseResult();
  r.Payload.Data.Document.Data = r.Payload.Data.Document.Data.map((kv) =>
    kv.Key === 'DateOfExpiry' ? { Key: 'DateOfExpiry', Value: '2030-01-01' } : kv,
  );
  // now AFTER expiry → reject
  const past = decide(r, { now: Date.parse('2031-01-01T00:00:00Z') });
  assertEqual(past.outcome, 'reject');
  assert(past.reasons.includes('document-expired'), 'expired vs injected now');
  // now BEFORE expiry → clean
  const future = decide(r, { now: Date.parse('2029-01-01T00:00:00Z') });
  assertEqual(future.outcome, 'pass');
});

test('match-score floor is OFF by default (low score still passes)', () => {
  const r = baseResult();
  sig(r).MatchScore = 1;
  const d = decide(r);
  assertEqual(d.outcome, 'pass');
});

test('match-score floor: below floor rejects; missing score rejects', () => {
  const below = baseResult();
  sig(below).MatchScore = 1;
  const d1 = decide(below, { policy: { minMatchScore: 5 } });
  assertEqual(d1.outcome, 'reject');
  assert(d1.reasons.includes('match-score-below-floor'), 'below floor flagged');

  const missing = baseResult();
  delete sig(missing).MatchScore;
  const d2 = decide(missing, { policy: { minMatchScore: 5 } });
  assertEqual(d2.outcome, 'reject');
  assert(d2.reasons.includes('match-score-missing'), 'missing score flagged');
});

test('PascalCase key drift is honored — a rename is not silently dropped', () => {
  // padResult -> PadResult (FAIL) should still trigger review.
  const pad = baseResult();
  delete sig(pad).padResult;
  sig(pad).PadResult = 'FAIL';
  const dPad = decide(pad);
  assertEqual(dPad.outcome, 'review');
  assert(dPad.reasons.includes('document-replay-detected'), 'PadResult drift honored');

  // selfieInjection -> PascalCase (FAIL) should still hard reject.
  const inj = baseResult();
  delete sig(inj).selfieInjectionAttackDetectionResult;
  sig(inj).SelfieInjectionAttackDetectionResult = 'FAIL';
  const dInj = decide(inj);
  assertEqual(dInj.outcome, 'reject');
  assert(dInj.reasons.includes('selfie-injection-attack'), 'Selfie injection drift honored');

  // mismatchMrzOcr -> PascalCase (true) should still review.
  const mrz = baseResult();
  delete sig(mrz).mismatchMrzOcr;
  sig(mrz).MismatchMrzOcr = true;
  const dMrz = decide(mrz);
  assertEqual(dMrz.outcome, 'review');
  assert(dMrz.reasons.includes('mrz-ocr-mismatch'), 'MRZ drift honored');
});

test('unrecognized signal VALUES fail closed (only explicit PASS is clean)', () => {
  const bar = baseResult();
  sig(bar).BarcodeSecurity = 'ERROR';
  const dBar = decide(bar);
  assertEqual(dBar.outcome, 'reject');
  assert(dBar.reasons.includes('barcode-signal-missing'), 'unknown barcode value flagged');

  const matchStr = baseResult();
  sig(matchStr).Matched = 'true'; // string, not boolean
  const dMatch = decide(matchStr);
  assertEqual(dMatch.outcome, 'reject');
  assert(dMatch.reasons.includes('match-signal-missing'), 'string Matched flagged');

  const live = baseResult();
  (sig(live).LivenessDetectionResult as Record<string, unknown>).IsLive = 'yes';
  const dLive = decide(live);
  assertEqual(dLive.outcome, 'reject');
  assert(dLive.reasons.includes('liveness-signal-missing'), 'string IsLive flagged');
});

test('policy knob: missingSignalOutcome=review softens a missing signal to review', () => {
  const r = baseResult();
  delete sig(r).BarcodeSecurity;
  const d = decide(r, { policy: { missingSignalOutcome: 'review' } });
  assertEqual(d.outcome, 'review');
  assert(d.reasons.includes('barcode-signal-missing'), 'still flagged, just softer tier');
});

test('policy knob: documentInjectionOutcome=reject promotes doc-injection to a hard reject', () => {
  const r = baseResult();
  sig(r).documentInjectionAttackDetectionResult = 'FAIL';
  // default → review
  assertEqual(decide(r).outcome, 'review');
  // promoted → reject
  const d = decide(r, { policy: { documentInjectionOutcome: 'reject' } });
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('document-injection-attack'), 'doc-injection promoted');
});

test('combined missing-signal (reject) + mrz (review) → reject lists both', () => {
  const r = baseResult();
  delete sig(r).LivenessDetectionResult; // reject-tier missing
  sig(r).mismatchMrzOcr = true; // review-tier
  const d = decide(r);
  assertEqual(d.outcome, 'reject');
  assert(d.reasons.includes('liveness-signal-missing'), 'reject reason present');
  assert(d.reasons.includes('mrz-ocr-mismatch'), 'review reason still present');
});

test('each required signal, deleted individually, fails closed with its own reason', () => {
  const cases: Array<{ del: string; reason: string }> = [
    { del: 'selfieInjectionAttackDetectionResult', reason: 'selfie-injection-signal-missing' },
    { del: 'BarcodeSecurity', reason: 'barcode-signal-missing' },
    { del: 'padResult', reason: 'pad-signal-missing' },
    { del: 'documentInjectionAttackDetectionResult', reason: 'document-injection-signal-missing' },
    { del: 'Matched', reason: 'match-signal-missing' },
    { del: 'LivenessDetectionResult', reason: 'liveness-signal-missing' },
  ];
  for (const { del, reason } of cases) {
    const r = baseResult();
    delete sig(r)[del];
    const d = decide(r);
    assertEqual(d.outcome, 'reject');
    assert(d.reasons.includes(reason), `deleting ${del} should flag ${reason}, got ${d.reasons.join(',')}`);
  }
});

void run();
