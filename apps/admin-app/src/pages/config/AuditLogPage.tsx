import { useCallback, useState } from "react";
import { Badge, Button, Select, Table, TBody, TD, TEmpty, TH, THead, TR } from "@st-lucie/ui";
import { fetchAuditLog, type AuditLogResponse } from "@/config-api";
import { useResource } from "./use-resource";
import { ErrorBanner, Section, Spinner } from "./parts";

const ENTITY_TYPES = [
  "",
  "office",
  "office_hours",
  "lunch_shift",
  "transaction_type",
  "clerk",
  "clerk_skills",
  "hotbutton",
  "prescreen_question",
  "clerk_schedules",
  "decision_tree",
];

const PAGE_SIZE = 50;

function actionBadgeTone(action: string): "go" | "warn" | "neutral" {
  switch (action) {
    case "create":
      return "go";
    case "delete":
      return "warn";
    default:
      return "neutral";
  }
}

export function AuditLogPage() {
  const [entityFilter, setEntityFilter] = useState("");
  const [page, setPage] = useState(0);

  const load = useCallback(
    () =>
      fetchAuditLog({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        entityType: entityFilter || undefined,
      }),
    [entityFilter, page],
  );

  const { data, error, loading } = useResource<AuditLogResponse>(load);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const { entries, total } = data;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Audit log"
        description="History of administrative configuration changes. Entries are recorded automatically on every create, update, or delete."
      >
        {/* Filters */}
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Select
            aria-label="Filter by entity type"
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPES.filter(Boolean).map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </Select>

          <span className="text-xs text-civic-400">
            {total} {total === 1 ? "entry" : "entries"}
          </span>
        </div>

        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-40">Time</TH>
              <TH className="w-44">User</TH>
              <TH className="w-20">Action</TH>
              <TH className="w-36">Entity</TH>
              <TH className="w-16">ID</TH>
              <TH>Details</TH>
            </TR>
          </THead>
          <TBody>
            {entries.length === 0 ? (
              <TEmpty colSpan={6}>No audit log entries found.</TEmpty>
            ) : (
              entries.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap text-xs text-civic-500">
                    {new Date(e.created_at).toLocaleString()}
                  </TD>
                  <TD className="text-xs">{e.user_email}</TD>
                  <TD>
                    <Badge tone={actionBadgeTone(e.action)}>{e.action}</Badge>
                  </TD>
                  <TD className="text-xs">{e.entity_type.replace(/_/g, " ")}</TD>
                  <TD className="font-mono text-xs text-civic-500">{e.entity_id ?? "—"}</TD>
                  <TD className="max-w-xs truncate text-xs text-civic-500">
                    {Object.keys(e.details).length > 0
                      ? JSON.stringify(e.details).slice(0, 120)
                      : "—"}
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <Button variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              ← Previous
            </Button>
            <span className="text-xs text-civic-500">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
