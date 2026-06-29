/**
 * Thin AuthID Identity Service client.
 *
 * Token mgmt: lazily fetches an AccessToken on first use, caches in
 * module scope for 50 minutes (AuthID's TTL is undocumented; 50min is a
 * defensive choice vs the typical 1h OAuth standard) so callers don't
 * pay the auth round-trip on every request.
 *
 * Per legacy/superpowers/specs/2026-06-02-authid-integration-research.md.
 */
import type {
  AuthIdTokenResponse,
  CreateProofTransactionResponse,
  CreateVerifiedTransactionResponse,
  OperationStatusResponse,
  ProofResultRaw,
} from "./types.js";

const BASE_URL = process.env.AUTHID_BASE_URL ?? "https://id-uat.authid.ai";
const API_KEY_ID = process.env.AUTHID_API_KEY_ID ?? "";
const API_KEY_VALUE = process.env.AUTHID_API_KEY_VALUE ?? "";
const TOKEN_TTL_MS = 50 * 60 * 1000;

// AuthID's AuthorizationServiceRest splits Proof and Verified across two
// resources: /v2/operations for foreign-document Proof, /v2/transactions for
// biometric Verified. Verified by inspecting the live swagger v2 spec on
// 2026-06-05 — the original research doc conflated them, which produced a
// NullReferenceException server-side when we POSTed Proof to /v2/transactions.
const OPERATIONS_PATH = "/IDCompleteBackendEngine/Default/AuthorizationServiceRest/v2/operations";
const TRANSACTIONS_PATH =
  "/IDCompleteBackendEngine/Default/AuthorizationServiceRest/v2/transactions";
const ACCOUNTS_PATH = "/IDCompleteBackendEngine/Default/AdministrationServiceRest/v1/accounts";

let cachedToken: { value: string; expiresAt: number } | null = null;

export function __resetForTesting(): void {
  cachedToken = null;
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (!API_KEY_ID || !API_KEY_VALUE) {
    throw new Error("AUTHID_API_KEY_ID / AUTHID_API_KEY_VALUE not configured");
  }
  const basic = Buffer.from(`${API_KEY_ID}:${API_KEY_VALUE}`).toString("base64");
  const res = await fetch(`${BASE_URL}/IDCompleteBackendEngine/IdentityService/v1/auth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`AuthID token failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as AuthIdTokenResponse;
  // Honor AuthID's real expiry when present (it's ~15min, shorter than our
  // defensive default), minus a 60s safety margin; fall back to the default
  // cap. The 401-retry in authedFetch backstops any remaining drift.
  let expiresAt = Date.now() + TOKEN_TTL_MS;
  if (body.AccessTokenExpirationDate) {
    const parsed = Date.parse(body.AccessTokenExpirationDate);
    if (Number.isFinite(parsed)) {
      expiresAt = Math.min(expiresAt, parsed - 60_000);
    }
  }
  cachedToken = { value: body.AccessToken, expiresAt };
  return body.AccessToken;
}

async function authedFetch(path: string, init: RequestInit): Promise<Response> {
  const send = async (token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("Accept", "application/json");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    return fetch(`${BASE_URL}${path}`, { ...init, headers });
  };

  let res = await send(await getAccessToken());
  // AuthID's real token TTL is shorter than our defensive cache window, so a
  // cached token can be rejected (401 E_USER_NOT_AUTHENTICATED) while we still
  // think it's valid. Force-refresh once and retry so a stale cache self-heals
  // instead of failing every call until the process restarts.
  if (res.status === 401) {
    cachedToken = null;
    res = await send(await getAccessToken(true));
  }
  return res;
}

export async function ensureAccountExists(opts: {
  accountNumber: string;
  email?: string;
}): Promise<void> {
  const checkRes = await authedFetch(`${ACCOUNTS_PATH}/${encodeURIComponent(opts.accountNumber)}`, {
    method: "GET",
  });
  // AuthID returns 200 with body `null` for missing accounts (not 404). Only
  // treat the GET as "exists" when the body parses to a non-null object.
  if (checkRes.ok) {
    const body = (await checkRes.json().catch(() => null)) as unknown;
    if (body && typeof body === "object") return;
  }
  const createRes = await authedFetch(ACCOUNTS_PATH, {
    method: "POST",
    body: JSON.stringify({
      AccountNumber: opts.accountNumber,
      Enabled: true,
      Custom: true,
      DisplayName: opts.accountNumber,
      Email: opts.email ?? "",
    }),
  });
  if (createRes.ok) return;
  if (createRes.status === 409) return; // race: another request created it
  throw new Error(`AuthID account create failed: ${createRes.status} ${await createRes.text()}`);
}

export async function createProofTransaction(opts: {
  accountNumber: string;
  documentTypeCode: string;
  timeoutSeconds?: number;
}): Promise<CreateProofTransactionResponse> {
  const res = await authedFetch(OPERATIONS_PATH, {
    method: "POST",
    body: JSON.stringify({
      AccountNumber: opts.accountNumber,
      Payload: { DocumentTypes: [opts.documentTypeCode] },
      Name: "GetForeignIDDocument",
      Timeout: opts.timeoutSeconds ?? 3600,
      TransportType: 0,
    }),
  });
  if (!res.ok) throw new Error(`Proof create failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<CreateProofTransactionResponse>;
}

export async function createVerifiedTransaction(opts: {
  accountNumber: string;
  timeoutSeconds?: number;
}): Promise<CreateVerifiedTransactionResponse> {
  const res = await authedFetch(TRANSACTIONS_PATH, {
    method: "POST",
    body: JSON.stringify({
      AccountNumber: opts.accountNumber,
      Name: "Verify_Identity",
      Timeout: opts.timeoutSeconds ?? 3600,
      ConfirmationPolicy: {
        TransportType: 0,
        CredentialType: 1,
        BioPolicy: { CheckLiveness: true },
      },
    }),
  });
  if (res.status === 409) {
    throw Object.assign(new Error("AuthID account locked out"), { code: "ACCOUNT_LOCKED" });
  }
  if (!res.ok) throw new Error(`Verified create failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<CreateVerifiedTransactionResponse>;
}

export async function getOperationStatus(operationId: string): Promise<OperationStatusResponse> {
  const res = await authedFetch(`${OPERATIONS_PATH}/${operationId}/status`, { method: "GET" });
  if (!res.ok) throw new Error(`Status fetch failed: ${res.status}`);
  return res.json() as Promise<OperationStatusResponse>;
}

export async function getProofResult(operationId: string): Promise<ProofResultRaw> {
  const res = await authedFetch(`${OPERATIONS_PATH}/${operationId}/result`, { method: "GET" });
  if (!res.ok) throw new Error(`Result fetch failed: ${res.status}`);
  return res.json() as Promise<ProofResultRaw>;
}

export function buildProofEmbedUrl(operationId: string, oneTimeSecret: string): string {
  return `${BASE_URL}/?i=${encodeURIComponent(operationId)}&s=${encodeURIComponent(oneTimeSecret)}`;
}

export function buildVerifiedEmbedUrl(transactionId: string, oneTimeSecret: string): string {
  return `${BASE_URL}/?t=${encodeURIComponent(transactionId)}&s=${encodeURIComponent(oneTimeSecret)}`;
}
