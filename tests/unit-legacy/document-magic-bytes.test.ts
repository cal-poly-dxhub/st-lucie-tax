/**
 * Unit tests for the upload format sniffer + router
 * (upload/validate-document.ts detectFormat / routeFormat).
 *
 * detectFormat reads real magic bytes (never the filename/Content-Type, which
 * are caller-controlled). routeFormat decides how a detected format reaches the
 * vision model: 'image' (raster ImageBlock), 'document' (PDF via DocumentBlock),
 * 'transcode' (HEIC → JPEG first), or 'passthrough' (fail-open accept, no model
 * call). JPEG/PNG/GIF/WEBP screen as images, PDFs as documents, HEIC transcodes;
 * only genuinely unreadable bytes pass through un-screened.
 */

import { test, assert, assertEqual, run } from './assert.js';
import { detectFormat, routeFormat } from '../../services/chatbot/src/upload/validate-document.js';

// Build a buffer from a magic-byte prefix, padded to >=12 bytes so the length
// guard in detectFormat doesn't short-circuit.
function withPrefix(bytes: number[]): Buffer {
  const b = Buffer.alloc(Math.max(16, bytes.length));
  for (let i = 0; i < bytes.length; i++) b[i] = bytes[i];
  return b;
}

test('JPEG magic bytes → jpeg', () => {
  assertEqual(detectFormat(withPrefix([0xff, 0xd8, 0xff, 0xe0])), 'jpeg');
});

test('PNG magic bytes → png', () => {
  assertEqual(detectFormat(withPrefix([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'png');
});

test('GIF magic bytes → gif', () => {
  assertEqual(detectFormat(withPrefix([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), 'gif');
});

test('WEBP (RIFF....WEBP) → webp', () => {
  // 52 49 46 46 ?? ?? ?? ?? 57 45 42 50
  assertEqual(
    detectFormat(withPrefix([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])),
    'webp',
  );
});

test('PDF (%PDF) → pdf', () => {
  assertEqual(detectFormat(withPrefix([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])), 'pdf');
});

test('HEIC (ftyp box at offset 4) → heic', () => {
  // 00 00 00 18 66 74 79 70 68 65 69 63  (size, "ftyp", "heic")
  assertEqual(
    detectFormat(withPrefix([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63])),
    'heic',
  );
});

test('random bytes → unknown', () => {
  assertEqual(detectFormat(withPrefix([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])), 'unknown');
});

test('empty / too-short buffer → unknown (no throw)', () => {
  assertEqual(detectFormat(Buffer.alloc(0)), 'unknown');
  assertEqual(detectFormat(Buffer.from([0xff, 0xd8])), 'unknown');
});

test('routeFormat: raster images screen via the image path', () => {
  for (const fmt of ['jpeg', 'png', 'gif', 'webp'] as const) {
    assert(routeFormat(fmt) === 'image', `${fmt} should route to image`);
  }
});

test('routeFormat: PDF screens via the document path', () => {
  assert(routeFormat('pdf') === 'document', 'pdf should route to document');
});

test('routeFormat: HEIC screens via the transcode path', () => {
  assert(routeFormat('heic') === 'transcode', 'heic should route to transcode');
});

test('routeFormat: only unreadable bytes pass through un-screened', () => {
  assert(routeFormat('unknown') === 'passthrough', 'unknown should pass through (fail-open)');
});

void run();
