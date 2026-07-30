import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Field,
  InlineInput,
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
  createLunchShift,
  createOffice,
  deleteLunchShift,
  deleteOffice,
  deleteOfficeHours,
  fetchOffices,
  setOfficeHours,
  updateOffice,
  type LunchShift,
  type Office,
  type OfficeHours,
  type OfficesResponse,
} from "@/config-api";
import { useResource } from "./use-resource";
import { DeleteButton, ErrorBanner, Section, Spinner } from "./parts";

const DAYS = [
  { value: 0, label: "Sundays" },
  { value: 1, label: "Mondays" },
  { value: 2, label: "Tuesdays" },
  { value: 3, label: "Wednesdays" },
  { value: 4, label: "Thursdays" },
  { value: 5, label: "Fridays" },
  { value: 6, label: "Saturdays" },
];

/** Postgres returns `time` as "09:00:00"; `<input type="time">` wants "09:00". */
const toInputTime = (t: string | null | undefined) => (t ? t.slice(0, 5) : "");

interface DayDraft {
  open: string;
  close: string;
}

/** A lunch shift as the form holds it — `id` is absent until the row is saved. */
interface LunchDraft {
  id?: number;
  start: string;
  end: string;
}

const lunchKey = (l: LunchDraft) => `${l.start}|${l.end}`;

export function OfficesPage() {
  const { data, error, loading, saving, mutate } = useResource<OfficesResponse>(fetchOffices);

  const [editing, setEditing] = useState<Record<number, Partial<Office>>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newDesks, setNewDesks] = useState("");
  const [newRunRate, setNewRunRate] = useState("");

  const offices = data?.offices ?? [];

  // The hours and lunch editors act on one office at a time — a 3-office ×
  // 7-day × 2-time grid plus lunches is unreadable all at once.
  const [officeId, setOfficeId] = useState<number | null>(null);
  useEffect(() => {
    if (officeId === null && offices.length) setOfficeId(offices[0].id);
  }, [officeId, offices]);

  const selectedHours = useMemo(
    () => (data?.hours ?? []).filter((h) => h.office_id === officeId),
    [data, officeId],
  );
  const selectedLunches = useMemo(
    () => (data?.lunches ?? []).filter((l) => l.office_id === officeId),
    [data, officeId],
  );

  // ─── Office rows ───────────────────────────────────────────────────────────
  const draft = (o: Office) => ({ ...o, ...editing[o.id] });
  const isDirty = (o: Office) => editing[o.id] !== undefined;

  function edit(id: number, patch: Partial<Office>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function discard(id: number) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  async function saveOffice(o: Office) {
    const d = draft(o);
    const ok = await mutate(
      () =>
        updateOffice(o.id, {
          name: d.name,
          address: d.address ?? undefined,
          totalDesks: Number(d.total_desks),
          runRatePct: Number(d.run_rate_pct),
        }),
      "Office saved.",
    );
    if (ok) discard(o.id);
  }

  async function addOffice() {
    const runRate = Number(newRunRate);
    const ok = await mutate(
      () =>
        createOffice({
          name: newName.trim(),
          address: newAddress.trim() || undefined,
          totalDesks: Number(newDesks),
          runRatePct: newRunRate !== "" && Number.isFinite(runRate) ? runRate : undefined,
        }),
      "Office created.",
    );
    if (ok) {
      setNewName("");
      setNewAddress("");
      setNewDesks("");
      setNewRunRate("");
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Offices"
        description="Desk count and run rate drive scheduling capacity for every transaction booked at that office."
      >
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>Name</TH>
              <TH>Address</TH>
              <TH className="w-24">Desks</TH>
              <TH className="w-28">Run rate %</TH>
              <TH align="right" className="w-48" />
            </TR>
          </THead>
          <TBody>
            {offices.length === 0 ? (
              <TEmpty colSpan={5}>No offices configured yet.</TEmpty>
            ) : (
              offices.map((o) => {
                const d = draft(o);
                return (
                  <TR key={o.id}>
                    <TD>
                      <InlineInput
                        value={d.name ?? ""}
                        onChange={(e) => edit(o.id, { name: e.target.value })}
                        aria-label="Office name"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={d.address ?? ""}
                        onChange={(e) => edit(o.id, { address: e.target.value })}
                        aria-label="Address"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        type="number"
                        min={1}
                        value={d.total_desks ?? ""}
                        onChange={(e) => edit(o.id, { total_desks: Number(e.target.value) })}
                        aria-label="Total desks"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        type="number"
                        min={1}
                        max={100}
                        value={d.run_rate_pct ?? ""}
                        onChange={(e) => edit(o.id, { run_rate_pct: Number(e.target.value) })}
                        aria-label="Run rate percent"
                      />
                    </TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1">
                        {isDirty(o) && (
                          <>
                            <Button
                              variant="go"
                              disabled={saving}
                              onClick={() => saveOffice(o)}
                              className="px-2 py-1"
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={saving}
                              onClick={() => discard(o.id)}
                              className="px-2 py-1"
                            >
                              Revert
                            </Button>
                          </>
                        )}
                        <DeleteButton
                          confirming={confirmId === o.id}
                          disabled={saving}
                          onArm={() => setConfirmId(o.id)}
                          onCancel={() => setConfirmId(null)}
                          onConfirm={async () => {
                            await mutate(() => deleteOffice(o.id), "Office deleted.");
                            setConfirmId(null);
                            if (officeId === o.id) setOfficeId(null);
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

      <Section title="Add office">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-[1fr_1fr_6rem_7rem_auto] sm:items-end">
          <Field label="Name" htmlFor="of-name" required>
            <Input id="of-name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </Field>
          <Field label="Address" htmlFor="of-address">
            <Input
              id="of-address"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
            />
          </Field>
          <Field label="Desks" htmlFor="of-desks" required>
            <Input
              id="of-desks"
              type="number"
              min={1}
              value={newDesks}
              onChange={(e) => setNewDesks(e.target.value)}
            />
          </Field>
          <Field label="Run rate %" htmlFor="of-runrate" hint="Defaults to 100">
            <Input
              id="of-runrate"
              type="number"
              min={1}
              max={100}
              value={newRunRate}
              onChange={(e) => setNewRunRate(e.target.value)}
            />
          </Field>
          <Button
            variant="go"
            loading={saving}
            disabled={!newName.trim() || !newDesks}
            onClick={addOffice}
          >
            Add
          </Button>
        </div>
      </Section>

      {officeId !== null && (
        <>
          <HoursEditor
            key={`hours-${officeId}`}
            officeId={officeId}
            offices={offices}
            hours={selectedHours}
            saving={saving}
            onSelectOffice={setOfficeId}
            mutate={mutate}
          />
          <LunchEditor
            key={`lunch-${officeId}`}
            officeId={officeId}
            lunches={selectedLunches}
            saving={saving}
            mutate={mutate}
          />
        </>
      )}
    </div>
  );
}

type Mutate = (action: () => Promise<unknown>, successMessage?: string) => Promise<boolean>;

/**
 * Weekly open/close times for one office. Saves per day: the server upserts on
 * (office_id, day_of_week), so a save is a single POST and clearing a day is a
 * DELETE of that row.
 */
function HoursEditor({
  officeId,
  offices,
  hours,
  saving,
  onSelectOffice,
  mutate,
}: {
  officeId: number;
  offices: Office[];
  hours: OfficeHours[];
  saving: boolean;
  onSelectOffice: (id: number) => void;
  mutate: Mutate;
}) {
  const serverDrafts = useMemo(() => {
    const m = new Map<number, DayDraft>();
    for (const h of hours) {
      m.set(h.day_of_week, { open: toInputTime(h.open_time), close: toInputTime(h.close_time) });
    }
    return m;
  }, [hours]);

  const [edits, setEdits] = useState<Record<number, DayDraft>>({});

  // Server rows are the baseline; only touched days carry a local draft.
  const valueFor = (day: number): DayDraft =>
    edits[day] ?? serverDrafts.get(day) ?? { open: "", close: "" };
  const rowFor = (day: number) => hours.find((h) => h.day_of_week === day);

  function edit(day: number, patch: Partial<DayDraft>) {
    setEdits((prev) => ({ ...prev, [day]: { ...valueFor(day), ...patch } }));
  }

  function discard(day: number) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[day];
      return next;
    });
  }

  async function save(day: number) {
    const v = valueFor(day);
    if (!v.open || !v.close) return;
    const ok = await mutate(
      () =>
        setOfficeHours({
          officeId,
          dayOfWeek: day,
          openTime: v.open,
          closeTime: v.close,
        }),
      "Hours saved.",
    );
    if (ok) discard(day);
  }

  return (
    <Section
      title="Office hours"
      description="Days without hours are treated as closed and never offered as appointment slots."
      actions={
        <Select
          value={officeId}
          onChange={(e) => onSelectOffice(Number(e.target.value))}
          aria-label="Office"
          className="w-56"
        >
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Select>
      }
    >
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-32">Day</TH>
            <TH className="w-36">Opens</TH>
            <TH className="w-36">Closes</TH>
            <TH align="right" className="w-48" />
          </TR>
        </THead>
        <TBody>
          {DAYS.map((day) => {
            const v = valueFor(day.value);
            const row = rowFor(day.value);
            const dirty = edits[day.value] !== undefined;
            return (
              <TR key={day.value}>
                <TD className="font-medium text-civic-800">{day.label}</TD>
                <TD>
                  <InlineInput
                    type="time"
                    value={v.open}
                    onChange={(e) => edit(day.value, { open: e.target.value })}
                    aria-label={`${day.label} opening time`}
                  />
                </TD>
                <TD>
                  <InlineInput
                    type="time"
                    value={v.close}
                    onChange={(e) => edit(day.value, { close: e.target.value })}
                    aria-label={`${day.label} closing time`}
                  />
                </TD>
                <TD align="right">
                  <span className="inline-flex items-center gap-1">
                    {dirty && (
                      <>
                        <Button
                          variant="go"
                          disabled={saving || !v.open || !v.close}
                          onClick={() => save(day.value)}
                          className="px-2 py-1"
                        >
                          Save
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={saving}
                          onClick={() => discard(day.value)}
                          className="px-2 py-1"
                        >
                          Revert
                        </Button>
                      </>
                    )}
                    {row && !dirty && (
                      <Button
                        variant="ghost"
                        disabled={saving}
                        onClick={() => mutate(() => deleteOfficeHours(row.id), "Day cleared.")}
                        className="px-2 py-1"
                      >
                        Clear
                      </Button>
                    )}
                  </span>
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </Section>
  );
}

/**
 * Lunch shifts for one office.
 *
 * Saves diff rather than delete-and-recreate: deleting a shift nulls
 * `clerk_schedules.lunch_shift_id` for every clerk assigned to it, so
 * recreating an identical row would silently unassign the whole office's
 * lunches. Only genuinely removed shifts are deleted; unchanged rows are left
 * alone.
 */
function LunchEditor({
  officeId,
  lunches,
  saving,
  mutate,
}: {
  officeId: number;
  lunches: LunchShift[];
  saving: boolean;
  mutate: Mutate;
}) {
  const serverDrafts = useMemo<LunchDraft[]>(
    () =>
      lunches.map((l) => ({
        id: l.id,
        start: toInputTime(l.start_time),
        end: toInputTime(l.end_time),
      })),
    [lunches],
  );

  const [drafts, setDrafts] = useState<LunchDraft[] | null>(null);
  const rows = drafts ?? serverDrafts;

  // Any local edit takes over the list until it is saved or reverted.
  const dirty =
    drafts !== null &&
    (drafts.length !== serverDrafts.length ||
      drafts.some((d, i) => lunchKey(d) !== lunchKey(serverDrafts[i])));

  const update = (index: number, patch: Partial<LunchDraft>) =>
    setDrafts(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const addRow = () => setDrafts([...rows, { start: "", end: "" }]);
  const removeRow = (index: number) => setDrafts(rows.filter((_, i) => i !== index));

  const save = useCallback(async () => {
    const edited = rows.filter((r) => r.start && r.end);
    const keep = new Set(edited.map(lunchKey));

    // Delete only shifts whose exact window is gone from the edited set.
    const removed = serverDrafts.filter((s) => !keep.has(lunchKey(s)));
    const existing = new Set(serverDrafts.map(lunchKey));
    const added = edited.filter((e) => !existing.has(lunchKey(e)));

    if (!removed.length && !added.length) {
      setDrafts(null);
      return;
    }

    const ok = await mutate(async () => {
      for (const r of removed) {
        if (r.id !== undefined) await deleteLunchShift(r.id);
      }
      // shift_num orders shifts within the office; number the new ones after
      // the untouched rows so the sequence stays contiguous.
      let shiftNum = serverDrafts.length - removed.length;
      for (const a of [...added].sort((x, y) => x.start.localeCompare(y.start))) {
        shiftNum += 1;
        await createLunchShift({
          officeId,
          shiftNum,
          startTime: a.start,
          endTime: a.end,
        });
      }
    }, "Lunch shifts saved.");
    if (ok) setDrafts(null);
  }, [rows, serverDrafts, officeId, mutate]);

  return (
    <Section
      title="Lunch shifts"
      description="Clerks are assigned to a shift on their schedule. Removing a shift unassigns every clerk on it, so saves only delete shifts you actually removed."
      actions={
        <>
          {dirty && (
            <Button variant="go" loading={saving} onClick={save}>
              Save shifts
            </Button>
          )}
          {dirty && (
            <Button variant="ghost" disabled={saving} onClick={() => setDrafts(null)}>
              Revert
            </Button>
          )}
          <Button variant="outline" disabled={saving} onClick={addRow}>
            Add shift
          </Button>
        </>
      }
    >
      <Table>
        <THead>
          <TR className="hover:bg-transparent">
            <TH className="w-20">Shift</TH>
            <TH className="w-36">Starts</TH>
            <TH className="w-36">Ends</TH>
            <TH align="right" className="w-32" />
          </TR>
        </THead>
        <TBody>
          {rows.length === 0 ? (
            <TEmpty colSpan={4}>No lunch shifts for this office.</TEmpty>
          ) : (
            rows.map((r, i) => (
              <TR key={r.id ?? `new-${i}`}>
                <TD className="font-medium text-civic-800">{i + 1}</TD>
                <TD>
                  <InlineInput
                    type="time"
                    value={r.start}
                    onChange={(e) => update(i, { start: e.target.value })}
                    aria-label={`Shift ${i + 1} start`}
                  />
                </TD>
                <TD>
                  <InlineInput
                    type="time"
                    value={r.end}
                    onChange={(e) => update(i, { end: e.target.value })}
                    aria-label={`Shift ${i + 1} end`}
                  />
                </TD>
                <TD align="right">
                  <Button
                    variant="ghost"
                    disabled={saving}
                    onClick={() => removeRow(i)}
                    className="px-2 py-1"
                  >
                    Remove
                  </Button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </Section>
  );
}
