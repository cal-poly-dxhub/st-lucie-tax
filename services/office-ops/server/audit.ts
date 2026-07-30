import type { Request } from "express";
import { pool } from "./db.js";

export interface AuditEvent {
  action: "create" | "update" | "delete";
  entityType: string;
  entityId?: string | number | null;
  details?: Record<string, unknown>;
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
        event.details ? JSON.stringify(event.details) : "{}",
      ],
    );
  } catch (err) {
    // Audit logging should never break the main request flow
    console.error("Audit log write failed:", err);
  }
}
