import { useEffect, useState } from "react";
import {
  ShieldCheck,
  ShieldQuestion,
  ClipboardList,
  Send,
  FileText,
  FileWarning,
  FileX2,
  CircleDashed,
  Check,
  Zap,
  ArrowRight,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { api, type CustomerRecord, type DocStatus } from "@/lib/api";
import { computeReadiness } from "@/lib/readiness";
import { Badge, Button, Card, SectionLabel } from "./ui";
import { useToast } from "./toast-context";
import { cn } from "@/lib/cn";

interface Props {
  record: CustomerRecord;
  onMutated: () => void; // re-fetch the record after a persisted change
}

export function RecordCard({ record, onMutated }: Props) {
  const notify = useToast();
  const r = computeReadiness(record);

  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [checkedIn, setCheckedIn] = useState(record.status !== "scheduled");

  useEffect(() => {
    setCheckedIn(record.status !== "scheduled");
  }, [record.appointmentId, record.status]);

  const isCheckedIn = checkedIn || record.status !== "scheduled";

  async function run(tag: string, fn: () => Promise<void>, ok?: string) {
    setBusy(tag);
    try {
      await fn();
      if (ok) notify("success", ok);
      onMutated();
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(null);
    }
  }

  const verifyIdentity = () =>
    run(
      "identity",
      () => api.verifyIdentity(record.appointmentId).then(() => {}),
      "Identity verified.",
    );

  const validateDoc = (doc: DocStatus) =>
    run(
      `doc-${doc.id}`,
      () => api.validateDocument(doc.id as number).then(() => {}),
      `${doc.name} validated.`,
    );

  const sendPrescreen = () =>
    run("prescreen", async () => {
      const res = await api.sendPrescreen(record.appointmentId);
      notify("success", `Pre-screen link sent to ${res.sentTo}.`);
    });

  const uploadDoc = (doc: DocStatus, file: File) =>
    run(
      `upload-${doc.docId}`,
      () =>
        api
          .uploadDocument({ appointmentId: record.appointmentId, docId: doc.docId, file })
          .then(() => {}),
      `${doc.name} uploaded.`,
    );

  const checkIn = (priority: boolean) =>
    run(priority ? "checkin-priority" : "checkin", async () => {
      const res = await api.checkIn(record.appointmentId, record.officeId, notes, priority);
      setCheckedIn(true);
      notify("success", `Checked in — Queue #${res.queueNumber}${priority ? " · Priority" : ""}.`);
    });

  return (
    <Card className="animate-rise overflow-hidden">
      {/* ── Header bar ── */}
      <div className="relative overflow-hidden bg-gradient-to-r from-civic-700 to-civic-500 px-6 py-5 text-white">
        <div className="absolute inset-0 opacity-20 [background:repeating-linear-gradient(135deg,transparent,transparent_10px,rgba(255,255,255,0.4)_10px,rgba(255,255,255,0.4)_11px)]" />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-civic-100/80">
              Customer Record
            </div>
            <h2 className="font-display text-2xl font-bold tracking-tight">
              {record.firstName} {record.lastName}
            </h2>
            <div className="mt-1 flex items-center gap-2 font-mono text-xs text-civic-100/80">
              <span className="tnum">APPT #{record.appointmentId}</span>
              <span className="opacity-50">·</span>
              <span className="tnum">{record.confirmationCode.slice(0, 8)}</span>
            </div>
          </div>
          <Badge tone={isCheckedIn ? "go" : "civic"} className="bg-white/90">
            {record.status}
          </Badge>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {/* ── Identity ── */}
        <Gate
          icon={record.identityVerified ? <ShieldCheck size={18} /> : <ShieldQuestion size={18} />}
          tone={record.identityVerified ? "done" : "pending"}
          title="Identity Verification"
          subtitle="Confirm government photo ID in person"
        >
          {record.identityVerified ? (
            <Badge tone="go">
              <Check size={12} strokeWidth={3} /> Verified
            </Badge>
          ) : (
            <Button variant="go" loading={busy === "identity"} onClick={verifyIdentity}>
              <ShieldCheck size={16} /> Verify
            </Button>
          )}
        </Gate>

        {/* ── Pre-screen ── */}
        <Gate
          icon={<ClipboardList size={18} />}
          tone={record.prescreenCompleted ? "done" : "pending"}
          title="Pre-Screen Questions"
          subtitle="Required before service begins"
        >
          {record.prescreenCompleted ? (
            <Badge tone="go">
              <Check size={12} strokeWidth={3} /> Completed
            </Badge>
          ) : (
            <Button variant="outline" loading={busy === "prescreen"} onClick={sendPrescreen}>
              <Send size={16} /> Send link
            </Button>
          )}
        </Gate>

        {/* ── Documents ── */}
        <div>
          <SectionLabel>
            Documents · {r.docsValidated}/{r.docsRequired} validated
          </SectionLabel>
          <div className="mt-3 space-y-2">
            {record.docs.length === 0 && (
              <p className="text-sm text-civic-400">No documents required for this transaction.</p>
            )}
            {record.docs.map((doc) => (
              <DocRow
                key={doc.docId}
                doc={doc}
                busy={busy === `doc-${doc.id}`}
                uploadBusy={busy === `upload-${doc.docId}`}
                onValidate={() => validateDoc(doc)}
                onUpload={(file) => uploadDoc(doc, file)}
              />
            ))}
          </div>
        </div>

        {/* ── Readiness banner ── */}
        {r.ready ? (
          <div className="flex items-center gap-3 rounded-xl border-2 border-go-300 bg-go-50 px-4 py-3.5">
            <span className="grid size-10 place-items-center rounded-full bg-go-500 text-white">
              <Check size={20} strokeWidth={3} />
            </span>
            <div>
              <div className="font-display text-base font-bold text-go-700">Ready for queue</div>
              <div className="text-xs text-go-600">
                Identity verified · Pre-screen done · All documents validated
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-warn-200 bg-warn-50 px-4 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-warn-700">
              <AlertTriangle size={16} /> Not ready — {r.gaps.length} item
              {r.gaps.length === 1 ? "" : "s"} outstanding
            </div>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {r.gaps.map((g) => (
                <li key={g.key} className="flex items-center gap-1.5 text-xs text-warn-700/90">
                  <CircleDashed size={12} /> {g.label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Notes + check-in ── */}
        <div className="border-t border-civic-100 pt-5">
          <SectionLabel>Notes for service clerk</SectionLabel>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional context to pass along…"
            disabled={isCheckedIn}
            className="mt-2 min-h-[64px] w-full resize-y rounded-xl border border-civic-200 bg-civic-50/40 px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-civic-300 focus:border-civic-400 disabled:opacity-60"
          />

          {isCheckedIn ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-go-50 px-4 py-3 text-sm font-semibold text-go-700">
              <Check size={16} strokeWidth={3} /> Customer is in the queue.
            </div>
          ) : (
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                variant="go"
                className="flex-1"
                loading={busy === "checkin"}
                disabled={!r.ready || busy === "checkin-priority"}
                onClick={() => checkIn(false)}
              >
                <ArrowRight size={16} /> Check in to queue
              </Button>
              <Button
                variant="outline"
                className="border-warn-200 text-warn-700 hover:bg-warn-50"
                loading={busy === "checkin-priority"}
                disabled={busy === "checkin"}
                onClick={() => checkIn(true)}
              >
                <Zap size={16} /> Priority check-in
              </Button>
            </div>
          )}
          {!r.ready && !isCheckedIn && (
            <p className="mt-2 text-xs text-civic-400">
              Standard check-in unlocks once all gates clear. Priority overrides for accessibility
              or urgent needs.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

function Gate({
  icon,
  tone,
  title,
  subtitle,
  children,
}: {
  icon: React.ReactNode;
  tone: "done" | "pending";
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border px-4 py-3",
        tone === "done" ? "border-go-100 bg-go-50/50" : "border-civic-100 bg-civic-50/40",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "grid size-9 place-items-center rounded-lg",
            tone === "done"
              ? "bg-go-100 text-go-600"
              : "bg-white text-civic-400 ring-1 ring-civic-200",
          )}
        >
          {icon}
        </span>
        <div>
          <div className="text-sm font-semibold text-ink">{title}</div>
          <div className="text-xs text-civic-400">{subtitle}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function DocRow({
  doc,
  busy,
  uploadBusy,
  onValidate,
  onUpload,
}: {
  doc: DocStatus;
  busy: boolean;
  uploadBusy: boolean;
  onValidate: () => void;
  onUpload: (file: File) => void;
}) {
  const rejected = doc.aiReviewStatus === "reject";
  const icon = !doc.uploaded ? (
    <CircleDashed size={16} />
  ) : rejected ? (
    <FileX2 size={16} />
  ) : doc.clerkValidated ? (
    <Check size={16} strokeWidth={3} />
  ) : (
    <FileText size={16} />
  );

  const tone = !doc.uploaded
    ? "text-civic-300 bg-white ring-1 ring-civic-100"
    : rejected
      ? "text-stop-500 bg-stop-50 ring-1 ring-stop-200"
      : doc.clerkValidated
        ? "text-white bg-go-500"
        : "text-civic-500 bg-civic-50 ring-1 ring-civic-200";

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-civic-100 bg-white px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tone)}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink">{doc.name}</div>
          <div className="flex items-center gap-1.5 text-xs">
            {!doc.uploaded ? (
              <span className="text-civic-400">Not uploaded</span>
            ) : rejected ? (
              <span className="flex items-center gap-1 text-stop-500">
                <FileWarning size={11} /> AI flagged
              </span>
            ) : (
              <span className="flex items-center gap-1 text-go-600">
                <Check size={11} strokeWidth={3} /> AI accepted
              </span>
            )}
          </div>
        </div>
      </div>

      {!doc.uploaded && (
        <label
          className={cn(
            "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-civic-200 px-3 py-1.5 text-xs font-semibold text-civic-700 hover:border-civic-400 hover:bg-civic-50",
            uploadBusy && "cursor-wait opacity-60",
          )}
        >
          <Upload size={13} /> {uploadBusy ? "Uploading…" : "Upload"}
          <input
            type="file"
            accept=".pdf,image/jpeg,image/png"
            className="sr-only"
            disabled={uploadBusy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onUpload(file);
            }}
          />
        </label>
      )}
      {doc.uploaded &&
        (doc.clerkValidated ? (
          <Badge tone="go">Validated</Badge>
        ) : (
          <Button variant="go" loading={busy} onClick={onValidate} className="px-3 py-1.5 text-xs">
            Validate
          </Button>
        ))}
    </div>
  );
}
