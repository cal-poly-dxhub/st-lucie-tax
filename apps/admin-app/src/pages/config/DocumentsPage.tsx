import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Field,
  InlineInput,
  Input,
  Table,
  TBody,
  TD,
  TEmpty,
  TH,
  THead,
  TR,
} from "@st-lucie/ui";
import {
  createDocument,
  deleteDocument,
  fetchDocumentRegistry,
  fetchTransactionFlows,
  updateDocument,
  type DocumentRegistryEntry,
  type TransactionFlow,
} from "@/config-api";
import { useResource } from "./use-resource";
import { DeleteButton, ErrorBanner, Section, Spinner } from "./parts";
import { useSortableTable } from "@/hooks/useSortableTable";
import { SortableTH } from "@/components/SortableTH";

interface Data {
  docs: DocumentRegistryEntry[];
  flows: TransactionFlow[];
}

interface TreeBranch {
  addItems?: string[];
  removeItems?: string[];
}

interface TreeSteps {
  baseItems?: string[];
  branches?: TreeBranch[];
}

const asTree = (steps: unknown): TreeSteps =>
  steps && typeof steps === "object" ? (steps as TreeSteps) : {};

export function DocumentsPage() {
  const load = useCallback(async (): Promise<Data> => {
    const [docs, flows] = await Promise.all([fetchDocumentRegistry(), fetchTransactionFlows()]);
    return { docs, flows };
  }, []);

  const { data, error, loading, saving, mutate } = useResource<Data>(load);

  const [editing, setEditing] = useState<Record<string, Partial<DocumentRegistryEntry>>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAlternatives, setNewAlternatives] = useState("");

  const docs = data?.docs ?? [];

  const { sortCol, sortDir, toggle, sorted } = useSortableTable("doc_id");
  const sortedDocs = sorted(docs, {
    doc_id: (d) => d.doc_id,
    name: (d) => d.name,
    description: (d) => d.description,
    alternatives: (d) => d.alternatives?.join(", "),
  });

  const draft = (d: DocumentRegistryEntry) => ({ ...d, ...editing[d.doc_id] });
  const isDirty = (d: DocumentRegistryEntry) => editing[d.doc_id] !== undefined;

  function edit(docId: string, patch: Partial<DocumentRegistryEntry>) {
    setEditing((prev) => ({ ...prev, [docId]: { ...prev[docId], ...patch } }));
  }

  function discard(docId: string) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[docId];
      return next;
    });
  }

  async function save(d: DocumentRegistryEntry) {
    const v = draft(d);
    const ok = await mutate(
      () =>
        updateDocument(d.doc_id, {
          name: v.name,
          description: v.description ?? undefined,
          alternatives: v.alternatives,
        }),
      "Document saved.",
    );
    if (ok) discard(d.doc_id);
  }

  async function add() {
    const alternatives = newAlternatives
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    const ok = await mutate(
      () =>
        createDocument({
          docId: newId.trim(),
          name: newName.trim(),
          description: newDescription.trim() || undefined,
          alternatives: alternatives.length ? alternatives : undefined,
        }),
      "Document created.",
    );
    if (ok) {
      setNewId("");
      setNewName("");
      setNewDescription("");
      setNewAlternatives("");
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Document registry"
        description="The catalog of documents a citizen can be asked to bring. Alternatives are accepted in place of the primary document."
      >
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <SortableTH column="doc_id" currentColumn={sortCol} direction={sortDir} onToggle={toggle} className="w-56">ID</SortableTH>
              <SortableTH column="name" currentColumn={sortCol} direction={sortDir} onToggle={toggle}>Name</SortableTH>
              <SortableTH column="description" currentColumn={sortCol} direction={sortDir} onToggle={toggle}>Description</SortableTH>
              <SortableTH column="alternatives" currentColumn={sortCol} direction={sortDir} onToggle={toggle}>Alternatives</SortableTH>
              <TH align="right" className="w-48" />
            </TR>
          </THead>
          <TBody>
            {sortedDocs.length === 0 ? (
              <TEmpty colSpan={5}>No documents in the registry yet.</TEmpty>
            ) : (
              sortedDocs.map((d) => {
                const v = draft(d);
                return (
                  <TR key={d.doc_id}>
                    <TD className="font-mono text-xs text-civic-500">{d.doc_id}</TD>
                    <TD>
                      <InlineInput
                        value={v.name ?? ""}
                        onChange={(e) => edit(d.doc_id, { name: e.target.value })}
                        aria-label="Document name"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={v.description ?? ""}
                        onChange={(e) => edit(d.doc_id, { description: e.target.value })}
                        aria-label="Description"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={(v.alternatives ?? []).join(", ")}
                        onChange={(e) =>
                          edit(d.doc_id, {
                            alternatives: e.target.value
                              .split(",")
                              .map((a) => a.trim())
                              .filter(Boolean),
                          })
                        }
                        placeholder="comma separated doc ids"
                        aria-label="Alternatives"
                        className="font-mono text-xs"
                      />
                    </TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1">
                        {isDirty(d) && (
                          <>
                            <Button
                              variant="go"
                              disabled={saving}
                              onClick={() => save(d)}
                              className="px-2 py-1"
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={saving}
                              onClick={() => discard(d.doc_id)}
                              className="px-2 py-1"
                            >
                              Revert
                            </Button>
                          </>
                        )}
                        <DeleteButton
                          confirming={confirmId === d.doc_id}
                          disabled={saving}
                          onArm={() => setConfirmId(d.doc_id)}
                          onCancel={() => setConfirmId(null)}
                          onConfirm={async () => {
                            await mutate(() => deleteDocument(d.doc_id), "Document deleted.");
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

      <Section title="Add document">
        <div className="grid max-w-5xl gap-4 sm:grid-cols-[14rem_1fr_auto] sm:items-end">
          <Field label="ID" htmlFor="doc-id" required hint="Stable slug, e.g. fl-insurance-proof">
            <Input
              id="doc-id"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="fl-insurance-proof"
            />
          </Field>
          <Field label="Name" htmlFor="doc-name" required>
            <Input id="doc-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Button
            variant="go"
            loading={saving}
            disabled={!newId.trim() || !newName.trim()}
            onClick={add}
          >
            Add
          </Button>
          <Field label="Description" htmlFor="doc-desc" className="sm:col-span-2">
            <Input
              id="doc-desc"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
            />
          </Field>
          <Field
            label="Alternatives"
            htmlFor="doc-alts"
            hint="Comma-separated document IDs"
            className="sm:col-span-3"
          >
            <Input
              id="doc-alts"
              value={newAlternatives}
              onChange={(e) => setNewAlternatives(e.target.value)}
            />
          </Field>
        </div>
      </Section>

      <TransactionDocuments docs={docs} flows={data?.flows ?? []} />
    </div>
  );
}

/**
 * Which documents each transaction requires — read-only.
 *
 * Requirements live in the chatbot's decision trees, not in a join table: the
 * always-required set is the tree's `baseItems`, and branches add or remove
 * documents based on the citizen's answers. Editing them here is not offered
 * because the only write route replaces the entire `steps` column, which would
 * destroy the branch logic. Change the decision-tree source files instead.
 */
function TransactionDocuments({
  docs,
  flows,
}: {
  docs: DocumentRegistryEntry[];
  flows: TransactionFlow[];
}) {
  const nameOf = useMemo(() => {
    const m = new Map(docs.map((d) => [d.doc_id, d.name]));
    return (docId: string) => m.get(docId) ?? docId;
  }, [docs]);

  /** Documents reachable only through a branch, not required of everyone. */
  const conditionalItems = (tree: TreeSteps) => {
    const base = new Set(tree.baseItems ?? []);
    const out = new Set<string>();
    for (const b of tree.branches ?? []) {
      for (const item of b.addItems ?? []) if (!base.has(item)) out.add(item);
    }
    return [...out];
  };

  return (
    <Section
      title="Required documents by transaction"
      description="Read-only. Requirements come from the chatbot's decision trees — edit them in the decision-tree source files, not here."
    >
      {flows.length === 0 ? (
        <p className="py-8 text-center text-sm text-civic-400">No decision trees loaded.</p>
      ) : (
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Transaction</TH>
              <TH>Always required</TH>
              <TH>Possible, depending on answers</TH>
            </TR>
          </THead>
          <TBody>
            {flows.map((f) => {
              const tree = asTree(f.steps);
              const base = tree.baseItems ?? [];
              const conditional = conditionalItems(tree);
              return (
                <TR key={f.id}>
                  <TD className="align-top">
                    <div className="font-medium text-civic-800">{f.txn_name}</div>
                    <div className="font-mono text-xs text-civic-400">{f.slug}</div>
                  </TD>
                  <TD className="align-top">
                    {base.length === 0 ? (
                      <span className="text-sm text-civic-400">None</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {base.map((id) => (
                          <li key={id} className="text-sm text-civic-700">
                            {nameOf(id)}
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                  <TD className="align-top">
                    {conditional.length === 0 ? (
                      <span className="text-sm text-civic-400">None</span>
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {conditional.map((id) => (
                          <li key={id}>
                            <Badge tone="neutral">{nameOf(id)}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}
    </Section>
  );
}
