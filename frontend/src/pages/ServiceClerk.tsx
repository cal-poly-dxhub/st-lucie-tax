import { useEffect, useState } from "react";
import {
  UserCog,
  LogIn,
  SkipForward,
  Check,
  Eye,
  Camera,
  CreditCard,
  FileCheck2,
  UserCheck,
  Download,
  Upload,
} from "lucide-react";
import { api, type Clerk, type ServiceRecord, type DocStatus } from "@/lib/api";
import { Badge, Button, Card, SectionLabel, useToast } from "@st-lucie/ui";

export function ServiceClerk() {
  const notify = useToast();
  const [clerks, setClerks] = useState<Clerk[]>([]);
  const [clerkId, setClerkId] = useState<number | null>(null);
  const [deskNumber, setDeskNumber] = useState(1);
  const [officeId] = useState(1);
  const [loggedIn, setLoggedIn] = useState(false);
  const [available, setAvailable] = useState(true);
  const [record, setRecord] = useState<ServiceRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.clerks(officeId).then((res) => {
      setClerks(res.clerks);
      if (res.clerks[0]) setClerkId(res.clerks[0].id);
    });
  }, [officeId]);

  async function login() {
    if (!clerkId) return;
    setBusy("login");
    try {
      const res = await api.clerkLogin(clerkId, officeId, deskNumber);
      if (res.ok) {
        setLoggedIn(true);
        notify("success", `Logged in as clerk ${clerkId} at desk ${deskNumber}`);
        loadServing();
      } else {
        notify("error", res.error ?? "Login failed.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    } finally {
      setBusy(null);
    }
  }

  async function loadServing() {
    if (!clerkId) return;
    try {
      const res = await api.clerkServing(clerkId, officeId);
      setRecord(res.serving ? (res.record ?? null) : null);
    } catch {
      // silent
    }
  }

  async function summonNext() {
    if (!clerkId) return;
    setBusy("summon");
    try {
      const res = await api.clerkSummonNext(clerkId, officeId);
      if (res.assigned) {
        notify("success", `Customer assigned to desk ${res.deskNumber}`);
        loadServing();
      } else {
        notify("error", "No one in queue.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleAvailability() {
    if (!clerkId) return;
    const newAvail = !available;
    try {
      await api.clerkAvailability(clerkId, officeId, newAvail);
      setAvailable(newAvail);
      notify("success", newAvail ? "Marked available" : "Marked unavailable");
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    }
  }

  async function completeAndNext() {
    if (!record || !clerkId) return;
    if (!confirm(`Complete ${record.firstName} ${record.lastName}? Next customer will be summoned.`))
      return;
    setBusy("complete");
    try {
      const res = await api.clerkCompleteAndNext(record.queueId, clerkId, officeId);
      const durMin = Math.round(res.durationSec / 60);
      if (res.next) {
        notify("success", `Completed (${durMin} min). Next customer loaded.`);
        setRecord(res.next);
      } else {
        notify("success", `Completed (${durMin} min). No one else in queue.`);
        setRecord(null);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    } finally {
      setBusy(null);
    }
  }

  async function completeOnly() {
    if (!record || !clerkId) return;
    if (!confirm(`Complete ${record.firstName} ${record.lastName}?`)) return;
    setBusy("complete");
    try {
      const res = await api.clerkComplete(record.queueId, clerkId, officeId);
      const durMin = Math.round(res.durationSec / 60);
      notify("success", `Completed (${durMin} min). Clerk now available.`);
      setRecord(null);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    } finally {
      setBusy(null);
    }
  }

  async function markStep(step: string) {
    if (!record) return;
    try {
      const res = await api.clerkRecordStep(record.queueId, step);
      if (res.ok) {
        setRecord((prev) => (prev ? { ...prev, steps: res.steps } : null));
        notify("success", `${step} marked done`);
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    }
  }

  async function validateDoc(doc: DocStatus) {
    if (!doc.id) return;
    try {
      await api.validateDocument(doc.id);
      setRecord((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          docs: prev.docs.map((d) => (d.id === doc.id ? { ...d, clerkValidated: true } : d)),
        };
      });
      notify("success", `${doc.name} validated.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    }
  }

  async function uploadDoc(doc: DocStatus, file: File) {
    if (!record) return;
    setBusy(`upload-${doc.docId}`);
    try {
      const res = await api.uploadDocument({
        appointmentId: record.appointmentId,
        docId: doc.docId,
        file,
      });
      setRecord((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          docs: prev.docs.map((d) =>
            d.docId === doc.docId
              ? { ...d, id: res.documentId, uploaded: true, s3Key: res.s3Key }
              : d,
          ),
        };
      });
      notify("success", `${doc.name} uploaded.`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(null);
    }
  }

  const selectedClerk = clerks.find((c) => c.id === clerkId);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <UserCog className="text-civic-500" size={20} />
          <h2 className="font-display text-xl font-bold text-civic-800">Service Clerk Dashboard</h2>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <SectionLabel>Clerk</SectionLabel>
            <select
              value={clerkId ?? ""}
              onChange={(e) => setClerkId(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              {clerks.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name} {c.last_name} ({c.id})
                </option>
              ))}
            </select>
            {selectedClerk?.skill_names?.length ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedClerk.skill_names.map((s) => (
                  <Badge key={s} tone="civic">{s}</Badge>
                ))}
              </div>
            ) : null}
          </div>
          <div>
            <SectionLabel>Desk #</SectionLabel>
            <select
              value={deskNumber}
              onChange={(e) => setDeskNumber(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col justify-end gap-2">
            <Button variant="civic" loading={busy === "login"} onClick={login}>
              <LogIn size={16} /> Login
            </Button>
            <Button
              variant="go"
              loading={busy === "summon"}
              disabled={!loggedIn}
              onClick={summonNext}
            >
              <SkipForward size={16} /> Summon Next
            </Button>
          </div>
        </div>

        {loggedIn && (
          <div className="mt-4 flex items-center gap-3 border-t border-civic-100 pt-4">
            <label className="flex items-center gap-2 text-sm font-medium text-civic-600 cursor-pointer">
              <input
                type="checkbox"
                checked={available}
                onChange={toggleAvailability}
                className="size-4 accent-go-500"
              />
              Available for customers
            </label>
            <Badge tone={available ? "go" : "warn"}>
              {available ? "Available" : "Unavailable"}
            </Badge>
          </div>
        )}
      </Card>

      {!record ? (
        <Card className="p-12 text-center">
          <p className="text-sm text-civic-400">
            Login as a clerk and summon a customer to begin service.
          </p>
        </Card>
      ) : (
        <>
          {/* Now Serving */}
          <Card className="overflow-hidden">
            <div className="bg-gradient-to-r from-civic-700 to-civic-500 px-6 py-4 text-white">
              <div className="flex items-center gap-2">
                <h3 className="font-display text-lg font-bold">
                  Now Serving — {record.firstName} {record.lastName}
                </h3>
                <Badge tone="civic" className="bg-white/90">Queue #{record.queueNumber}</Badge>
                {record.isPriority && <Badge tone="warn">Priority</Badge>}
              </div>
            </div>
            <div className="p-6">
              {/* Progress steps */}
              <div className="flex gap-1 mb-5">
                {["Check-In", "Queue", "Service", "Complete"].map((step, i) => (
                  <div
                    key={step}
                    className={`flex-1 rounded py-1.5 text-center text-xs font-semibold ${
                      i < 2 ? "bg-go-100 text-go-700" : i === 2 ? "bg-civic-500 text-white" : "bg-civic-100 text-civic-400"
                    }`}
                  >
                    {step}
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold text-civic-600">Transaction:</span>{" "}
                    {record.txnTypes.map((t) => t.name).join(", ")}
                  </p>
                  <p>
                    <span className="font-semibold text-civic-600">Identity:</span>{" "}
                    <Badge tone={record.identityVerified ? "go" : "warn"}>
                      {record.identityVerified ? "Verified" : "Not verified"}
                    </Badge>
                  </p>
                  <p>
                    <span className="font-semibold text-civic-600">Pre-Screen:</span>{" "}
                    <Badge tone={record.prescreenCompleted ? "go" : "stop"}>
                      {record.prescreenCompleted ? "Complete" : "Incomplete"}
                    </Badge>
                  </p>
                </div>
                <div>
                  {record.notes ? (
                    <div className="rounded-lg bg-warn-50 border border-warn-200 p-3">
                      <div className="text-xs font-semibold text-civic-600 mb-1">Check-In Notes:</div>
                      <p className="text-sm text-ink">{record.notes}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-civic-400">No notes from check-in.</p>
                  )}
                </div>
              </div>
            </div>
          </Card>

          {/* Documents */}
          <Card className="p-6">
            <SectionLabel>Documents</SectionLabel>
            <div className="mt-3 space-y-2">
              {record.docs.length === 0 ? (
                <p className="text-sm text-civic-400">No documents required.</p>
              ) : (
                record.docs.map((doc) => (
                  <div
                    key={doc.docId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-civic-100 px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-lg">
                        {doc.clerkValidated ? "✅" : doc.uploaded ? "📄" : "⏳"}
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-ink">{doc.name}</div>
                        <Badge
                          tone={doc.clerkValidated ? "go" : doc.uploaded ? "warn" : "neutral"}
                        >
                          {doc.clerkValidated ? "Validated" : doc.uploaded ? "Needs validation" : "Not uploaded"}
                        </Badge>
                      </div>
                    </div>
                    {!doc.uploaded && doc.bucket === "optional_upload" && (
                      <label
                        className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-civic-200 px-3 py-1.5 text-xs font-semibold text-civic-700 hover:border-civic-400 hover:bg-civic-50 ${
                          busy === `upload-${doc.docId}` ? "cursor-wait opacity-60" : ""
                        }`}
                      >
                        <Upload size={13} /> {busy === `upload-${doc.docId}` ? "Uploading…" : "Upload"}
                        <input
                          type="file"
                          accept=".pdf,image/jpeg,image/png"
                          className="sr-only"
                          disabled={busy === `upload-${doc.docId}`}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (file) uploadDoc(doc, file);
                          }}
                        />
                      </label>
                    )}
                    {doc.uploaded && !doc.clerkValidated && (
                      <Button
                        variant="go"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => validateDoc(doc)}
                      >
                        <FileCheck2 size={14} /> Validate
                      </Button>
                    )}
                    {doc.uploaded && doc.id && (
                      <span className="inline-flex items-center gap-1">
                        <Button
                          variant="outline"
                          className="px-2 py-1.5 text-xs"
                          onClick={async () => {
                            try {
                              const { url } = await api.getDocumentUrl(doc.id!);
                              window.open(url, "_blank");
                            } catch {
                              notify("error", "Could not load document preview.");
                            }
                          }}
                        >
                          <Eye size={14} /> View
                        </Button>
                        <Button
                          variant="outline"
                          className="px-2 py-1.5 text-xs"
                          onClick={async () => {
                            try {
                              const { url } = await api.getDocumentUrl(doc.id!, "attachment");
                              window.open(url, "_blank");
                            } catch {
                              notify("error", "Could not download document.");
                            }
                          }}
                        >
                          <Download size={14} /> Download
                        </Button>
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </Card>

          {/* Transaction Steps */}
          <Card className="p-6">
            <SectionLabel>Transaction Steps</SectionLabel>
            <div className="mt-3 space-y-2">
              {[
                { key: "identityAffirmation", label: "Identity Affirmation", icon: <UserCheck size={18} /> },
                { key: "visionTest", label: "Vision Test", icon: <Eye size={18} /> },
                { key: "photo", label: "Photo Capture", icon: <Camera size={18} /> },
                { key: "payment", label: "Payment", icon: <CreditCard size={18} /> },
              ].map((s) => {
                const done = record.steps[s.key];
                return (
                  <div
                    key={s.key}
                    className={`flex items-center justify-between rounded-lg border px-4 py-3 ${
                      done ? "border-go-200 bg-go-50" : "border-civic-100 bg-white"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className={done ? "text-go-600" : "text-civic-400"}>{s.icon}</span>
                      <span className="text-sm font-semibold text-ink">{s.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={done ? "go" : "neutral"}>{done ? "Done" : "Pending"}</Badge>
                      {!done && (
                        <Button
                          variant="go"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => markStep(s.key)}
                        >
                          Mark Done
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Pre-Screen Responses */}
          <Card className="p-6">
            <SectionLabel>Pre-Screen Responses</SectionLabel>
            {(record.prescreenWithText ?? []).length > 0 ? (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {(record.prescreenWithText ?? []).map((q) => (
                    <tr key={q.questionId} className="border-b border-civic-50">
                      <td className="py-2 pr-4 text-civic-600">{q.questionText}</td>
                      <td className={`py-2 font-bold ${q.answer ? "text-go-600" : "text-stop-600"}`}>{q.answer ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-civic-400">No pre-screen responses recorded.</p>
            )}
          </Card>

          {/* Actions */}
          <Card className="p-6">
            <div className="flex gap-3">
              <Button variant="go" loading={busy === "complete"} onClick={completeAndNext}>
                <Check size={16} /> Complete & Summon Next
              </Button>
              <Button variant="outline" onClick={completeOnly}>
                Complete Only
              </Button>
            </div>
          </Card>
        </>
      )}
    </main>
  );
}
