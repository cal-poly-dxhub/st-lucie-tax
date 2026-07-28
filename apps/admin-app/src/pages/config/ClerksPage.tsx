import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Check,
  Field,
  InlineInput,
  Input,
  Matrix,
  Select,
  Table,
  TBody,
  TD,
  TEmpty,
  TH,
  THead,
  TR,
  type MatrixAxis,
} from "@st-lucie/ui";
import {
  createClerk,
  deleteClerk,
  fetchClerks,
  fetchOffices,
  fetchSkillsMatrix,
  setClerkSkills,
  updateClerk,
  type Clerk,
  type Office,
  type SkillsMatrix,
} from "@/config-api";
import { useResource } from "./use-resource";
import { DeleteButton, ErrorBanner, Section, Spinner } from "./parts";

interface Data {
  clerks: Clerk[];
  offices: Office[];
  skills: SkillsMatrix;
}

export function ClerksPage() {
  const load = useCallback(async (): Promise<Data> => {
    const [clerks, officesResponse, skills] = await Promise.all([
      fetchClerks(),
      fetchOffices(),
      fetchSkillsMatrix(),
    ]);
    return { clerks, offices: officesResponse.offices, skills };
  }, []);

  const { data, error, loading, saving, mutate } = useResource<Data>(load);

  const [editing, setEditing] = useState<Record<number, Partial<Clerk>>>({});
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyCell, setBusyCell] = useState<string | null>(null);
  const [showSkills, setShowSkills] = useState(false);

  const [newFirst, setNewFirst] = useState("");
  const [newLast, setNewLast] = useState("");
  const [newEmail, setNewEmail] = useState("");

  const clerks = data?.clerks ?? [];
  const offices = data?.offices ?? [];

  const draft = (c: Clerk) => ({ ...c, ...editing[c.id] });
  const isDirty = (c: Clerk) => editing[c.id] !== undefined;

  function edit(id: number, patch: Partial<Clerk>) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function discard(id: number) {
    setEditing((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function toggleOffice(c: Clerk, officeId: number, next: boolean) {
    const current = draft(c).office_ids ?? [];
    edit(c.id, {
      office_ids: next ? [...current, officeId] : current.filter((id) => id !== officeId),
    });
  }

  async function save(c: Clerk) {
    const d = draft(c);
    const ok = await mutate(
      () =>
        updateClerk(c.id, {
          firstName: d.first_name,
          lastName: d.last_name,
          email: d.email,
          status: d.status,
          officeIds: d.office_ids,
        }),
      "Clerk saved.",
    );
    if (ok) discard(c.id);
  }

  async function add() {
    const ok = await mutate(
      () =>
        createClerk({
          firstName: newFirst.trim(),
          lastName: newLast.trim(),
          email: newEmail.trim(),
        }),
      "Clerk created.",
    );
    if (ok) {
      setNewFirst("");
      setNewLast("");
      setNewEmail("");
    }
  }

  // ─── Skills matrix ─────────────────────────────────────────────────────────
  const skillRows: MatrixAxis[] = useMemo(
    () =>
      (data?.skills.clerks ?? []).map((c) => ({
        id: String(c.id),
        label: `${c.first_name} ${c.last_name}`,
      })),
    [data],
  );
  const skillCols: MatrixAxis[] = useMemo(
    () => (data?.skills.txnTypes ?? []).map((t) => ({ id: String(t.id), label: t.name })),
    [data],
  );

  const skillsOf = useCallback(
    (clerkId: string) => data?.skills.clerks.find((c) => String(c.id) === clerkId)?.skill_ids ?? [],
    [data],
  );

  // Skills persist per cell — the route takes the whole array, so a toggle sends
  // the clerk's existing skills plus or minus the one that changed.
  async function toggleSkill(clerkId: string, txnId: string, next: boolean) {
    const cell = `${clerkId}|${txnId}`;
    const current = skillsOf(clerkId);
    const id = Number(txnId);
    const skillIds = next ? [...current, id] : current.filter((s) => s !== id);
    setBusyCell(cell);
    try {
      await mutate(() => setClerkSkills(Number(clerkId), skillIds));
    } finally {
      setBusyCell(null);
    }
  }

  if (error) return <ErrorBanner>{error}</ErrorBanner>;
  if (loading && !data) return <Spinner />;

  return (
    <div className="flex flex-col gap-5">
      <Section
        title="Clerks"
        description="Office assignment controls where a clerk can be scheduled. Skills control which transactions they can be routed."
      >
        <Table>
          <THead>
            <TR className="hover:bg-transparent">
              <TH>First name</TH>
              <TH>Last name</TH>
              <TH>Email</TH>
              <TH className="w-28">Status</TH>
              {offices.map((o) => (
                <TH key={o.id} align="center" className="w-28">
                  {o.name}
                </TH>
              ))}
              <TH className="w-24" align="center">
                Skills
              </TH>
              <TH align="right" className="w-48" />
            </TR>
          </THead>
          <TBody>
            {clerks.length === 0 ? (
              <TEmpty colSpan={6 + offices.length}>No clerks configured yet.</TEmpty>
            ) : (
              clerks.map((c) => {
                const d = draft(c);
                return (
                  <TR key={c.id}>
                    <TD>
                      <InlineInput
                        value={d.first_name ?? ""}
                        onChange={(e) => edit(c.id, { first_name: e.target.value })}
                        aria-label="First name"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        value={d.last_name ?? ""}
                        onChange={(e) => edit(c.id, { last_name: e.target.value })}
                        aria-label="Last name"
                      />
                    </TD>
                    <TD>
                      <InlineInput
                        type="email"
                        value={d.email ?? ""}
                        onChange={(e) => edit(c.id, { email: e.target.value })}
                        aria-label="Email"
                      />
                    </TD>
                    <TD>
                      <Select
                        value={d.status ?? "active"}
                        onChange={(e) => edit(c.id, { status: e.target.value })}
                        aria-label="Status"
                        className="px-2 py-1 text-xs"
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </Select>
                    </TD>
                    {offices.map((o) => (
                      <TD key={o.id} align="center">
                        <Check
                          checked={(d.office_ids ?? []).includes(o.id)}
                          onChange={(e) => toggleOffice(c, o.id, e.target.checked)}
                          aria-label={`${c.first_name} ${c.last_name} — ${o.name}`}
                        />
                      </TD>
                    ))}
                    <TD align="center">
                      <Badge tone={c.skill_ids.length ? "civic" : "neutral"}>
                        {c.skill_ids.length}
                      </Badge>
                    </TD>
                    <TD align="right">
                      <span className="inline-flex items-center gap-1">
                        {isDirty(c) && (
                          <>
                            <Button
                              variant="go"
                              disabled={saving}
                              onClick={() => save(c)}
                              className="px-2 py-1"
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={saving}
                              onClick={() => discard(c.id)}
                              className="px-2 py-1"
                            >
                              Revert
                            </Button>
                          </>
                        )}
                        <DeleteButton
                          confirming={confirmId === c.id}
                          disabled={saving}
                          onArm={() => setConfirmId(c.id)}
                          onCancel={() => setConfirmId(null)}
                          onConfirm={async () => {
                            await mutate(() => deleteClerk(c.id), "Clerk deleted.");
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

      <Section title="Add clerk">
        <div className="grid max-w-4xl gap-4 sm:grid-cols-[1fr_1fr_1.5fr_auto] sm:items-end">
          <Field label="First name" htmlFor="cl-first" required>
            <Input id="cl-first" value={newFirst} onChange={(e) => setNewFirst(e.target.value)} />
          </Field>
          <Field label="Last name" htmlFor="cl-last" required>
            <Input id="cl-last" value={newLast} onChange={(e) => setNewLast(e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="cl-email" required>
            <Input
              id="cl-email"
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
            />
          </Field>
          <Button
            variant="go"
            loading={saving}
            disabled={!newFirst.trim() || !newLast.trim() || !newEmail.trim()}
            onClick={add}
          >
            Add
          </Button>
        </div>
      </Section>

      <Section
        title="Skills"
        description="Each checked cell lets that clerk be routed that transaction. Changes save as you click."
        actions={
          <Button variant="outline" onClick={() => setShowSkills((s) => !s)}>
            {showSkills ? "Hide matrix" : "Show matrix"}
          </Button>
        }
      >
        {showSkills ? (
          <Matrix
            rows={skillRows}
            cols={skillCols}
            rowHeader="Clerk"
            emptyMessage="Add a clerk and a transaction type to assign skills."
            isOn={(clerkId, txnId) => skillsOf(clerkId).includes(Number(txnId))}
            isBusy={(clerkId, txnId) => busyCell === `${clerkId}|${txnId}`}
            isDisabled={() => saving}
            onToggle={toggleSkill}
          />
        ) : (
          <p className="text-sm text-civic-400">
            {skillRows.length} clerks × {skillCols.length} transactions.
          </p>
        )}
      </Section>
    </div>
  );
}
