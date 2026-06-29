/**
 * Roll up dashboard summary numbers in a single Scan pass.
 *
 * Counts every entityType bucket (SESSION, FEEDBACK*, etc.) and builds a
 * recent-activity feed for the home page. Results are cached in module
 * scope for SUMMARY_TTL_MS — the dashboard auto-refreshes every 60s, so
 * a 30s TTL absorbs the periodic refresh without slamming Dynamo.
 */

import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { getDocClient, getTableName } from "@st-lucie/data-access";

export interface ActivityEvent {
  kind: "session.created" | "feedback.message" | "feedback.submission";
  sessionId: string;
  at: string;
  detail?: string;
}

export interface Summary {
  generatedAt: string;
  sessionCounts: { today: number; last7d: number; total: number };
  stateBreakdown: Record<string, number>;
  feedback: {
    good: number;
    bad: number;
    comment: number;
    submissions: number;
    sessionsWithAny: number;
  };
  recentActivity: ActivityEvent[];
  /**
   * Last 10 freeform tester comments — both per-message comments AND
   * transcript-submission notes. Newest first. Empty when nothing has
   * carried text yet.
   */
  recentComments: RecentComment[];
}

export interface RecentComment {
  kind: "message-comment" | "submission-notes";
  sessionId: string;
  at: string;
  text: string;
  betaTesterEmail?: string;
}

const SUMMARY_TTL_MS = 30_000;

let cached: { at: number; value: Summary } | null = null;

export async function getSummary(force = false): Promise<Summary> {
  if (!force && cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
    return cached.value;
  }

  const docClient = getDocClient();
  const tableName = getTableName();

  const items: Array<Record<string, unknown>> = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const r: { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> } =
      await docClient.send(
        new ScanCommand({
          TableName: tableName,
          // `comment` is reserved-word-ish in DDB expressions in some shapes;
          // alias it to be safe alongside `notes`.
          ProjectionExpression:
            "PK, SK, entityType, currentState, createdAt, updatedAt, capturedAt, submittedAt, reaction, betaTesterEmail, notes, #c",
          ExpressionAttributeNames: { "#c": "comment" },
          ExclusiveStartKey: lastKey,
        }),
      );
    if (r.Items) items.push(...r.Items);
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);

  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

  let total = 0;
  let today = 0;
  let last7d = 0;
  const stateBreakdown: Record<string, number> = {};
  let good = 0;
  let bad = 0;
  let comment = 0;
  let submissions = 0;
  const sessionsWithFeedback = new Set<string>();
  const events: ActivityEvent[] = [];
  const comments: RecentComment[] = [];

  for (const it of items) {
    const sk = String(it.SK ?? "");
    const entityType = String(it.entityType ?? "");
    const pk = String(it.PK ?? "");

    if (entityType === "SESSION" && sk === "METADATA") {
      total += 1;
      const created = String(it.createdAt ?? "");
      const createdMs = Date.parse(created || "") || 0;
      if (createdMs >= todayStart.getTime()) today += 1;
      if (createdMs >= sevenDaysAgo) last7d += 1;
      const state = String(it.currentState ?? "unknown");
      stateBreakdown[state] = (stateBreakdown[state] ?? 0) + 1;
      const sid = sessionIdFromPk(pk);
      if (sid) {
        events.push({
          kind: "session.created",
          sessionId: sid,
          at: created,
          detail: state,
        });
      }
    } else if (sk.startsWith("FEEDBACK#MESSAGE#")) {
      const reaction = String(it.reaction ?? "");
      if (reaction === "good") good += 1;
      else if (reaction === "bad") bad += 1;
      else if (reaction === "comment") comment += 1;
      const sid = sessionIdFromPk(pk);
      if (sid) {
        sessionsWithFeedback.add(sid);
        events.push({
          kind: "feedback.message",
          sessionId: sid,
          at: String(it.submittedAt ?? ""),
          detail: reaction,
        });
        const text = typeof it.comment === "string" ? it.comment.trim() : "";
        if (text) {
          comments.push({
            kind: "message-comment",
            sessionId: sid,
            at: String(it.submittedAt ?? ""),
            text,
            betaTesterEmail:
              typeof it.betaTesterEmail === "string" ? it.betaTesterEmail : undefined,
          });
        }
      }
    } else if (sk.startsWith("FEEDBACK#SUBMISSION#")) {
      submissions += 1;
      const sid = sessionIdFromPk(pk);
      if (sid) {
        sessionsWithFeedback.add(sid);
        const note = typeof it.notes === "string" ? it.notes : "";
        events.push({
          kind: "feedback.submission",
          sessionId: sid,
          at: String(it.capturedAt ?? sk.slice("FEEDBACK#SUBMISSION#".length)),
          detail: note.slice(0, 80),
        });
        const text = note.trim();
        if (text) {
          comments.push({
            kind: "submission-notes",
            sessionId: sid,
            at: String(it.capturedAt ?? sk.slice("FEEDBACK#SUBMISSION#".length)),
            text,
            betaTesterEmail:
              typeof it.betaTesterEmail === "string" ? it.betaTesterEmail : undefined,
          });
        }
      }
    }
  }

  events.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
  comments.sort((a, b) => (b.at || "").localeCompare(a.at || ""));

  const summary: Summary = {
    generatedAt: new Date().toISOString(),
    sessionCounts: { today, last7d, total },
    stateBreakdown,
    feedback: {
      good,
      bad,
      comment,
      submissions,
      sessionsWithAny: sessionsWithFeedback.size,
    },
    recentActivity: events.slice(0, 25),
    recentComments: comments.slice(0, 10),
  };

  cached = { at: Date.now(), value: summary };
  return summary;
}

function sessionIdFromPk(pk: string): string | null {
  const parts = pk.split("#");
  if (parts.length < 4) return null;
  return parts[3] ?? null;
}
