/**
 * Beta-tester authentication.
 *
 * Single shared master password (BETA_PASSWORD env var). Successful login
 * returns an HMAC-SHA256 token over the email + an issued-at timestamp, signed
 * with a server-side secret (BETA_AUTH_SECRET).
 *
 * Token shape: `<base64url-email>.<iat>.<hex-hmac>` where the HMAC covers
 * `<base64url-email>.<iat>` so the timestamp can't be forged. Stateless —
 * verifying recomputes the HMAC and constant-time-compares.
 *
 * SEC-05: tokens EXPIRE 30 days after issue (was: never). Expiry is "sliding" —
 * verifyToken reports when a still-valid token is past half-life so the auth
 * middleware can re-issue a fresh one (surfaced via the X-Refreshed-Token
 * response header), keeping active multi-day testers logged in while a truly
 * idle/stolen token dies within 30 days. Old pre-SEC-05 tokens (no <iat>
 * segment) are rejected → one re-login.
 *
 * Security notes:
 * - BETA_PASSWORD compare is constant-time (timingSafeEqual on equal-length
 *   buffers) to prevent password-length probing.
 * - HMAC verify is constant-time too.
 * - This is a tester-list gate, NOT real auth. Don't reuse for production.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PASSWORD = process.env.BETA_PASSWORD ?? "";
const SECRET = process.env.BETA_AUTH_SECRET ?? "";

// 30-day lifetime; re-issue once a token is past half-life (15 days).
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_REISSUE_AFTER_MS = TOKEN_TTL_MS / 2;

export function isAuthEnabled(): boolean {
  return PASSWORD.length > 0 && SECRET.length > 0;
}

export function checkPassword(submitted: string): boolean {
  if (!PASSWORD) return false;
  if (typeof submitted !== "string") return false;
  // Pad both to same length to avoid throwing on length mismatch and to
  // prevent length-leak side channels.
  const a = Buffer.from(submitted);
  const b = Buffer.from(PASSWORD);
  const max = Math.max(a.length, b.length);
  const pa = Buffer.alloc(max);
  a.copy(pa);
  const pb = Buffer.alloc(max);
  b.copy(pb);
  // timingSafeEqual still leaks length, but we've equalized buffers above.
  // Outer length check fails if mismatch (intentional).
  return a.length === b.length && timingSafeEqual(pa, pb);
}

function hmac(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

function b64url(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64url");
}

function b64urlDecode(s: string): string {
  return Buffer.from(s, "base64url").toString("utf-8");
}

export function issueToken(email: string, issuedAt: number = Date.now()): string {
  const normalized = normalizeEmail(email);
  const e = b64url(normalized);
  const iat = String(issuedAt);
  const signed = `${e}.${iat}`;
  return `${signed}.${hmac(signed)}`;
}

/**
 * Verify a token. Returns null when missing/invalid/expired. On success,
 * `needsRefresh` is true once the token is past half-life so the caller can
 * re-issue (sliding expiry). Old `<email>.<hmac>` tokens (no iat) are rejected.
 */
export function verifyToken(
  token: string,
  now: number = Date.now(),
): { email: string; needsRefresh: boolean } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  // New shape is exactly 3 segments: email . iat . hmac. Anything else
  // (incl. the legacy 2-segment token) is rejected.
  if (parts.length !== 3) return null;
  const [ePart, iatPart, sigPart] = parts;
  if (!ePart || !iatPart || !sigPart) return null;

  const signed = `${ePart}.${iatPart}`;
  const expected = hmac(signed);
  if (sigPart.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sigPart, "hex"), Buffer.from(expected, "hex"))) return null;
  } catch {
    return null;
  }

  // Signature is valid — now enforce expiry on the (trusted) timestamp.
  const iat = Number(iatPart);
  if (!Number.isFinite(iat)) return null;
  const age = now - iat;
  if (age < 0 || age > TOKEN_TTL_MS) return null; // future-dated or expired

  let email: string;
  try {
    email = b64urlDecode(ePart);
  } catch {
    return null;
  }
  if (!isValidEmail(email)) return null;
  return { email, needsRefresh: age > TOKEN_REISSUE_AFTER_MS };
}

export function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  // Lightweight check: looks like x@y.z. Real validation isn't worth it for
  // a tester list — we just don't want injected garbage in the token payload.
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
