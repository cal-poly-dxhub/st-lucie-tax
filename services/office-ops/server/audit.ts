import type { Request } from "express";
import { pool } from "./db.js";

export type AuditSnapshot = Record<string, unknown> | null;

export interface AuditEvent {
  action: "create" | "update" | "delete";
  entityType: string;
  entityId?: string | number | null;
  /** Legacy event data. New events should provide before and/or after snapshots. */
  details?: Record<string, unknown>;
  before?: AuditSnapshot;
  after?: AuditSnapshot;
}

export interface AuditLogQueryFilters {
  limit: number;
  offset: number;
  entityType?: string;
  search?: string;
  startAt?: string;
  endAt?: string;
}

/** Builds matching result and count queries for the audit-log list. */
export function buildAuditLogQueries({
  limit,
  offset,
  entityType,
  search,
  startAt,
  endAt,
}: AuditLogQueryFilters) {
  const filterParams: unknown[] = [];
  const conditions: string[] = [];
  const addCondition = (condition: (placeholder: string) => string, value: unknown) => {
    filterParams.push(value);
    conditions.push(condition(`$${filterParams.length}`));
  };

  if (entityType) addCondition((placeholder) => `entity_type = ${placeholder}`, entityType);
  if (search) {
    addCondition(
      (placeholder) =>
        `(user_email ILIKE ${placeholder} OR action ILIKE ${placeholder} OR entity_type ILIKE ${placeholder} OR entity_id ILIKE ${placeholder} OR details::text ILIKE ${placeholder})`,
      `%${search}%`,
    );
  }
  if (startAt) addCondition((placeholder) => `created_at >= ${placeholder}::timestamptz`, startAt);
  if (endAt) addCondition((placeholder) => `created_at <= ${placeholder}::timestamptz`, endAt);

  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  const countQuery = `SELECT COUNT(*)::int AS total FROM audit_log${where}`;
  const query = `SELECT id, user_email, action, entity_type, entity_id,
                        COALESCE(details, '{}'::jsonb) AS details, created_at
                 FROM audit_log${where}
                 ORDER BY created_at DESC
                 LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}`;

  return {
    query,
    params: [...filterParams, limit, offset],
    countQuery,
    countParams: filterParams,
  };
}

/**
 * Produces a consistent, JSONB-safe audit payload while retaining support for
 * legacy callers that only supply details. New update events include both
 * snapshots; creates and deletes expose the available side of the change.
 */
export function buildAuditDetails(event: AuditEvent): Record<string, unknown> {
  if (event.before !== undefined || event.after !== undefined) {
    return { before: event.before ?? null, after: event.after ?? null };
  }

  if (event.action === "create") return { before: null, after: event.details ?? {} };
  if (event.action === "delete") return { before: event.details ?? null, after: null };

  return event.details ?? {};
}

/**
 * Logs an admin action to the audit_log table.
 * Call after successful CUD operations in admin routes.
 */
export async function logAuditEvent(req: Request, event: AuditEvent): Promise<void> {
  const userEmail = req.user?.email ?? req.user?.sub ?? "unknown";
  try {
    await pool.query(
      `INSERT INTO audit_log (user_email, action, entity_type, entity_id, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        userEmail,
        event.action,
        event.entityType,
        event.entityId != null ? String(event.entityId) : null,
        JSON.stringify(buildAuditDetails(event)),
      ],
    );
  } catch (err) {
    // Audit logging should never break the main request flow
    console.error("Audit log write failed:", err);
  }
}
