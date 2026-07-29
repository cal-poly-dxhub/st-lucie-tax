/**
 * HEIC → JPEG transcode, isolated behind a single seam.
 *
 * The Bedrock Converse ImageBlock format enum only accepts jpeg/png/gif/webp,
 * so HEIC (the default iPhone photo format) must be transcoded before the
 * vision model can screen it — otherwise it passes through un-screened.
 *
 * This module is deliberately the ONLY place that touches `heic-convert` (which
 * pulls in libheif via `libheif-js/wasm-bundle`, an LGPL-3.0 dependency whose
 * wasm is inlined into the JS bundle — see the Phase 1 design doc's license
 * note). Keeping it behind one function keeps that dependency swappable if the
 * county objects at acceptance.
 *
 * Fail-open contract: this NEVER throws. On timeout or any decode failure it
 * resolves to null, and the caller falls open to accept (a wrongly-rejected
 * real resident is far worse than one un-screened HEIC reaching a clerk).
 */

import convert from "heic-convert";

/**
 * Transcode a HEIC/HEIF buffer to JPEG. `heic-convert` has no abort signal, so
 * we bound it with a race against a timer; a decode that would blow the request
 * budget resolves to null (fail-open). Any thrown error also resolves to null.
 */
export async function transcodeHeicToJpeg(buf: Buffer, timeoutMs: number): Promise<Buffer | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });

  const work = (async () => {
    try {
      const out = await convert({ buffer: buf, format: "JPEG", quality: 0.85 });
      return Buffer.from(out);
    } catch {
      return null;
    }
  })();

  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
