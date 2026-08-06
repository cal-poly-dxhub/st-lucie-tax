import { useCallback, useState } from "react";
import {
  Badge,
  Button,
  Input,
  Select,
  Table,
  TBody,
  TD,
  TEmpty,
  TH,
  THead,
  TR,
} from "@st-lucie/ui";
import {
  fetchAuditLog,
  type AuditDetails,
  type AuditLogResponse,
  type AuditSnapshot,
} from "@/config-api";
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

const PAGE_SIZES = [25, 50, 100];

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

function hasChangeSnapshots(details: AuditDetails): boolean {
  return (
    Object.prototype.hasOwnProperty.call(details, "before") ||
    Object.prototype.hasOwnProperty.call(details, "after")
  );
}

function toIsoTimestamp(localDateTime: string): string | undefined {
  if (!localDateTime) return undefined;
  const date = new Date(localDateTime);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function toLocalDateTimeInput(date: Date): string {
  const localTime = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 16);
}

function createInitialAuditLogDateRange(): { startAt: string; endAt: string } {
  const endAt = new Date();
  const startAt = new Date(endAt);
  startAt.setDate(startAt.getDate() - 30);

  return {
    startAt: toLocalDateTimeInput(startAt),
    endAt: toLocalDateTimeInput(endAt),
  };
}

function isValidDateRange(startAt: string, endAt: string): boolean {
  if (!startAt || !endAt) return true;
  return new Date(startAt).getTime() < new Date(endAt).getTime();
}

function Snapshot({ label, value }: { label: string; value: AuditSnapshot | undefined }) {
  return (
    <div className="min-w-48 rounded border border-civic-100 bg-civic-50 p-2">
      <p className="mb-1 text-xs font-semibold text-civic-700">{label}</p>
      {value === null || value === undefined ? (
        <p className="text-xs text-civic-500">No value</p>
      ) : (
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-civic-600">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function AuditDetailsCell({
  action,
  entityType,
  details,
}: {
  action: string;
  entityType: string;
  details: AuditDetails;
}) {
  const deletedHotbuttonLabel =
    action === "delete" && entityType === "hotbutton" && typeof details.before?.label === "string"
      ? details.before.label
      : undefined;

  if (Object.keys(details).length === 0) {
    return action === "delete" && entityType === "hotbutton" ? (
      <span className="text-civic-400">Deleted hotbutton details were not recorded.</span>
    ) : (
      <span className="text-civic-400">—</span>
    );
  }

  const snapshots = hasChangeSnapshots(details);
  return (
    <details className="min-w-56">
      <summary className="cursor-pointer text-xs font-medium text-civic-600 hover:text-civic-800">
        {deletedHotbuttonLabel
          ? `Deleted: ${deletedHotbuttonLabel}`
          : snapshots
            ? "View change"
            : "View details"}
      </summary>
      <div className="mt-2">
        {snapshots ? (
          <div className="grid gap-2 lg:grid-cols-2">
            <Snapshot label="Before" value={details.before} />
            <Snapshot label="After" value={details.after} />
          </div>
        ) : (
          <Snapshot label="Details" value={details} />
        )}
      </div>
    </details>
  );
}

export function AuditLogPage() {
  const [entityFilter, setEntityFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dateRange, setDateRange] = useState(createInitialAuditLogDateRange);
  const [dateRangeError, setDateRangeError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(0);
  const { startAt, endAt } = dateRange;

  const resetPage = () => setPage(0);
  const updateStartAt = (nextStartAt: string) => {
    if (!isValidDateRange(nextStartAt, endAt)) {
      setDateRangeError("Start date and time must be before the end date and time.");
      return;
    }

    setDateRange((range) => ({ ...range, startAt: nextStartAt }));
    setDateRangeError(null);
    resetPage();
  };
  const updateEndAt = (nextEndAt: string) => {
    if (!isValidDateRange(startAt, nextEndAt)) {
      setDateRangeError("End date and time must be after the start date and time.");
      return;
    }

    setDateRange((range) => ({ ...range, endAt: nextEndAt }));
    setDateRangeError(null);
    resetPage();
  };
  const clearFilters = () => {
    setEntityFilter("");
    setSearch("");
    setDateRange({ startAt: "", endAt: "" });
    setDateRangeError(null);
    setPage(0);
  };

  const load = useCallback(
    () =>
      fetchAuditLog({
        limit: pageSize,
        offset: page * pageSize,
        entityType: entityFilter || undefined,
        search: search.trim() || undefined,
        startAt: toIsoTimestamp(startAt),
        endAt: toIsoTimestamp(endAt),
      }),
    [endAt, entityFilter, page, pageSize, search, startAt],
  );

  const { data, error, loading, reload } = useResource<AuditLogResponse>(load);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  const { entries, total } = data;
  const totalPages = Math.ceil(total / pageSize);
  const firstResult = total === 0 ? 0 : page * pageSize + 1;
  const lastResult = Math.min((page + 1) * pageSize, total);
  const hasFilters = entityFilter || search || startAt || endAt;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Audit log"
        description="History of administrative configuration changes. Expand an entry to review its recorded values. Date and time filters use your local time zone."
      >
        <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input
            type="search"
            aria-label="Search audit log"
            placeholder="Search user, action, entity, ID, or details"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
          />
          <Select
            aria-label="Filter by entity type"
            value={entityFilter}
            onChange={(e) => {
              setEntityFilter(e.target.value);
              resetPage();
            }}
          >
            <option value="">All entity types</option>
            {ENTITY_TYPES.filter(Boolean).map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </Select>
          <Input
            type="datetime-local"
            aria-label="Show audit entries from date and time"
            aria-describedby={dateRangeError ? "audit-log-date-range-error" : undefined}
            invalid={Boolean(dateRangeError)}
            max={endAt || undefined}
            value={startAt}
            onChange={(e) => updateStartAt(e.target.value)}
          />
          <Input
            type="datetime-local"
            aria-label="Show audit entries through date and time"
            aria-describedby={dateRangeError ? "audit-log-date-range-error" : undefined}
            invalid={Boolean(dateRangeError)}
            min={startAt || undefined}
            value={endAt}
            onChange={(e) => updateEndAt(e.target.value)}
          />
          <div className="flex gap-2">
            <Select
              aria-label="Audit log rows per page"
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                resetPage();
              }}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
            </Select>
            <Button variant="outline" onClick={reload} disabled={loading} className="shrink-0">
              Refresh
            </Button>
            {hasFilters && (
              <Button variant="outline" onClick={clearFilters} className="shrink-0">
                Clear
              </Button>
            )}
          </div>
        </div>
        {dateRangeError && (
          <p id="audit-log-date-range-error" role="alert" className="-mt-3 text-xs text-stop-600">
            {dateRangeError}
          </p>
        )}

        <p className="mb-3 text-xs text-civic-400">
          Showing {firstResult}–{lastResult} of {total} {total === 1 ? "entry" : "entries"}
        </p>

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
              entries.map((entry) => (
                <TR key={entry.id}>
                  <TD className="whitespace-nowrap text-xs text-civic-500">
                    {new Date(entry.created_at).toLocaleString()}
                  </TD>
                  <TD className="text-xs">{entry.user_email}</TD>
                  <TD>
                    <Badge tone={actionBadgeTone(entry.action)}>{entry.action}</Badge>
                  </TD>
                  <TD className="text-xs">{entry.entity_type.replace(/_/g, " ")}</TD>
                  <TD className="font-mono text-xs text-civic-500">{entry.entity_id ?? "—"}</TD>
                  <TD className="text-xs text-civic-500">
                    <AuditDetailsCell
                      action={entry.action}
                      entityType={entry.entity_type}
                      details={entry.details}
                    />
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-between">
            <Button
              variant="outline"
              disabled={page === 0}
              onClick={() => setPage((value) => value - 1)}
            >
              ← Previous
            </Button>
            <span className="text-xs text-civic-500">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((value) => value + 1)}
            >
              Next →
            </Button>
          </div>
        )}
      </Section>
    </div>
  );
}
