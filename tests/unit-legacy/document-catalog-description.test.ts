/**
 * Unit tests for the expected-document description fed to the vision model
 * (upload/validate-document.ts buildExpectedDocText).
 *
 * The SPA sends the catalog itemId as documentType, so the expectation is
 * looked up directly via getCatalogItem(itemId) — label + notes. An unknown
 * itemId must degrade gracefully (use the raw string, never throw).
 */

import { test, assert, run } from './assert.js';
import { buildExpectedDocText } from '../../services/chatbot/src/upload/validate-document.js';

test('known itemId includes the catalog label and notes', () => {
  const text = buildExpectedDocText('primary-id-passport');
  assert(text.includes('US passport (original, unexpired)'), 'should include the label');
  assert(text.includes('Accepted primary identity document for REAL ID.'), 'should include the notes');
  assert(/could this image plausibly BE that document/i.test(text), 'should ask the screening question');
});

test('unknown itemId degrades gracefully — uses the raw string, no throw', () => {
  const raw = 'some-unmapped-document-xyz';
  const text = buildExpectedDocText(raw);
  assert(text.includes(raw), 'should fall back to the raw documentType string');
  assert(/could this image plausibly BE that document/i.test(text), 'should still ask the question');
});

void run();
