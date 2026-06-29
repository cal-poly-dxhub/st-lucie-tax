import { useEffect, useState } from "react";
import { UserPlus, Zap, ArrowRight } from "lucide-react";
import { api, type ConfigResponse } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { Button, Card, SectionLabel } from "@/components/ui";

const TXN_DOCS: Record<string, { docId: string; name: string }[]> = {
  "road-test": [
    { docId: "learner_permit", name: "Learner Permit" },
    { docId: "photo_id", name: "Photo ID" },
    { docId: "vision_cert", name: "Vision Certificate" },
    { docId: "vehicle_reg", name: "Vehicle Registration" },
    { docId: "insurance_card", name: "Insurance Card" },
  ],
  "id-card": [
    { docId: "birth_cert", name: "Birth Certificate" },
    { docId: "proof_address", name: "Proof of Residency" },
    { docId: "ssn_proof", name: "Social Security Proof" },
  ],
  "license-original": [
    { docId: "learner_permit", name: "Learner Permit" },
    { docId: "photo_id", name: "Photo ID" },
    { docId: "proof_address", name: "Proof of Residency" },
    { docId: "ssn_proof", name: "Social Security Proof" },
  ],
};

export function WalkIn() {
  const notify = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [officeId, setOfficeId] = useState(1);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedTxns, setSelectedTxns] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [identityVerified, setIdentityVerified] = useState(false);

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
      for (const d of TXN_DOCS[slug] ?? []) {
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
    try {
      const res = await api.walkIn({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        txns: selectedTxns,
        officeId,
        priority,
        notes: notes.trim(),
      });
      if (res.ok) {
        const msg = res.queueNumber
          ? `Walk-in registered! Queue #${res.queueNumber}${priority ? " (Priority)" : ""}`
          : "Walk-in registered! Pending pre-screen completion.";
        notify("success", msg);
        setFirstName("");
        setLastName("");
        setEmail("");
        setPhone("");
        setSelectedTxns([]);
        setNotes("");
        setIdentityVerified(false);
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
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm outline-none focus:border-civic-400"
              placeholder="email@example.com"
            />
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
                <option key={o.id} value={o.id}>{o.name}</option>
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
            {requiredDocs.map((d) => (
              <div
                key={d.docId}
                className="flex items-center gap-3 rounded-lg border border-civic-100 px-3 py-2"
              >
                <span className="text-lg">📄</span>
                <span className="text-sm font-medium text-ink">{d.name}</span>
              </div>
            ))}
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
        <div className="flex gap-3">
          <Button
            variant="civic"
            className="flex-1"
            loading={busy}
            onClick={() => register(false)}
          >
            <ArrowRight size={16} /> Check In to Queue
          </Button>
          <Button
            variant="outline"
            className="border-warn-200 text-warn-700 hover:bg-warn-50"
            loading={busy}
            onClick={() => register(true)}
          >
            <Zap size={16} /> Priority
          </Button>
        </div>
      </Card>
    </main>
  );
}
