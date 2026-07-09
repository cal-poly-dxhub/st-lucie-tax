import type { Response } from "express";
import { randomUUID } from "node:crypto";

export function sendError(res: Response, err: unknown, context?: string): void {
  const correlationId = randomUUID().slice(0, 8);
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ correlationId, context, error: message }));
  res.status(500).json({ error: "Internal server error", correlationId });
}
