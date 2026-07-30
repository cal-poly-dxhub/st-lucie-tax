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
  X,
  AlertTriangle,
  Upload,
} from "lucide-react";
import { api, type CustomerRecord, type DocStatus } from "@/lib/api";
import { Badge, Button, Card, SectionLabel, useToast, cn } from "@st-lucie/ui";

interface Props {
  record: CustomerRecord;
  onMutated: () => void; // re-fetch the record after a persisted change
  onDismiss?: () => void; // close the panel
}

export function RecordCard({ record, onMutated, onDismiss }: Props) {
  const notify = useToast();

  const [busy, setBusy] = useState<string | null>(null);
  const [prescreenSent, setPrescreenSent] = useState(false);

  useEffect(() => {
    setPrescreenSent(false);
  }, [record.appointmentId]);

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

  const sendPrescreen = (priority: boolean) =>
    run("prescreen", async () => {
      const res = await api.sendPrescreen(record.appointmentId, true, priority);
      setPrescreenSent(true);
      notify("success", `Pre-screen link sent to ${res.sentTo}. Customer will auto-join the queue.`);
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

  const validateDoc = (doc: DocStatus) =>
    run(
      `doc-${doc.id}`,
      () => api.validateDocument(doc.id as number).then(() => {}),
      `${doc.name} validated.`,
    );

  const isInQueue = record.status === "checked-in" || record.status === "serving";
  const showSentState = prescreenSent || (record.prescreenCompleted && !isInQueue);

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
          <div className="flex items-center gap-2">
            <Badge tone={isInQueue ? "go" : "civic"} className="bg-white/90">
              {isInQueue ? "In queue" : record.status}
            </Badge>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="grid size-8 place-items-center rounded-full bg-white/20 text-white/80 transition-colors hover:bg-white/30 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        {/* ── Identity ── */}
        <Gate
          icon={record.identityVerified ? <ShieldCheck size={18} /> : <ShieldQuestion size={18} />}
          tone={record.identityVerified ? "done" : "pending"}
          title="Identity Verification"
          subtitle="Confirm government photo ID in person or via AuthID"
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

        {/* ── Pre-screen / Queue status ── */}
        {isInQueue ? (
          <div className="flex items-center gap-3 rounded-xl border-2 border-go-300 bg-go-50 px-4 py-3.5">
            <span className="grid size-10 place-items-center rounded-full bg-go-500 text-white">
              <Check size={20} strokeWidth={3} />
            </span>
            <div>
              <div className="font-display text-base font-bold text-go-700">In the queue</div>
              <div className="text-xs text-go-600">
                Customer will be called when it's their turn.
              </div>
            </div>
          </div>
        ) : showSentState ? (
          <div className="flex items-center gap-3 rounded-xl border border-civic-200 bg-civic-50/60 px-4 py-3.5">
            <span className="grid size-10 place-items-center rounded-full bg-civic-100 text-civic-500">
              <ClipboardList size={20} />
            </span>
            <div>
              <div className="font-display text-base font-bold text-civic-700">Sent for pre-screen</div>
              <div className="text-xs text-civic-500">
                Customer will auto-join the queue after completing questions.
              </div>
            </div>
          </div>
        ) : record.identityVerified ? (
          <div className="border-t border-civic-100 pt-5">
            <SectionLabel>Send for pre-screen</SectionLabel>
            <p className="mt-1 text-xs text-civic-400">
              Customer will receive pre-screen questions by email. They'll automatically join the queue once complete.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                variant="go"
                className="flex-1"
                loading={busy === "prescreen"}
                onClick={() => sendPrescreen(false)}
              >
                <Send size={16} /> Send pre-screen
              </Button>
              <Button
                variant="outline"
                className="border-warn-200 text-warn-700 hover:bg-warn-50"
                loading={busy === "prescreen"}
                onClick={() => sendPrescreen(true)}
              >
                <Zap size={16} /> Priority
              </Button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-warn-200 bg-warn-50 px-4 py-3.5">
            <div className="flex items-center gap-2 text-sm font-semibold text-warn-700">
              <AlertTriangle size={16} /> Verify identity first
            </div>
            <p className="mt-1 text-xs text-warn-600">
              Confirm the customer's government photo ID before sending pre-screen questions.
            </p>
          </div>
        )}

        {/* ── Documents (informational for front desk, validated by service clerk) ── */}
        {record.docs.length > 0 && (
          <div>
            <SectionLabel>
              Documents · {record.docs.filter((d) => d.clerkValidated).length}/{record.docs.length} validated
            </SectionLabel>
            <div className="mt-3 space-y-2">
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
        )}
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
