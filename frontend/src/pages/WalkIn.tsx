import { useEffect, useState } from "react";
import { UserPlus, Zap, ArrowRight, Mail, CheckCircle, Upload, Check, CircleDashed } from "lucide-react";
import { api, type ConfigResponse } from "@/lib/api";
import { Badge, Button, Card, SectionLabel, useToast, cn } from "@st-lucie/ui";

export function WalkIn() {
  const notify = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [officeId, setOfficeId] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [emailVerified, setEmailVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [phone, setPhone] = useState("");
  const [selectedTxns, setSelectedTxns] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);
  const [pendingPrescreenUrl, setPendingPrescreenUrl] = useState<string | null>(null);
  const [docFiles, setDocFiles] = useState<Record<string, File>>({});

  useEffect(() => {
    api.config().then((cfg) => {
      setConfig(cfg);
      if (cfg.offices[0]) setOfficeId(cfg.offices[0].id);
    });
  }, []);

  function toggleTxn(slug: string) {
    setSelectedTxns((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
    );
  }

  const requiredDocs = (() => {
    const seen = new Set<string>();
    const docs: { docId: string; name: string }[] = [];
    for (const slug of selectedTxns) {
      const txn = config?.txnTypes.find((t) => t.slug === slug);
      for (const d of txn?.requiredDocs ?? []) {
        if (!seen.has(d.docId)) {
          seen.add(d.docId);
          docs.push(d);
        }
      }
    }
    return docs;
  })();

  const totalDuration = selectedTxns.reduce((sum, slug) => {
    const txn = config?.txnTypes.find((t) => t.slug === slug);
    return sum + (txn?.duration ?? 0);
  }, 0);

  async function handleVerifyEmail() {
    if (!email.trim()) {
      notify("error", "Please enter an email address.");
      return;
    }
    setVerifying(true);
    try {
      const res = await api.verifyEmail(email.trim());
      if (res.status === "already_verified") {
        setEmailVerified(true);
        notify("success", "Email already verified!");
      } else {
        setVerificationSent(true);
        notify("success", "Verification email sent! Check your inbox and click the link.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Failed to send verification.");
    } finally {
      setVerifying(false);
    }
  }

  async function handleCheckVerification() {
    setVerifying(true);
    try {
      const res = await api.verifyEmailStatus(email.trim());
      if (res.verified) {
        setEmailVerified(true);
        notify("success", "Email verified!");
      } else {
        notify("error", "Email not yet verified. Please check your inbox and click the verification link.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Failed to check status.");
    } finally {
      setVerifying(false);
    }
  }

  async function register(priority: boolean) {
    if (!firstName.trim() || !lastName.trim()) {
      notify("error", "First and last name required.");
      return;
    }
    if (selectedTxns.length === 0) {
      notify("error", "Select at least one transaction type.");
      return;
    }
    setBusy(true);
    setPendingPrescreenUrl(null);
    try {
      const res = await api.walkIn({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        txns: selectedTxns,
        officeId,
        priority,
        identityVerified,
        notes: notes.trim(),
      });
      if (res.ok) {
        const msg = res.queueNumber
          ? `Walk-in registered! Queue #${res.queueNumber}${priority ? " (Priority)" : ""}`
          : "Walk-in registered! Pending pre-screen completion.";
        notify("success", msg);

        // Upload any scanned documents now that the appointment exists
        const filesToUpload = Object.entries(docFiles);
        // Hoist the narrowed id into a const — the `res.appointmentId` guard
        // doesn't survive into the .map() closure below, so TS widens it back
        // to number | undefined without this.
        const appointmentId = res.appointmentId;
        if (filesToUpload.length > 0 && appointmentId) {
          const results = await Promise.allSettled(
            filesToUpload.map(([docId, file]) =>
              api.uploadDocument({ appointmentId, docId, file }),
            ),
          );
          const failed = results.filter((r) => r.status === "rejected").length;
          if (failed > 0) {
            notify("error", `${failed} document(s) failed to upload.`);
          } else {
            notify("success", `${filesToUpload.length} document(s) uploaded.`);
          }
        }

        if (res.pendingPrescreen && res.confirmationCode) {
          const query = new URLSearchParams({ autoCheckIn: "1" });
          if (priority) query.set("priority", "1");
          setPendingPrescreenUrl(
            `${window.location.origin}/prescreen/${res.confirmationCode}?${query.toString()}`,
          );
        }
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setSelectedTxns([]);
        setNotes("");
        setIdentityVerified(false);
        setEmailVerified(false);
        setVerificationSent(false);
        setDocFiles({});
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <UserPlus className="text-civic-500" size={20} />
          <div>
            <h2 className="font-display text-xl font-bold text-civic-800">Walk-In Registration</h2>
            <p className="text-sm text-civic-500">
              Customer arrives without appointment. Capture info and check in.
            </p>
          </div>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <SectionLabel>Customer Information</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-semibold text-civic-600">First Name *</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm outline-none focus:border-civic-400"
              placeholder="First name"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-civic-600">Last Name *</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm outline-none focus:border-civic-400"
              placeholder="Last name"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-civic-600">Email</label>
            <div className="mt-1 flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailVerified(false);
                  setVerificationSent(false);
                }}
                disabled={emailVerified}
                className="w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm outline-none focus:border-civic-400 disabled:bg-civic-50"
                placeholder="email@example.com"
              />
              {!emailVerified && !verificationSent && (
                <Button variant="outline" loading={verifying} onClick={handleVerifyEmail}>
                  <Mail size={14} /> Verify
                </Button>
              )}
              {verificationSent && !emailVerified && (
                <Button variant="go" loading={verifying} onClick={handleCheckVerification}>
                  <CheckCircle size={14} /> I Verified
                </Button>
              )}
              {emailVerified && (
                <Badge tone="go">Verified</Badge>
              )}
            </div>
            {verificationSent && !emailVerified && (
              <p className="mt-1 text-xs text-amber-600">
                Check your inbox for a verification email from AWS, then click "I Verified" above.
              </p>
            )}
            {emailVerified && (
              <p className="mt-1 text-xs text-green-600">
                Email verified — confirmation will be sent after check-in.
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold text-civic-600">Phone</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm outline-none focus:border-civic-400"
              placeholder="(555) 123-4567"
            />
          </div>
        </div>

        {config && (
          <div>
            <label className="text-xs font-semibold text-civic-600">Office</label>
            <select
              value={officeId}
              onChange={(e) => setOfficeId(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              {config.offices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <SectionLabel>Transaction Type(s)</SectionLabel>
        <p className="text-xs text-civic-400">Select all that apply.</p>
        <div className="space-y-2">
          {(config?.txnTypes.filter((t) => t.status === "active") ?? []).map((txn) => (
            <label
              key={txn.slug}
              className="flex items-center gap-3 rounded-lg border border-civic-100 px-4 py-3 cursor-pointer hover:bg-civic-50 transition-colors"
            >
              <input
                type="checkbox"
                checked={selectedTxns.includes(txn.slug)}
                onChange={() => toggleTxn(txn.slug)}
                className="size-4 accent-civic-500"
              />
              <span className="text-sm font-medium text-ink">{txn.name}</span>
              <span className="ml-auto text-xs text-civic-400">{txn.duration} min</span>
            </label>
          ))}
        </div>
        {totalDuration > 0 && (
          <p className="text-sm font-semibold text-civic-500">
            Estimated duration: {totalDuration} min
          </p>
        )}
      </Card>

      <Card className="p-6 space-y-4">
        <SectionLabel>Identity Verification</SectionLabel>
        <p className="text-xs text-civic-400">Clerk verifies photo ID at the desk.</p>
        {identityVerified ? (
          <div className="flex items-center gap-2 text-sm font-semibold text-go-600">
            <span>✅</span> Identity verified by clerk
          </div>
        ) : (
          <Button variant="go" onClick={() => setIdentityVerified(true)}>
            Mark Identity Verified
          </Button>
        )}
      </Card>

      {requiredDocs.length > 0 && (
        <Card className="p-6 space-y-4">
          <SectionLabel>Required Documents</SectionLabel>
          <p className="text-xs text-civic-400">
            Clerk scans required documents at the desk (human verified).
          </p>
          <div className="space-y-2">
            {requiredDocs.map((d) => {
              const file = docFiles[d.docId];
              return (
                <div
                  key={d.docId}
                  className="flex items-center justify-between gap-3 rounded-lg border border-civic-100 bg-white px-3.5 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-lg",
                        file
                          ? "text-white bg-go-500"
                          : "text-civic-300 bg-white ring-1 ring-civic-100",
                      )}
                    >
                      {file ? <Check size={16} strokeWidth={3} /> : <CircleDashed size={16} />}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-ink">{d.name}</div>
                      <div className="text-xs text-civic-400">
                        {file ? file.name : "Not uploaded"}
                      </div>
                    </div>
                  </div>
                  {file ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDocFiles((prev) => {
                          const next = { ...prev };
                          delete next[d.docId];
                          return next;
                        })
                      }
                      className="shrink-0 rounded-lg border border-civic-200 px-3 py-1.5 text-xs font-semibold text-civic-500 hover:border-stop-300 hover:text-stop-600"
                    >
                      Remove
                    </button>
                  ) : (
                    <label className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-civic-200 px-3 py-1.5 text-xs font-semibold text-civic-700 hover:border-civic-400 hover:bg-civic-50">
                      <Upload size={13} /> Upload
                      <input
                        type="file"
                        accept=".pdf,image/jpeg,image/png"
                        className="sr-only"
                        onChange={(event) => {
                          const f = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (f) setDocFiles((prev) => ({ ...prev, [d.docId]: f }));
                        }}
                      />
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="p-6 space-y-4">
        <SectionLabel>Notes & Queue Assignment</SectionLabel>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Special circumstances, repeat visitor context..."
          className="w-full resize-y rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-civic-300 focus:border-civic-400 min-h-[60px]"
        />
        <div className="flex flex-col gap-3">
          <div className="flex gap-3">
            <Button variant="civic" className="flex-1" loading={busy} disabled={!emailVerified} onClick={() => register(false)}>
              <ArrowRight size={16} /> Check In to Queue
            </Button>
            <Button
              variant="outline"
              className="border-warn-200 text-warn-700 hover:bg-warn-50"
              loading={busy}
              disabled={!emailVerified}
              onClick={() => register(true)}
            >
              <Zap size={16} /> Priority
            </Button>
          </div>
          {!emailVerified && (
            <p className="text-xs text-amber-600">
              Email must be verified before checking in.
            </p>
          )}
        </div>
        {pendingPrescreenUrl && (
          <div className="rounded-lg border border-civic-200 bg-civic-50 px-4 py-3 text-sm">
            <p className="font-semibold text-civic-800">Pre-screen required before queue entry.</p>
            <a
              href={pendingPrescreenUrl}
              className="mt-1 inline-block font-semibold text-civic-600 underline hover:text-civic-800"
            >
              Open pre-screen
            </a>
          </div>
        )}
      </Card>
    </main>
  );
}
