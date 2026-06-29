/**
 * Admin-dashboard authentication.
 *
 * Mirrors services/chatbot/src/auth/beta-auth.ts but with separate env vars
 * (ADMIN_PASSWORD + ADMIN_AUTH_SECRET) so admin tokens don't conflate with
 * beta-tester tokens. Same shape: HMAC-SHA256 over `adm:<email>.<iat>`.
 *
 * SEC-05: tokens EXPIRE 30 days after issue (was: never), with sliding
 * re-issue past half-life via verifyToken's needsRefresh flag. Old pre-SEC-05
 * tokens (no <iat> segment) are rejected → one re-login.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const SECRET = process.env.ADMIN_AUTH_SECRET ?? "";

// 30-day lifetime; re-issue once past half-life (15 days).
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOKEN_REISSUE_AFTER_MS = TOKEN_TTL_MS / 2;

export function isAuthEnabled(): boolean {
  return PASSWORD.length > 0 && SECRET.length > 0;
}

export function checkPassword(submitted: string): boolean {
  if (!PASSWORD) return false;
  if (typeof submitted !== "string") return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(PASSWORD);
  const max = Math.max(a.length, b.length);
  const pa = Buffer.alloc(max);
  a.copy(pa);
  const pb = Buffer.alloc(max);
  b.copy(pb);
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
  // Prefix with `adm:` so admin tokens are distinguishable from beta tokens
  // even though they live in different localStorage keys and target different
  // APIs. Defense in depth — a tester token lifted into the admin API will
  // fail the prefix check before HMAC verify.
  const e = b64url(`adm:${normalized}`);
  const iat = String(issuedAt);
  const signed = `${e}.${iat}`;
  return `${signed}.${hmac(signed)}`;
}

/**
 * Verify an admin token. Returns null when missing/invalid/expired/not-admin.
 * `needsRefresh` is true past half-life (sliding expiry). Old `adm:` tokens
 * without an iat segment are rejected.
 */
export function verifyToken(
  token: string,
  now: number = Date.now(),
): { email: string; needsRefresh: boolean } | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null; // legacy 2-segment token rejected
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

  const iat = Number(iatPart);
  if (!Number.isFinite(iat)) return null;
  const age = now - iat;
  if (age < 0 || age > TOKEN_TTL_MS) return null;

  let raw: string;
  try {
    raw = b64urlDecode(ePart);
  } catch {
    return null;
  }
  if (!raw.startsWith("adm:")) return null;
  const email = raw.slice(4);
  if (!isValidEmail(email)) return null;
  return { email, needsRefresh: age > TOKEN_REISSUE_AFTER_MS };
}

export function normalizeEmail(email: string): string {
  return String(email).trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (!email || email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
