/**
 * TTL helpers for PII data retention.
 * Per spec: NFR-DATA-03 — 30 days for PII, 3 years for general correspondence.
 */

const SECONDS_PER_DAY = 86400;
const PII_RETENTION_DAYS = 30;
const GENERAL_RETENTION_DAYS = 365 * 3; // 3 years

export function piiTtl(): number {
  return Math.floor(Date.now() / 1000) + PII_RETENTION_DAYS * SECONDS_PER_DAY;
}

export function generalRetentionTtl(): number {
  return Math.floor(Date.now() / 1000) + GENERAL_RETENTION_DAYS * SECONDS_PER_DAY;
}

export function customTtlDays(days: number): number {
  return Math.floor(Date.now() / 1000) + days * SECONDS_PER_DAY;
}
