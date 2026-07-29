/**
 * Unit tests for scrubSensitiveInput (SEC-06 narrow variant).
 *
 * Two halves, both load-bearing. The must-NOT-scrub guards are as important as
 * the must-scrub cases — the whole design constraint is "do not scrub useful
 * numbers" that the engine needs (durations, money, ZIP, phone, VIN, form #s,
 * confirmation #s, and the user's own DL number).
 */

import {
  scrubSensitiveInput,
  scrubNoticeForPrompt,
  SCRUB_PLACEHOLDER,
} from '../../services/chatbot/src/middleware/input-scrub.js';
import { test, assert, assertEqual, run } from './assert.js';

const has = (s: string) => s.includes(SCRUB_PLACEHOLDER);

// --- MUST scrub ------------------------------------------------------------

test('scrubs a dashed SSN', () => {
  const r = scrubSensitiveInput('my ssn is 123-45-6789 ok');
  assert(has(r.clean), 'placeholder present');
  assert(!r.clean.includes('123-45-6789'), 'ssn gone');
  assertEqual(r.removed, ['ssn']);
});

test('scrubs a bare 9-digit SSN when "social security" cue is present', () => {
  const r = scrubSensitiveInput('social security number 123456789');
  assert(has(r.clean), 'placeholder present');
  assert(!r.clean.includes('123456789'), 'bare ssn gone');
  assert(r.removed.includes('ssn'), 'flagged ssn');
  // The cue word should remain — we only replace the number.
  assert(/social security/i.test(r.clean), 'cue text kept');
});

test('scrubs Luhn-valid payment cards (spaced and bare)', () => {
  // 4242 4242 4242 4242 is the canonical Luhn-valid Visa test number.
  const spaced = scrubSensitiveInput('here is my card 4242 4242 4242 4242 thanks');
  assert(has(spaced.clean) && !spaced.clean.includes('4242 4242'), 'spaced card gone');
  assert(spaced.removed.includes('card'), 'flagged card');

  const bare = scrubSensitiveInput('4111111111111111');
  assert(has(bare.clean), 'bare card gone');
  assert(bare.removed.includes('card'), 'flagged card');
});

test('scrubs a checksum-valid bank routing number with cue', () => {
  // 021000021 is a real, ABA-checksum-valid routing number (JPMorgan Chase).
  const r = scrubSensitiveInput('routing number 021000021 please');
  assert(has(r.clean) && !r.clean.includes('021000021'), 'routing gone');
  assert(r.removed.includes('bank'), 'flagged bank');
});

test('scrubs an account number with cue', () => {
  const r = scrubSensitiveInput('my account number is 1234567890');
  assert(has(r.clean) && !r.clean.includes('1234567890'), 'account gone');
  assert(r.removed.includes('bank'), 'flagged bank');
});

test('scrubs a non-Luhn card when user says "card" nearby (context-cued)', () => {
  // 4007 0000 0000 0027 is a real Visa AVS test card but fails Luhn.
  // The context cue "card number" still triggers scrubbing.
  const r = scrubSensitiveInput('My credit card number is 4007 0000 0000 0027');
  assert(has(r.clean) && !r.clean.includes('4007'), 'context-cued non-Luhn card gone');
  assert(r.removed.includes('card'), 'flagged card');
});

test('removes multiple kinds in one message', () => {
  const r = scrubSensitiveInput('ssn 123-45-6789 and card 4111 1111 1111 1111');
  assert(r.removed.includes('ssn') && r.removed.includes('card'), 'both kinds');
  assert(!r.clean.includes('123-45-6789') && !r.clean.includes('4111'), 'both gone');
});

// --- MUST NOT scrub (false-positive guards) --------------------------------

test('preserves useful engine numbers untouched', () => {
  const safe = [
    'I owned it for 8 months',
    'the car was $5,000',
    'I paid 5000 dollars',
    'call me at 772-462-1000',          // phone, not SSN (grouping/no cue)
    'my zip is 34982',
    'zip 34982-1234',                   // ZIP+4 (9 digits, but no ssn cue)
    'confirmation number 1234567',      // 7-digit id
    'VIN 1HGCM82633A004352',            // 17-char VIN, has letters
    'HSMV form 82040',                  // form number
    'I was born in 1962',
    'appointment at 4:30 on the 15th',
  ];
  for (const s of safe) {
    const r = scrubSensitiveInput(s);
    assertEqual(r.clean, s, `must be untouched: "${s}"`);
    assertEqual(r.removed, [], `nothing removed: "${s}"`);
  }
});

test('does NOT scrub the user driver-license number (preserve decision)', () => {
  const r = scrubSensitiveInput('my license is D123-456-78-901-2');
  assertEqual(r.clean, 'my license is D123-456-78-901-2', 'DL preserved');
  assertEqual(r.removed, []);
});

test('does NOT scrub a 16-digit run that FAILS Luhn (not a real card)', () => {
  // 1234567890123456 fails Luhn -> must be treated as a non-card number.
  const r = scrubSensitiveInput('reference 1234567890123456 end');
  assertEqual(r.clean, 'reference 1234567890123456 end', 'non-card run preserved');
  assertEqual(r.removed, []);
});

test('does NOT scrub 9 digits labelled routing if ABA checksum FAILS', () => {
  // 123456789 is NOT a valid ABA routing number.
  const r = scrubSensitiveInput('routing 123456789');
  assertEqual(r.clean, 'routing 123456789', 'invalid routing preserved');
  assertEqual(r.removed, []);
});

test('does NOT scrub a bare 9-digit number with no SSN/bank cue', () => {
  const r = scrubSensitiveInput('the code is 123456789');
  assertEqual(r.clean, 'the code is 123456789', 'bare 9 digits, no cue, preserved');
  assertEqual(r.removed, []);
});

// --- Robustness ------------------------------------------------------------

test('never throws; empty/garbage returns unchanged', () => {
  assertEqual(scrubSensitiveInput('').clean, '');
  assertEqual(scrubSensitiveInput('🎉 hello 1️⃣2️⃣').removed, []);
  // @ts-expect-error intentional bad input
  assertEqual(scrubSensitiveInput(null).removed, []);
});

test('idempotent: scrubbing already-scrubbed text changes nothing more', () => {
  const once = scrubSensitiveInput('ssn 123-45-6789').clean;
  const twice = scrubSensitiveInput(once);
  assertEqual(twice.clean, once, 'second pass is a no-op');
  assertEqual(twice.removed, []);
});

// --- Notice builder --------------------------------------------------------

test('scrubNoticeForPrompt: null when nothing removed, message otherwise', () => {
  assertEqual(scrubNoticeForPrompt([]), null);
  const note = scrubNoticeForPrompt(['ssn', 'card']);
  assert(note !== null && note.includes('Social Security number') && note.includes('payment-card'), 'note mentions kinds');
});

run();
