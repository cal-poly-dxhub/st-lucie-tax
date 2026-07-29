/**
 * Unit tests for the resident-facing rejection copy
 * (apps/chatbot-app/src/utils/authid-rejection.ts).
 *
 * The SECURITY RULE under test: fixable reasons get an actionable hint and
 * allow retry; sensitive/anti-fraud reasons collapse to a generic "visit in
 * person" message with NO retry and NO detail leak — an attacker must not be
 * able to learn which detector caught them, even by also tripping a fixable
 * signal. Fail-closed default: unknown reasons are treated as sensitive.
 *
 * Run:
 *   npx tsx tests/unit/authid-rejection-copy.test.ts
 */

import { test, assert, assertEqual, run } from './assert.js';
import { describeAuthIdRejection } from '../../apps/chatbot-app/src/utils/authid-rejection.js';

test('document-expired → actionable, retryable, names the fix', () => {
  const c = describeAuthIdRejection(['document-expired']);
  assertEqual(c.canRetry, true);
  assert(/expired|renew/i.test(c.message), 'mentions expiry/renew');
});

test('selfie-document-mismatch → actionable lighting hint, retryable', () => {
  const c = describeAuthIdRejection(['selfie-document-mismatch']);
  assertEqual(c.canRetry, true);
  assert(/lighting|match|selfie/i.test(c.message), 'gives a selfie hint');
});

test('liveness-failed → actionable, retryable', () => {
  const c = describeAuthIdRejection(['liveness-failed']);
  assertEqual(c.canRetry, true);
  assert(/camera|live|lit/i.test(c.message), 'gives a liveness hint');
});

test('barcode-tampered → generic, NO retry, NO detail leak', () => {
  const c = describeAuthIdRejection(['barcode-tampered']);
  assertEqual(c.canRetry, false);
  assert(/in person/i.test(c.message), 'directs to in-person');
  assert(!/barcode|tamper/i.test(c.message), 'does NOT leak the detector');
});

test('selfie-injection-attack → generic, NO retry, NO detail leak', () => {
  const c = describeAuthIdRejection(['selfie-injection-attack']);
  assertEqual(c.canRetry, false);
  assert(!/inject|attack/i.test(c.message), 'does NOT leak the detector');
});

test('missing-signal / malformed → generic, NO retry (fail-closed)', () => {
  for (const reason of ['liveness-signal-missing', 'barcode-signal-missing', 'malformed-result-payload']) {
    const c = describeAuthIdRejection([reason]);
    assertEqual(c.canRetry, false);
    assert(/in person/i.test(c.message), `${reason} → generic in-person`);
  }
});

test('mixed set: one sensitive reason poisons the whole message (no leak, no retry)', () => {
  const c = describeAuthIdRejection(['document-expired', 'selfie-injection-attack']);
  assertEqual(c.canRetry, false);
  assert(!/expired|renew|inject/i.test(c.message), 'sensitive wins → generic, no detail');
});

test('all-fixable set: expiry messaging preferred, retryable', () => {
  const c = describeAuthIdRejection(['selfie-document-mismatch', 'document-expired']);
  assertEqual(c.canRetry, true);
  assert(/expired|renew/i.test(c.message), 'prefers the expiry fix when present');
});

test('empty / undefined reasons → safe generic, no retry', () => {
  const empty = describeAuthIdRejection([]);
  assertEqual(empty.canRetry, false);
  assert(/in person/i.test(empty.message), 'empty → generic');

  const undef = describeAuthIdRejection(undefined);
  assertEqual(undef.canRetry, false);
  assert(/in person/i.test(undef.message), 'undefined → generic');
});

test('unknown reason → treated as sensitive (fail-closed)', () => {
  const c = describeAuthIdRejection(['some-future-reason-we-dont-know']);
  assertEqual(c.canRetry, false);
  assert(!/some-future-reason/i.test(c.message), 'does not echo the raw reason');
});

void run();
