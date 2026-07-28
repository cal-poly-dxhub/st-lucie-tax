import { useState } from "react";
import {
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
  createHotbutton,
  deleteHotbutton,
  fetchHotbuttons,
  updateHotbutton,
  type Hotbutton,
} from "@/config-api";
import { useResource } from "./use-resource";
import { DeleteButton, ErrorBanner, Section, Spinner } from "./parts";

export function HotbuttonsPage() {
  const { data, error, loading, saving, mutate } = useResource<Hotbutton[]>(fetchHotbuttons);
  const [editing, setEditing] = useState<Record<number, Partial<Hotbutton>>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newOrder, setNewOrder] = useState("");

  const draft = (h: Hotbutton) => ({ ...h, ...editing[h.id] });
  const isDirty = (h: Hotbutton) => editing[h.id] !== undefined;

  function edit(id: number, patch: Partial<Hotbutton>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function discard(id: number) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function save(h: Hotbutton) {
    const d = draft(h);
    const ok = await mutate(
      () =>
        updateHotbutton(h.id, {
          sortOrder: Number(d.sort_order),
          label: d.label,
          prompt: d.prompt,
        }),
      "Hotbutton saved.",
    );
    if (ok) discard(h.id);
  }

  async function add() {
    const order = Number(newOrder);
    const ok = await mutate(
      () =>
        createHotbutton({
          label: newLabel.trim(),
          prompt: newPrompt.trim(),
          sortOrder: Number.isFinite(order) && newOrder !== "" ? order : undefined,
        }),
      "Hotbutton added.",
    );
    if (ok) {
      setNewLabel("");
      setNewPrompt("");
      setNewOrder("");
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  const rows = data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Hotbuttons"
        description="Suggested prompts shown to citizens as one-tap shortcuts in the chatbot. Lower sort order appears first."
      >
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH className="w-20">Order</TH>
              <TH className="w-56">Label</TH>
              <TH>Prompt</TH>
              <TH align="right" className="w-48" />
            </TR>
          </THead>
          <TBody>
            {rows.length === 0 ? (
              <TEmpty colSpan={4}>No hotbuttons configured yet.</TEmpty>
            ) : (
              rows.map((h) => {
                const d = draft(h);
                return (
                  <TR key={h.id}>
                    <TD>
                      <InlineInput
                        type="number"
                        value={d.sort_order ?? ""}
                        onChange={(e) => edit(h.id, { sort_order: Number(e.target.value) })}
                        aria-label="Sort order"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={d.label ?? ""}
                        onChange={(e) => edit(h.id, { label: e.target.value })}
                        aria-label="Label"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={d.prompt ?? ""}
                        onChange={(e) => edit(h.id, { prompt: e.target.value })}
                        aria-label="Prompt"
                      />
                    </TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1">
                        {isDirty(h) && (
                          <>
                            <Button
                              variant="go"
                              disabled={saving}
                              onClick={() => save(h)}
                              className="px-2 py-1"
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={saving}
                              onClick={() => discard(h.id)}
                              className="px-2 py-1"
                            >
                              Revert
                            </Button>
                          </>
                        )}
                        <DeleteButton
                          confirming={confirmId === h.id}
                          disabled={saving}
                          onArm={() => setConfirmId(h.id)}
                          onCancel={() => setConfirmId(null)}
                          onConfirm={async () => {
                            await mutate(() => deleteHotbutton(h.id), "Hotbutton deleted.");
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

      <Section title="Add hotbutton">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-[6rem_14rem_1fr_auto] sm:items-end">
          <Field label="Order" htmlFor="hb-order">
            <Input
              id="hb-order"
              type="number"
              value={newOrder}
              onChange={(e) => setNewOrder(e.target.value)}
            />
          </Field>
          <Field label="Label" htmlFor="hb-label" required>
            <Input
              id="hb-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Renew my registration"
            />
          </Field>
          <Field label="Prompt" htmlFor="hb-prompt" required>
            <Input
              id="hb-prompt"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="I need to renew my vehicle registration"
            />
          </Field>
          <Button
            variant="go"
            loading={saving}
            disabled={!newLabel.trim() || !newPrompt.trim()}
            onClick={add}
          >
            Add
          </Button>
        </div>
      </Section>
    </div>
  );
}
