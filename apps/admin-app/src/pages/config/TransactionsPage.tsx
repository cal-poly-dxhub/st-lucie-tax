import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Check,
  Field,
  InlineInput,
  Input,
  Select,
  StatusMatrix,
  Table,
  TBody,
  TD,
  TEmpty,
  TH,
  THead,
  TR,
  type CellState,
  type CellStatus,
  type StatusMatrixAxis,
  type TimeBounds,
} from "@st-lucie/ui";
import {
  createTransactionType,
  deleteTransactionType,
  deleteTxnOfficeOverride,
  fetchTransactionFlows,
  fetchTransactionTypes,
  fetchTxnOfficeMatrix,
  setTxnOfficeOverride,
  updateTransactionType,
  type TransactionFlow,
  type TransactionType,
  type TxnOfficeMatrix,
} from "@/config-api";
import { useResource } from "./use-resource";
import { DeleteButton, ErrorBanner, Section, Spinner } from "./parts";

interface Data {
  txnTypes: TransactionType[];
  matrix: TxnOfficeMatrix;
  flows: TransactionFlow[];
}

export function TransactionsPage() {
  const load = useCallback(async (): Promise<Data> => {
    const [txnTypes, matrix, flows] = await Promise.all([
      fetchTransactionTypes(),
      fetchTxnOfficeMatrix(),
      fetchTransactionFlows(),
    ]);
    return { txnTypes, matrix, flows };
  }, []);

  const { data, error, loading, saving, mutate } = useResource<Data>(load);

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;
  if (!data) return null;

  return (
    <div className="flex flex-col gap-5">
      <TypesSection txnTypes={data.txnTypes} saving={saving} mutate={mutate} />
      <AvailabilitySection matrix={data.matrix} saving={saving} mutate={mutate} />
      <FlowsSection flows={data.flows} />
    </div>
  );
}

type Mutate = (action: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;

// ─── Transaction types ───────────────────────────────────────────────────────

function TypesSection({
  txnTypes,
  saving,
  mutate,
}: {
  txnTypes: TransactionType[];
  saving: boolean;
  mutate: Mutate;
}) {
  const [editing, setEditing] = useState<Record<number, Partial<TransactionType>>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [newSlug, setNewSlug] = useState("");
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newDescription, setNewDescription] = useState("");

  // Only global rows are editable here; per-office rows are overrides managed by
  // the availability matrix below.
  const globalTxns = useMemo(() => txnTypes.filter((t) => t.office_id === null), [txnTypes]);

  const draft = (t: TransactionType) => ({ ...t, ...editing[t.id] });
  const isDirty = (t: TransactionType) => editing[t.id] !== undefined;

  function edit(id: number, patch: Partial<TransactionType>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function discard(id: number) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function save(t: TransactionType) {
    const d = draft(t);
    const ok = await mutate(
      () =>
        updateTransactionType(t.id, {
          name: d.name,
          description: d.description ?? undefined,
          avgDurationMin: Number(d.avg_duration_min),
          status: d.status,
          availableFrom: d.available_from,
          availableUntil: d.available_until,
          isOnlineEligible: d.is_online_eligible,
          onlineRedirectUrl: d.online_redirect_url,
        }),
      "Transaction saved.",
    );
    if (ok) discard(t.id);
  }

  async function add() {
    const ok = await mutate(
      () =>
        createTransactionType({
          txnTypeId: newSlug.trim(),
          name: newName.trim(),
          avgDurationMin: Number(newDuration),
          description: newDescription.trim() || undefined,
        }),
      "Transaction created.",
    );
    if (ok) {
      setNewSlug("");
      setNewName("");
      setNewDuration("");
      setNewDescription("");
    }
  }

  return (
    <>
      <Section
        title="Transaction types"
        description="Average duration drives how long a booked block is. Online-eligible transactions send citizens to the redirect URL instead of booking a visit."
      >
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Name</TH>
              <TH className="w-44">ID</TH>
              <TH className="w-20">Min</TH>
              <TH className="w-28">Status</TH>
              <TH className="w-20" align="center">
                Online
              </TH>
              <TH>Redirect URL</TH>
              <TH align="right" className="w-48" />
            </TR>
          </THead>
          <TBody>
            {globalTxns.length === 0 ? (
              <TEmpty colSpan={7}>No transaction types configured yet.</TEmpty>
            ) : (
              globalTxns.map((t) => {
                const d = draft(t);
                return (
                  <TR key={t.id}>
                    <TD>
                      <InlineInput
                        value={d.name ?? ""}
                        onChange={(e) => edit(t.id, { name: e.target.value })}
                        aria-label="Transaction name"
                      />
                    </TD>
                    <TD className="font-mono text-xs text-civic-500">{t.txn_type_id}</TD>
                    <TD>
                      <InlineInput
                        type="number"
                        min={1}
                        value={d.avg_duration_min ?? ""}
                        onChange={(e) => edit(t.id, { avg_duration_min: Number(e.target.value) })}
                        aria-label="Average duration in minutes"
                      />
                    </TD>
                    <TD>
                      <Select
                        value={d.status ?? "active"}
                        onChange={(e) => edit(t.id, { status: e.target.value })}
                        aria-label="Status"
                        className="px-2 py-1 text-xs"
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </Select>
                    </TD>
                    <TD align="center">
                      <Check
                        checked={d.is_online_eligible ?? false}
                        onChange={(e) => edit(t.id, { is_online_eligible: e.target.checked })}
                        aria-label="Online eligible"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={d.online_redirect_url ?? ""}
                        onChange={(e) => edit(t.id, { online_redirect_url: e.target.value })}
                        placeholder="https://…"
                        aria-label="Online redirect URL"
                      />
                    </TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1">
                        {isDirty(t) && (
                          <>
                            <Button
                              variant="go"
                              disabled={saving}
                              onClick={() => save(t)}
                              className="px-2 py-1"
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={saving}
                              onClick={() => discard(t.id)}
                              className="px-2 py-1"
                            >
                              Revert
                            </Button>
                          </>
                        )}
                        <DeleteButton
                          confirming={confirmId === t.id}
                          disabled={saving}
                          onArm={() => setConfirmId(t.id)}
                          onCancel={() => setConfirmId(null)}
                          onConfirm={async () => {
                            await mutate(() => deleteTransactionType(t.id), "Transaction deleted.");
                            setConfirmId(null);
                          }}
                        />
                      </span>
                    </TD>
                  </TR>
                );
              })
            )}
          </TBody>
        </Table>
      </Section>

      <Section title="Add transaction type">
        <div className="grid max-w-5xl gap-4 sm:grid-cols-[12rem_1fr_6rem_auto] sm:items-end">
          <Field label="ID" htmlFor="tt-slug" required hint="Stable slug, e.g. dl-renewal">
            <Input
              id="tt-slug"
              value={newSlug}
              onChange={(e) => setNewSlug(e.target.value)}
              placeholder="dl-renewal"
            />
          </Field>
          <Field label="Name" htmlFor="tt-name" required>
            <Input id="tt-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="Minutes" htmlFor="tt-min" required>
            <Input
              id="tt-min"
              type="number"
              min={1}
              value={newDuration}
              onChange={(e) => setNewDuration(e.target.value)}
            />
          </Field>
          <Button
            variant="go"
            loading={saving}
            disabled={!newSlug.trim() || !newName.trim() || !newDuration}
            onClick={add}
          >
            Add
          </Button>
          <Field label="Description" htmlFor="tt-desc" className="sm:col-span-4">
            <Input
              id="tt-desc"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

// ─── Availability matrix ─────────────────────────────────────────────────────

/**
 * Per-office availability using a status-badge matrix with popover editing.
 *
 * Each cell shows the effective status (inherited from global, or overridden).
 * Clicking opens a popover to set status and time window. "Clear" removes the
 * override and returns to the global default.
 */
function AvailabilitySection({
  matrix,
  saving,
  mutate,
}: {
  matrix: TxnOfficeMatrix;
  saving: boolean;
  mutate: Mutate;
}) {
  const [busyCell, setBusyCell] = useState<string | null>(null);

  const rows: StatusMatrixAxis[] = useMemo(
    () => matrix.globalTxns.map((t) => ({ id: t.txn_type_id, label: t.name })),
    [matrix],
  );
  const cols: StatusMatrixAxis[] = useMemo(
    () => matrix.offices.map((o) => ({ id: String(o.id), label: o.name })),
    [matrix],
  );

  const getCell = useCallback(
    (slug: string, officeId: string): CellState => {
      const ov = matrix.overrides.find(
        (o) => o.txn_type_id === slug && String(o.office_id) === officeId,
      );
      if (ov) {
        return {
          status: ov.status as CellStatus,
          from: ov.available_from,
          until: ov.available_until,
          inherited: false,
        };
      }
      const g = matrix.globalTxns.find((t) => t.txn_type_id === slug);
      return {
        status: (g?.status ?? "active") as CellStatus,
        from: null,
        until: null,
        inherited: true,
      };
    },
    [matrix],
  );

  async function handleSave(
    slug: string,
    officeId: string,
    status: CellStatus,
    from: string | null,
    until: string | null,
  ) {
    const cell = `${slug}|${officeId}`;
    setBusyCell(cell);
    try {
      await mutate(
        () =>
          setTxnOfficeOverride({
            txnTypeId: slug,
            officeId: Number(officeId),
            status,
            availableFrom: from,
            availableUntil: until,
          }),
        "Override saved.",
      );
    } finally {
      setBusyCell(null);
    }
  }

  async function handleClear(slug: string, officeId: string) {
    const ov = matrix.overrides.find(
      (o) => o.txn_type_id === slug && String(o.office_id) === officeId,
    );
    if (!ov) return;
    const cell = `${slug}|${officeId}`;
    setBusyCell(cell);
    try {
      await mutate(() => deleteTxnOfficeOverride(ov.id), "Override cleared.");
    } finally {
      setBusyCell(null);
    }
  }

  const getTimeBounds = useCallback(
    (officeId: string): TimeBounds | null => {
      const office = matrix.offices.find((o) => String(o.id) === officeId);
      if (!office?.earliest_open || !office?.latest_close) return null;
      return { open: office.earliest_open, close: office.latest_close };
    },
    [matrix],
  );

  return (
    <Section
      title="Office availability"
      description="Click any cell to customize. Dashed badges inherit the global setting — click to create an office-specific override."
    >
      <StatusMatrix
        rows={rows}
        cols={cols}
        rowHeader="Transaction"
        emptyMessage="Add a transaction type and an office to configure availability."
        getCell={getCell}
        getTimeBounds={getTimeBounds}
        onSave={handleSave}
        onClear={handleClear}
        isBusy={(slug, officeId) => busyCell === `${slug}|${officeId}`}
      />
    </Section>
  );
}

// ─── Decision-tree viewer ────────────────────────────────────────────────────

interface TreeBranch {
  when?: Record<string, unknown>;
  note?: string;
  addItems?: string[];
  removeItems?: string[];
  sourceRefs?: string[];
}

interface TreeSteps {
  baseItems?: string[];
  factsRequired?: string[];
  branches?: TreeBranch[];
}

const asTree = (steps: unknown): TreeSteps =>
  steps && typeof steps === "object" ? (steps as TreeSteps) : {};

/**
 * Read-only view of each transaction's decision tree.
 *
 * These trees are the chatbot's authoritative source for required documents and
 * are generated from `services/chatbot/src/data/decision-trees/*.json`. The
 * write route replaces the whole `steps` column, so editing here would destroy
 * `factsRequired` and `branches` — hence display only.
 */
function FlowsSection({ flows }: { flows: TransactionFlow[] }) {
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <Section
      title="Decision trees"
      description="Read-only. The chatbot uses these to decide which documents a citizen must bring. They are generated from the decision-tree source files, so edit them there, not here."
    >
      {flows.length === 0 ? (
        <p className="py-8 text-center text-sm text-civic-400">No decision trees loaded.</p>
      ) : (
        <div className="flex flex-col divide-y divide-civic-50">
          {flows.map((f) => {
            const tree = asTree(f.steps);
            const open = openId === f.id;
            return (
              <div key={f.id} className="py-2">
                <button
                  onClick={() => setOpenId(open ? null : f.id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-civic-50"
                >
                  <span className="text-civic-400" aria-hidden>
                    {open ? "▾" : "▸"}
                  </span>
                  <span className="font-medium text-civic-800">{f.txn_name}</span>
                  <span className="font-mono text-xs text-civic-400">{f.slug}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <Badge tone="civic">{tree.baseItems?.length ?? 0} base docs</Badge>
                    <Badge tone="neutral">{tree.branches?.length ?? 0} branches</Badge>
                  </span>
                </button>

                {open && (
                  <div className="flex flex-col gap-4 px-2 pb-4 pt-2 text-sm">
                    <TreeList title="Always required" items={tree.baseItems ?? []} mono />
                    <TreeList
                      title="Facts the chatbot asks about"
                      items={tree.factsRequired ?? []}
                      mono
                    />

                    <div>
                      <h4 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-civic-400">
                        Conditional branches
                      </h4>
                      {(tree.branches ?? []).length === 0 ? (
                        <p className="text-civic-400">No conditional branches.</p>
                      ) : (
                        <ul className="flex flex-col gap-3">
                          {(tree.branches ?? []).map((b, i) => (
                            <li
                              key={i}
                              className="rounded-lg border border-civic-100 bg-civic-50/40 p-3"
                            >
                              <div className="font-mono text-xs text-civic-600">
                                when{" "}
                                {Object.entries(b.when ?? {})
                                  .map(([k, v]) => `${k} = ${String(v)}`)
                                  .join(" and ") || "—"}
                              </div>
                              {b.addItems?.length ? (
                                <div className="mt-1 text-go-700">
                                  add: <span className="font-mono">{b.addItems.join(", ")}</span>
                                </div>
                              ) : null}
                              {b.removeItems?.length ? (
                                <div className="mt-1 text-stop-700">
                                  remove:{" "}
                                  <span className="font-mono">{b.removeItems.join(", ")}</span>
                                </div>
                              ) : null}
                              {b.note && <p className="mt-2 text-civic-600">{b.note}</p>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Section>
  );
}

function TreeList({ title, items, mono }: { title: string; items: string[]; mono?: boolean }) {
  return (
    <div>
      <h4 className="mb-2 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-civic-400">
        {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-civic-400">None.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map((it) => (
            <li
              key={it}
              className={`rounded-md bg-civic-950/5 px-2 py-0.5 text-xs text-civic-700 ${
                mono ? "font-mono" : ""
              }`}
            >
              {it}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
