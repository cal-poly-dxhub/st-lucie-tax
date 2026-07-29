/**
 * Unit tests for the document-validation decision mapping
 * (upload/validate-document.ts mapVerdictToAction).
 *
 * The invariant: rejection is RARE and conservative. Only a model reject AT OR
 * ABOVE the confidence threshold (default 0.85) blocks; every other outcome —
 * accept, a below-threshold reject, a missing confidence — maps to accept
 * (fail-open). Mirrors the accept/review/reject shape of authid/decision.ts.
 */

import { test, assert, assertEqual, run } from './assert.js';
import { mapVerdictToAction } from '../../services/chatbot/src/upload/validate-document.js';

test('high-confidence accept → accept', () => {
  assertEqual(mapVerdictToAction({ verdict: 'accept', confidence: 0.99 }), 'accept');
});

test('high-confidence reject → hard-reject', () => {
  assertEqual(mapVerdictToAction({ verdict: 'reject', confidence: 0.99 }), 'hard-reject');
});

test('reject at the 0.85 boundary → hard-reject (inclusive)', () => {
  assertEqual(mapVerdictToAction({ verdict: 'reject', confidence: 0.85 }), 'hard-reject');
});

test('reject just below threshold → accept (fail-open)', () => {
  assertEqual(mapVerdictToAction({ verdict: 'reject', confidence: 0.84 }), 'accept');
});

test('reject with no confidence → accept (fail-open)', () => {
  assertEqual(mapVerdictToAction({ verdict: 'reject' }), 'accept');
});

test('low-confidence accept → accept', () => {
  assertEqual(mapVerdictToAction({ verdict: 'accept', confidence: 0.1 }), 'accept');
});

test('only a confident reject is ever an action', () => {
  // Sweep: the only inputs that block are reject + confidence >= 0.85.
  for (const c of [0, 0.5, 0.84, 0.849]) {
    assert(
      mapVerdictToAction({ verdict: 'reject', confidence: c }) === 'accept',
      `reject@${c} must fail-open to accept`,
    );
  }
  for (const c of [0.85, 0.9, 1]) {
    assert(
      mapVerdictToAction({ verdict: 'reject', confidence: c }) === 'hard-reject',
      `reject@${c} must hard-reject`,
    );
  }
});

void run();
