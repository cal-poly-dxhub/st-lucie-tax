/**
 * List every session METADATA item, optionally enriched with feedback counts.
 *
 * Strategy:
 *   1. Scan with FilterExpression entityType = 'SESSION' to surface every
 *      METADATA row.
 *   2. For each, fire a `query(SK begins_with FEEDBACK#)` in parallel batches
 *      so a session table can render badges without a second click.
 *   3. Apply optional filter chips in memory (beta volume tolerates this).
 *
 * No pagination at MVP — the chatbot beta is small enough that returning
 * every session per call is fine. Cursor support is reserved in the response
 * shape so we can wire it later without a breaking change.
 */

import { query, getDocClient, getTableName } from "@st-lucie/data-access";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

export type SessionRow = {
  sessionId: string;
  currentState: string;
  channel: string;
  createdAt: string;
  updatedAt: string;
  betaTesterEmail?: string;
  isTestSession?: boolean;
  reviewed?: boolean;
  activeTxnTypeIds: string[];
  feedbackBadges: { good: number; bad: number; comment: number; submission: number } | null;
};

export interface ListSessionsOptions {
  limit?: number;
  hasFeedback?: boolean;
  hasBad?: boolean;
  hasSubmission?: boolean;
  state?: string;
  email?: string;
  /**
   * When true, INCLUDE flagged test sessions in the response. Default false
   * (matching the dashboard default toggle position) — the admin filter
   * hides Playwright/curl probes from the tester triage view unless
   * explicitly toggled on.
   */
  includeTestSessions?: boolean;
}

const TENANT_ID = process.env.TENANT_ID || "stlucie";

interface MetadataItem {
  PK: string;
  SK: string;
  entityType: string;
  sessionId?: string;
  currentState?: string;
  channel?: string;
  createdAt?: string;
  updatedAt?: string;
  betaTesterEmail?: string;
  isTestSession?: boolean;
  reviewed?: boolean;
  structuredContext?: { transactions?: Array<{ txnTypeId: string; status: string }> };
}

export async function listSessions(
  opts: ListSessionsOptions = {},
): Promise<{ items: SessionRow[] }> {
  const docClient = getDocClient();
  const tableName = getTableName();

  const items: MetadataItem[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } =
      await docClient.send(
        new ScanCommand({
          TableName: tableName,
          FilterExpression: "entityType = :et AND SK = :sk",
          ExpressionAttributeValues: { ":et": "SESSION", ":sk": "METADATA" },
          ExclusiveStartKey: lastKey,
        }),
      );
    if (r.Items) items.push(...(r.Items as unknown as MetadataItem[]));
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  // Enrich with feedback counts in parallel batches of 10.
  const rows: SessionRow[] = [];
  const BATCH = 10;
  for (let i = 0; i < items.length; i += BATCH) {
    const slice = items.slice(i, i + BATCH);
    const batch = await Promise.allSettled(
      slice.map(async (it) => {
        const sessionId = it.sessionId ?? extractSessionIdFromPk(it.PK);
        if (!sessionId) return null;
        let badges: SessionRow["feedbackBadges"] = { good: 0, bad: 0, comment: 0, submission: 0 };
        // Fallback email lookup — the SESSION row sometimes lands without
        // a betaTesterEmail (the auth token didn't fully attach on the
        // create-session call), but FEEDBACK#SUBMISSION rows carry the
        // email pulled from req.betaEmail at submit time. Use whichever we
        // can find as a backstop so the dashboard always shows who owned
        // the session.
        let fallbackEmail: string | undefined;
        try {
          const fb = await query(TENANT_ID, "SESSION", sessionId, "FEEDBACK#");
          for (const f of fb) {
            const sk = String(f.SK);
            if (sk.startsWith("FEEDBACK#MESSAGE#")) {
              if (sk.endsWith("#good")) badges.good += 1;
              else if (sk.endsWith("#bad")) badges.bad += 1;
              else if (sk.endsWith("#comment")) badges.comment += 1;
            } else if (sk.startsWith("FEEDBACK#SUBMISSION#")) {
              badges.submission += 1;
            }
            if (!fallbackEmail && typeof f.betaTesterEmail === "string" && f.betaTesterEmail) {
              fallbackEmail = f.betaTesterEmail;
            }
          }
        } catch (e) {
          // Surface as null badges so the row still renders.

          console.warn(`feedback enrichment failed for ${sessionId}:`, e);
          badges = null;
        }
        const txns = it.structuredContext?.transactions ?? [];
        const row: SessionRow = {
          sessionId,
          currentState: it.currentState ?? "unknown",
          channel: it.channel ?? "web",
          createdAt: it.createdAt ?? "",
          updatedAt: it.updatedAt ?? "",
          betaTesterEmail: it.betaTesterEmail ?? fallbackEmail,
          isTestSession: it.isTestSession === true ? true : undefined,
          reviewed: it.reviewed === true ? true : undefined,
          activeTxnTypeIds: txns.filter((t) => t.status === "active").map((t) => t.txnTypeId),
          feedbackBadges: badges,
        };
        return row;
      }),
    );
    for (const p of batch) {
      if (p.status === "fulfilled" && p.value) rows.push(p.value);
    }
  }

  // Filter chips in memory.
  let filtered = rows;
  // Hide test sessions by default. Caller must opt in via includeTestSessions
  // to see Playwright probes / curl smoke checks alongside real testers.
  if (!opts.includeTestSessions) {
    filtered = filtered.filter((r) => r.isTestSession !== true);
  }
  if (opts.hasFeedback) {
    filtered = filtered.filter(
      (r) =>
        r.feedbackBadges &&
        r.feedbackBadges.good +
          r.feedbackBadges.bad +
          r.feedbackBadges.comment +
          r.feedbackBadges.submission >
          0,
    );
  }
  if (opts.hasBad) {
    filtered = filtered.filter((r) => r.feedbackBadges && r.feedbackBadges.bad > 0);
  }
  if (opts.hasSubmission) {
    filtered = filtered.filter((r) => r.feedbackBadges && r.feedbackBadges.submission > 0);
  }
  if (opts.state) {
    filtered = filtered.filter((r) => r.currentState === opts.state);
  }
  if (opts.email) {
    const e = opts.email.trim().toLowerCase();
    filtered = filtered.filter((r) => r.betaTesterEmail?.toLowerCase().includes(e));
  }

  filtered.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const limit = opts.limit ?? 200;
  return { items: filtered.slice(0, limit) };
}

function extractSessionIdFromPk(pk: string): string | null {
  // PK shape: TENANT#stlucie#SESSION#<uuid>
  const parts = pk.split("#");
  if (parts.length < 4) return null;
  return parts[3] ?? null;
}
