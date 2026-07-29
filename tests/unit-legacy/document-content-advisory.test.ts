/**
 * Unit tests for the content-check advisory builder
 * (upload/check-validity.ts buildContentAdvisory).
 *
 * Content/status/eligibility checks (e.g. "Sunbiz shows Active", "VA letter
 * states 100% permanent") are ADVISORY ONLY — they never hard-reject. The
 * vision model judges whether each required attribute is present and reports
 * any it finds clearly missing/wrong; this pure function turns that into a
 * friendly resident-facing notice, but ONLY when the item actually declares
 * content checks. It never fabricates a warning and returns undefined when
 * there is nothing to say (so a normal accept stays clean).
 */

import { test, assert, assertEqual, run } from './assert.js';
import { buildContentAdvisory } from '../../services/chatbot/src/upload/check-validity.js';
import type { ContentCheck } from '@st-lucie/shared-types';

const checks: ContentCheck[] = [
  { requiredAttribute: 'status: Active', source: 'sunbiz' },
];

test('no content checks on the item → undefined (never warn on an unscoped item)', () => {
  assertEqual(buildContentAdvisory(undefined, ['status: INACTIVE']), undefined);
  assertEqual(buildContentAdvisory([], ['anything']), undefined);
});

test('checks present but model reported no concerns → undefined (clean accept)', () => {
  assertEqual(buildContentAdvisory(checks, []), undefined);
  assertEqual(buildContentAdvisory(checks, undefined), undefined);
});

test('checks present + a real concern → advisory string mentioning the concern', () => {
  const msg = buildContentAdvisory(checks, ['the Sunbiz status shows INACTIVE, not Active']);
  assert(typeof msg === 'string' && msg.length > 0, 'should return a message');
  assert(msg!.includes('INACTIVE'), 'should surface the concern text');
  assert(/re-upload|bring/i.test(msg!), 'should tell the resident what to do');
});

test('blank / whitespace-only concerns are dropped → undefined', () => {
  assertEqual(buildContentAdvisory(checks, ['', '   ']), undefined);
});

test('multiple concerns are all included', () => {
  const msg = buildContentAdvisory(checks, ['no VIN visible', 'status not Active']);
  assert(msg!.includes('no VIN visible') && msg!.includes('status not Active'), 'both concerns present');
});

test('advisory is NOT a rejection — it is a separate, non-blocking string', () => {
  // Contract: buildContentAdvisory returns a message only; it has no verdict and
  // cannot itself block. (The caller attaches it to an ACCEPT verdict.)
  const msg = buildContentAdvisory(checks, ['status not Active']);
  assertEqual(typeof msg, 'string');
});

void run();
