import { useState } from "react";
import { Send, QrCode } from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { Badge, Button, Card, SectionLabel } from "@/components/ui";

export function ConfirmationPage() {
  const notify = useToast();
  const [prescreen, setPrescreen] = useState("true");
  const [identity, setIdentity] = useState("false");
  const [docs, setDocs] = useState("mixed");
  const [code, setCode] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function sendConfirmation() {
    setSending(true);
    try {
      const res = await api.sendConfirmation({
        prescreen: prescreen === "true",
        identity: identity === "true",
        docs,
      });
      if (res.ok && res.confirmationCode) {
        setCode(res.confirmationCode);
        notify("success", "Confirmation email sent!");
      } else {
        notify("error", res.error ?? "Failed to send confirmation.");
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server not running.");
    } finally {
      setSending(false);
    }
  }

  const docLabels: Record<string, { icon: string; name: string; status: string }[]> = {
    mixed: [
      { icon: "✅", name: "Out-of-State Title (Original)", status: "Uploaded" },
      { icon: "📄", name: "Photo ID (Driver License)", status: "Uploaded" },
      { icon: "⏳", name: "Proof of FL Insurance", status: "Pending upload" },
    ],
    "all-accepted": [
      { icon: "✅", name: "Out-of-State Title (Original)", status: "Uploaded" },
      { icon: "✅", name: "Photo ID (Driver License)", status: "Uploaded" },
      { icon: "✅", name: "Proof of FL Insurance", status: "Uploaded" },
    ],
    "all-pending": [
      { icon: "⏳", name: "Out-of-State Title (Original)", status: "Pending upload" },
      { icon: "⏳", name: "Photo ID (Driver License)", status: "Pending upload" },
      { icon: "⏳", name: "Proof of FL Insurance", status: "Pending upload" },
    ],
    none: [],
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <Card className="p-6">
        <h2 className="font-display text-xl font-bold text-civic-800">Appointment Confirmed</h2>
        <p className="mt-1 text-sm text-civic-500">
          Customer has booked via AI chatbot. Configure demo state below.
        </p>
      </Card>

      <Card className="p-6">
        <h3 className="font-display text-base font-semibold text-civic-700 mb-4">
          Jane Smith — Demo Configuration
        </h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <SectionLabel>Pre-Screen</SectionLabel>
            <select
              value={prescreen}
              onChange={(e) => setPrescreen(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              <option value="true">Completed</option>
              <option value="false">Not completed</option>
            </select>
          </div>
          <div>
            <SectionLabel>Identity Verified</SectionLabel>
            <select
              value={identity}
              onChange={(e) => setIdentity(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              <option value="false">Not verified</option>
              <option value="true">Verified</option>
            </select>
          </div>
          <div>
            <SectionLabel>Docs Status</SectionLabel>
            <select
              value={docs}
              onChange={(e) => setDocs(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              <option value="mixed">2 uploaded, 1 pending</option>
              <option value="all-accepted">All uploaded</option>
              <option value="all-pending">All pending upload</option>
              <option value="none">No docs uploaded</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-civic-700 to-civic-500 px-6 py-5 text-white">
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-civic-100/80">
            Appointment Summary
          </div>
          <h2 className="font-display text-2xl font-bold">Jane Smith</h2>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 text-sm">
              <p><span className="font-semibold text-civic-600">Transaction:</span> Road Test</p>
              <p><span className="font-semibold text-civic-600">Date:</span> Tuesday, June 24, 2026</p>
              <p><span className="font-semibold text-civic-600">Time:</span> 9:30 AM</p>
              <p><span className="font-semibold text-civic-600">Office:</span> Port St. Lucie (Crosstown Pkwy)</p>
              <p><span className="font-semibold text-civic-600">Est. Duration:</span> 25 min</p>
              <p>
                <span className="font-semibold text-civic-600">Pre-Screen:</span>{" "}
                <Badge tone={prescreen === "true" ? "go" : "stop"}>
                  {prescreen === "true" ? "Completed" : "Not completed"}
                </Badge>
              </p>
              <p>
                <span className="font-semibold text-civic-600">Identity:</span>{" "}
                <Badge tone={identity === "true" ? "go" : "warn"}>
                  {identity === "true" ? "Verified" : "Not verified"}
                </Badge>
              </p>
            </div>
            <div className="flex flex-col items-center justify-center">
              {code ? (
                <>
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(code)}`}
                    alt="QR Code"
                    className="h-[120px] w-[120px]"
                  />
                  <p className="mt-2 font-mono text-xs text-civic-500">{code}</p>
                </>
              ) : (
                <div className="flex flex-col items-center text-civic-300">
                  <QrCode size={48} />
                  <p className="mt-2 text-xs">Send confirmation to generate QR</p>
                </div>
              )}
            </div>
          </div>

          <div className="border-t border-civic-100 pt-4">
            <SectionLabel>Document Status</SectionLabel>
            <div className="mt-2 space-y-2">
              {(docLabels[docs] ?? []).map((d, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-civic-100 px-3 py-2">
                  <span className="text-lg">{d.icon}</span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-ink">{d.name}</div>
                    <div className="text-xs text-civic-400">{d.status}</div>
                  </div>
                </div>
              ))}
              {docs === "none" && (
                <p className="text-sm text-civic-400">No documents uploaded yet.</p>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <h3 className="font-display text-base font-semibold text-civic-700 mb-2">
          Send Confirmation Email
        </h3>
        <p className="text-sm text-civic-500 mb-4">
          Creates Jane's appointment in DB with the configured status and sends confirmation email.
        </p>
        <Button variant="civic" loading={sending} onClick={sendConfirmation}>
          <Send size={16} /> Send Confirmation Email
        </Button>
      </Card>
    </main>
  );
}
