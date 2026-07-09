export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
}

export function camelRows<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()), v]),
      ) as T,
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
