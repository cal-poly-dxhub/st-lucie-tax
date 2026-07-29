/**
 * Unit tests for the document validity decision engine
 * (upload/check-validity.ts checkValidity / buildExpiryReason).
 *
 * checkValidity is the pure, deterministic core that decides whether an
 * uploaded document is expired/too-old, given a catalog validity rule and the
 * dates the vision model observed. It mirrors authid/decision.ts: end-of-day
 * UTC grace on the compared date, a Number.isFinite guard, and FAIL-OPEN on any
 * missing/illegible/unparseable/no-rule case (a wrongly-rejected real resident
 * is far worse than one stale doc reaching a clerk). It is NOT the plausibility
 * confidence gate — expiry is an independent factual date compare.
 *
 * Every row below fixes `asOf` so the result is deterministic (no Date.now()).
 */

import { test, assert, assertEqual, run } from './assert.js';
import { checkValidity, buildExpiryReason } from '../../services/chatbot/src/upload/check-validity.js';
import type { DocumentValidity } from '@st-lucie/shared-types';

// A fixed "today" for every comparison.
const ASOF = new Date('2026-07-29T12:00:00Z');

const maxAge = (days: number, anchor: DocumentValidity['anchor'] = 'dated'): DocumentValidity => ({
  rule: 'max-age',
  anchor,
  days,
  source: 'test',
});
const unexpired = (): DocumentValidity => ({ rule: 'unexpired', anchor: 'expires', source: 'test' });

// ---- fail-open: nothing to decide on ----------------------------------------

test('no validity rule → ok (fail-open)', () => {
  assertEqual(checkValidity(undefined, { dated: '2000-01-01' }, true, ASOF), { status: 'ok' });
});

test('datesLegible === false → ok (fail-open, even with a stale date present)', () => {
  assertEqual(checkValidity(maxAge(60), { dated: '2000-01-01' }, false, ASOF), { status: 'ok' });
});

test('anchor date absent from observed → ok (fail-open)', () => {
  // rule anchors on `dated`, but only `issued` was observed.
  assertEqual(checkValidity(maxAge(60), { issued: '2000-01-01' }, true, ASOF), { status: 'ok' });
});

test('observed undefined → ok (fail-open)', () => {
  assertEqual(checkValidity(maxAge(60), undefined, true, ASOF), { status: 'ok' });
});

test('unparseable anchor date → ok (fail-open)', () => {
  assertEqual(checkValidity(maxAge(60), { dated: 'not-a-date' }, true, ASOF), { status: 'ok' });
});

test('partial date (year-only / year-month) → ok (fail-open, not a confident reject)', () => {
  // new Date('2026T...') would coerce to Jan 1 (finite, ~7mo old) — must NOT reject.
  assertEqual(checkValidity(maxAge(30), { dated: '2026' }, true, ASOF), { status: 'ok' });
  assertEqual(checkValidity(maxAge(30), { dated: '2026-07' }, true, ASOF), { status: 'ok' });
});

test('impossible calendar date (Feb 29 non-leap) → ok (fail-open, no rollover reject)', () => {
  // new Date('2025-02-29T...') silently rolls to Mar 1 — must be rejected as unparseable.
  assertEqual(checkValidity(maxAge(30), { dated: '2025-02-29' }, true, ASOF), { status: 'ok' });
});

test('unexpired rule with a non-expires anchor → ok (fail-open, never mass-reject)', () => {
  // A mis-authored rule; issued dates are always in the past. Must not reject.
  const misauthored: DocumentValidity = { rule: 'unexpired', anchor: 'issued', source: 'test' };
  assertEqual(checkValidity(misauthored, { issued: '2020-01-01' }, true, ASOF), { status: 'ok' });
});

test('datesLegible undefined (not reported) does NOT block the decision', () => {
  // A legible-flag that was simply never reported must not force fail-open; the
  // date itself governs. Here the date is fresh → ok.
  assertEqual(checkValidity(maxAge(60), { dated: '2026-07-01' }, undefined, ASOF), { status: 'ok' });
});

// ---- max-age -----------------------------------------------------------------

test('max-age: date within the window → ok', () => {
  // 30 days old, window 60.
  assertEqual(checkValidity(maxAge(60), { dated: '2026-06-29' }, true, ASOF), { status: 'ok' });
});

test('max-age: date older than the window → expired (document-too-old)', () => {
  // ~90 days old, window 60.
  const out = checkValidity(maxAge(60), { dated: '2026-04-30' }, true, ASOF);
  assertEqual(out.status, 'expired');
  assertEqual(out.reason, 'document-too-old');
});

test('max-age: exactly `days` old → ok (boundary is inclusive via end-of-day grace)', () => {
  // Exactly 60 days before ASOF's date (2026-07-29 → 2026-05-30). End-of-day
  // UTC parse gives the whole day, so age is <= 60 → ok, not expired.
  assertEqual(checkValidity(maxAge(60), { dated: '2026-05-30' }, true, ASOF), { status: 'ok' });
});

test('max-age: a future dated date → ok (never negative-expired)', () => {
  assertEqual(checkValidity(maxAge(60), { dated: '2027-01-01' }, true, ASOF), { status: 'ok' });
});

test('max-age with no `days` → ok (fail-open; lint prevents authoring this)', () => {
  const bad: DocumentValidity = { rule: 'max-age', anchor: 'dated', source: 'test' };
  assertEqual(checkValidity(bad, { dated: '1990-01-01' }, true, ASOF), { status: 'ok' });
});

test('max-age honors a non-default anchor (issued)', () => {
  const rule = maxAge(60, 'issued');
  assertEqual(checkValidity(rule, { issued: '2026-06-29', dated: '1990-01-01' }, true, ASOF), {
    status: 'ok',
  });
  const stale = checkValidity(rule, { issued: '2026-01-01' }, true, ASOF);
  assertEqual(stale.status, 'expired');
});

// ---- unexpired ---------------------------------------------------------------

test('unexpired: future expiry → ok', () => {
  assertEqual(checkValidity(unexpired(), { expires: '2030-01-01' }, true, ASOF), { status: 'ok' });
});

test('unexpired: past expiry → expired (document-expired)', () => {
  const out = checkValidity(unexpired(), { expires: '2025-01-01' }, true, ASOF);
  assertEqual(out.status, 'expired');
  assertEqual(out.reason, 'document-expired');
});

test('unexpired: expires today → ok (whole-day grace)', () => {
  assertEqual(checkValidity(unexpired(), { expires: '2026-07-29' }, true, ASOF), { status: 'ok' });
});

test('unexpired: expired yesterday → expired', () => {
  const out = checkValidity(unexpired(), { expires: '2026-07-28' }, true, ASOF);
  assertEqual(out.status, 'expired');
  assertEqual(out.reason, 'document-expired');
});

// ---- appliesWhen: subtype-scoped rules (mixed-bucket items) ------------------
// A rule with appliesWhen only fires when the model's observedDocument matches
// one of the listed subtype keywords. Used for address-proof, where the same
// slot accepts a 60-day utility bill AND a permanent deed — the 60-day window
// must apply to the bill but never the deed.

const scoped = (days: number): DocumentValidity => ({
  rule: 'max-age',
  anchor: 'dated',
  days,
  source: 'test',
  appliesWhen: ['utility bill', 'bank statement', 'official mail'],
});

test('appliesWhen: matching subtype + stale date → expired (rule fires)', () => {
  const out = checkValidity(scoped(60), { dated: '2026-04-01' }, true, ASOF, 'a utility bill from FPL');
  assertEqual(out.status, 'expired');
  assertEqual(out.reason, 'document-too-old');
});

test('appliesWhen: matching subtype + fresh date → ok', () => {
  assertEqual(
    checkValidity(scoped(60), { dated: '2026-07-15' }, true, ASOF, 'Bank Statement - Chase'),
    { status: 'ok' },
  );
});

test('appliesWhen: NON-matching subtype (deed) + stale date → ok (fail-open, not screened)', () => {
  // A recorded deed dated 2012 must NOT be rejected — it is a permanent proof.
  assertEqual(
    checkValidity(scoped(60), { dated: '2012-06-01' }, true, ASOF, 'Warranty Deed recorded 2012'),
    { status: 'ok' },
  );
});

test('appliesWhen: observedDocument missing → ok (fail-open, cannot classify)', () => {
  // If we can't tell what subtype it is, do not risk rejecting a permanent proof.
  assertEqual(checkValidity(scoped(60), { dated: '2012-06-01' }, true, ASOF, undefined), {
    status: 'ok',
  });
});

test('appliesWhen: matching is case-insensitive', () => {
  const out = checkValidity(scoped(60), { dated: '2026-04-01' }, true, ASOF, 'UTILITY BILL');
  assertEqual(out.status, 'expired');
});

test('rule WITHOUT appliesWhen ignores observedDocument (unchanged behavior)', () => {
  // The 5th arg is optional; a normal rule fires regardless of observedDocument.
  const out = checkValidity(maxAge(60), { dated: '2026-04-01' }, true, ASOF, 'anything');
  assertEqual(out.status, 'expired');
});

// ---- reason builder ----------------------------------------------------------

test('buildExpiryReason: max-age mentions the window in days + a friendly fallback', () => {
  const msg = buildExpiryReason(maxAge(60));
  assert(/60/.test(msg), 'should state the 60-day window');
  assert(/upload|bring/i.test(msg), 'should tell the resident what to do');
});

test('buildExpiryReason: unexpired mentions expiry + a friendly fallback', () => {
  const msg = buildExpiryReason(unexpired());
  assert(/expir/i.test(msg), 'should mention expiry');
  assert(/upload|bring/i.test(msg), 'should tell the resident what to do');
});

void run();
