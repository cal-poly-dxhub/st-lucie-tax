import { useCallback, useMemo, useState } from "react";
import {
  Button,
  Field,
  InlineInput,
  Input,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from "@st-lucie/ui";
import {
  createPrescreenQuestion,
  deletePrescreenQuestion,
  fetchPrescreenQuestions,
  fetchTransactionTypes,
  updatePrescreenQuestion,
  type PrescreenQuestion,
  type TransactionType,
} from "@/config-api";
import { useResource } from "./use-resource";
import { DeleteButton, ErrorBanner, Section, Spinner } from "./parts";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTH } from "@/components/SortableTH";

interface Data {
  questions: PrescreenQuestion[];
  txnTypes: TransactionType[];
}

export function PrescreenPage() {
  const load = useCallback(async (): Promise<Data> => {
    const [questions, txnTypes] = await Promise.all([
      fetchPrescreenQuestions(),
      fetchTransactionTypes(),
    ]);
    return { questions, txnTypes };
  }, []);

  const { data, error, loading, saving, mutate } = useResource<Data>(load);
  const [editing, setEditing] = useState<Record<number, Partial<PrescreenQuestion>>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [newTxn, setNewTxn] = useState("");
  const [newText, setNewText] = useState("");
  const [newOrder, setNewOrder] = useState("");

  // Questions attach to a transaction type row; only the global rows
  // (office_id null) are meaningful targets.
  const globalTxns = useMemo(
    () => (data?.txnTypes ?? []).filter((t) => t.office_id === null),
    [data],
  );

  // Group questions under their transaction so the ordering within each
  // transaction is readable at a glance.
  const grouped = useMemo(() => {
    const m = new Map<string, PrescreenQuestion[]>();
    for (const q of data?.questions ?? []) {
      const arr = m.get(q.txn_name) ?? [];
      arr.push(q);
      m.set(q.txn_name, arr);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const draft = (q: PrescreenQuestion) => ({ ...q, ...editing[q.id] });
  const isDirty = (q: PrescreenQuestion) => editing[q.id] !== undefined;

  const { sortCol, sortDir, toggle, sorted: sortQuestions } = useSortableTable("sort_order");
  const prescreenAccessors = {
    sort_order: (q: PrescreenQuestion) => q.sort_order,
    question_text: (q: PrescreenQuestion) => q.question_text,
  };

  function edit(id: number, patch: Partial<PrescreenQuestion>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function discard(id: number) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function save(q: PrescreenQuestion) {
    const d = draft(q);
    const ok = await mutate(
      () =>
        updatePrescreenQuestion(q.id, {
          sortOrder: Number(d.sort_order),
          questionText: d.question_text,
        }),
      "Question saved.",
    );
    if (ok) discard(q.id);
  }

  async function add() {
    const order = Number(newOrder);
    const ok = await mutate(
      () =>
        createPrescreenQuestion({
          txnTypeId: Number(newTxn),
          questionText: newText.trim(),
          sortOrder: Number.isFinite(order) && newOrder !== "" ? order : undefined,
        }),
      "Question added.",
    );
    if (ok) {
      setNewText("");
      setNewOrder("");
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Pre-screen questions"
        description="Asked before a citizen books, so clerks know what to expect and citizens know what to bring."
      >
        {grouped.length === 0 ? (
          <p className="py-8 text-center text-sm text-civic-400">
            No pre-screen questions configured yet.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {grouped.map(([txnName, questions]) => (
              <div key={txnName}>
                <h3 className="mb-1 text-sm font-bold text-civic-800">{txnName}</h3>
                <Table>
                  <THead>
                    <TR className="hover:bg-transparent">
                      <SortableTH column="sort_order" currentColumn={sortCol} direction={sortDir} onToggle={toggle} className="w-20">Order</SortableTH>
                      <SortableTH column="question_text" currentColumn={sortCol} direction={sortDir} onToggle={toggle}>Question</SortableTH>
                      <TH align="right" className="w-48" />
                    </TR>
                  </THead>
                  <TBody>
                    {sortQuestions(questions, prescreenAccessors).map((q) => {
                      const d = draft(q);
                      return (
                        <TR key={q.id}>
                          <TD>
                            <InlineInput
                              type="number"
                              value={d.sort_order ?? ""}
                              onChange={(e) => edit(q.id, { sort_order: Number(e.target.value) })}
                              aria-label="Sort order"
                            />
                          </TD>
                          <TD>
                            <InlineInput
                              value={d.question_text ?? ""}
                              onChange={(e) => edit(q.id, { question_text: e.target.value })}
                              aria-label="Question text"
                            />
                          </TD>
                          <TD align="right">
                            <span className="inline-flex items-center gap-1">
                              {isDirty(q) && (
                                <>
                                  <Button
                                    variant="go"
                                    disabled={saving}
                                    onClick={() => save(q)}
                                    className="px-2 py-1"
                                  >
                                    Save
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    disabled={saving}
                                    onClick={() => discard(q.id)}
                                    className="px-2 py-1"
                                  >
                                    Revert
                                  </Button>
                                </>
                              )}
                              <DeleteButton
                                confirming={confirmId === q.id}
                                disabled={saving}
                                onArm={() => setConfirmId(q.id)}
                                onCancel={() => setConfirmId(null)}
                                onConfirm={async () => {
                                  await mutate(
                                    () => deletePrescreenQuestion(q.id),
                                    "Question deleted.",
                                  );
                                  setConfirmId(null);
                                }}
                              />
                            </span>
                          </TD>
                        </TR>
                      );
                    })}
                  </TBody>
                </Table>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Add question">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-[16rem_6rem_1fr_auto] sm:items-end">
          <Field label="Transaction" htmlFor="pq-txn" required>
            <Select id="pq-txn" value={newTxn} onChange={(e) => setNewTxn(e.target.value)}>
              <option value="">Select…</option>
              {globalTxns.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Order" htmlFor="pq-order">
            <Input
              id="pq-order"
              type="number"
              value={newOrder}
              onChange={(e) => setNewOrder(e.target.value)}
            />
          </Field>
          <Field label="Question" htmlFor="pq-text" required>
            <Input
              id="pq-text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Do you have your current title?"
            />
          </Field>
          <Button variant="go" loading={saving} disabled={!newTxn || !newText.trim()} onClick={add}>
            Add
          </Button>
        </div>
      </Section>
    </div>
  );
}
