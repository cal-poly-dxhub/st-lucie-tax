/**
 * Unit tests for the vision-tool observation parsers
 * (upload/validate-document.ts parseObservedDates / parseDatesLegible).
 *
 * The vision model REPORTS the dates it reads (Phase 1 — observation only, no
 * expiry judgment yet). These pure helpers pull the observed dates + legibility
 * flag out of the model's tool input DEFENSIVELY: any missing, malformed, or
 * wrong-typed field is dropped rather than trusted. Nothing downstream should
 * ever throw on a garbage payload.
 */

import { test, assertEqual, run } from './assert.js';
import {
  parseObservedDates,
  parseDatesLegible,
} from '../../services/chatbot/src/upload/validate-document.js';

test('parseObservedDates: keeps well-formed ISO string fields', () => {
  const out = parseObservedDates({
    issued: '2026-01-15',
    dated: '2026-02-01',
    signed: '2025-12-31',
    expires: '2030-06-30',
  });
  assertEqual(out, {
    issued: '2026-01-15',
    dated: '2026-02-01',
    signed: '2025-12-31',
    expires: '2030-06-30',
  });
});

test('parseObservedDates: keeps only the fields present', () => {
  assertEqual(parseObservedDates({ dated: '2026-02-01' }), { dated: '2026-02-01' });
});

test('parseObservedDates: drops non-string values, keeps valid siblings', () => {
  const out = parseObservedDates({ issued: 20260115, dated: '2026-02-01', expires: null });
  assertEqual(out, { dated: '2026-02-01' });
});

test('parseObservedDates: ignores unknown keys', () => {
  assertEqual(parseObservedDates({ dated: '2026-02-01', bogusKey: '2026-03-03' }), {
    dated: '2026-02-01',
  });
});

test('parseObservedDates: no valid fields → undefined', () => {
  assertEqual(parseObservedDates({ issued: 5, dated: {}, expires: [] }), undefined);
  assertEqual(parseObservedDates({}), undefined);
});

test('parseObservedDates: non-object input → undefined (no throw)', () => {
  assertEqual(parseObservedDates(undefined), undefined);
  assertEqual(parseObservedDates(null), undefined);
  assertEqual(parseObservedDates('2026-01-01'), undefined);
  assertEqual(parseObservedDates(42), undefined);
});

test('parseDatesLegible: passes through a real boolean', () => {
  assertEqual(parseDatesLegible(true), true);
  assertEqual(parseDatesLegible(false), false);
});

test('parseDatesLegible: non-boolean → undefined (no throw)', () => {
  assertEqual(parseDatesLegible(undefined), undefined);
  assertEqual(parseDatesLegible('true'), undefined);
  assertEqual(parseDatesLegible(1), undefined);
  assertEqual(parseDatesLegible(null), undefined);
});

void run();
