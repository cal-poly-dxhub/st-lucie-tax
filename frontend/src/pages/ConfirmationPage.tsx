import { useEffect, useState } from "react";
import { Calendar, Send } from "lucide-react";
import { api, type ConfigResponse } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { Badge, Button, Card, SectionLabel } from "@/components/ui";

interface BookingResult {
  confirmationCode: string;
  officeName: string;
  dateFormatted: string;
  timeFormatted: string;
}

export function ConfirmationPage() {
  const notify = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedTxns, setSelectedTxns] = useState<number[]>([]);
  const [officeId, setOfficeId] = useState<number | undefined>(undefined);
  const [preferredTime, setPreferredTime] = useState<"morning" | "afternoon" | "">("");
  const [preferredDow, setPreferredDow] = useState<string>("");
  const [booking, setBooking] = useState(false);
  const [result, setResult] = useState<BookingResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.offices[0]) setOfficeId(cfg.offices[0].id);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load configuration");
      });
  }, []);

  function toggleTxn(id: number) {
    setSelectedTxns((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  async function handleBook() {
    if (!firstName.trim() || !lastName.trim() || !email.trim()) {
      notify("error", "Please fill in your name and email.");
      return;
    }
    if (!selectedTxns.length) {
      notify("error", "Please select at least one transaction type.");
      return;
    }

    setBooking(true);
    try {
      const res = await api.demoBook({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        txnTypeIds: selectedTxns,
        officeId,
        preferredTime: preferredTime || null,
        preferredDow: preferredDow ? Number(preferredDow) : null,
      });
      setResult({
        confirmationCode: res.confirmationCode,
        officeName: res.officeName,
        dateFormatted: res.dateFormatted,
        timeFormatted: res.timeFormatted,
      });
      notify("success", "Appointment booked! Confirmation email sent.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Booking failed.";
      if (msg.includes("no_available_slots")) {
        notify("error", "No available slots in the next 30 days. Try a different transaction type or office.");
      } else {
        notify("error", msg);
      }
    } finally {
      setBooking(false);
    }
  }

  function handleReset() {
    setResult(null);
    setFirstName("");
    setLastName("");
    setEmail("");
    setSelectedTxns([]);
    setPreferredTime("");
    setPreferredDow("");
  }

  if (!config) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8">
        {loadError ? (
          <Card className="p-6">
            <p className="text-red-600 font-medium">Failed to load configuration</p>
            <p className="text-sm text-civic-500 mt-1">{loadError}</p>
          </Card>
        ) : (
          <p className="text-civic-400">Loading...</p>
        )}
      </main>
    );
  }

  if (result) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
        <Card className="overflow-hidden">
          <div className="bg-gradient-to-r from-civic-700 to-civic-500 px-6 py-5 text-white">
            <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-civic-100/80">
              Appointment Confirmed
            </div>
            <h2 className="font-display text-2xl font-bold">
              {firstName} {lastName}
            </h2>
          </div>
          <div className="p-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 text-sm">
                <p>
                  <span className="font-semibold text-civic-600">Confirmation Code:</span>{" "}
                  <span className="font-mono">{result.confirmationCode}</span>
                </p>
                <p>
                  <span className="font-semibold text-civic-600">Date:</span>{" "}
                  {result.dateFormatted}
                </p>
                <p>
                  <span className="font-semibold text-civic-600">Time:</span>{" "}
                  {result.timeFormatted}
                </p>
                <p>
                  <span className="font-semibold text-civic-600">Office:</span>{" "}
                  {result.officeName}
                </p>
                <p>
                  <span className="font-semibold text-civic-600">Email Sent To:</span>{" "}
                  {email}
                </p>
                <p>
                  <span className="font-semibold text-civic-600">Status:</span>{" "}
                  <Badge tone="go">Confirmed</Badge>
                </p>
              </div>
              <div className="flex flex-col items-center justify-center">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(result.confirmationCode)}`}
                  alt="QR Code"
                  className="h-[150px] w-[150px]"
                />
                <p className="mt-2 font-mono text-xs text-civic-500">
                  {result.confirmationCode}
                </p>
              </div>
            </div>
            <div className="border-t border-civic-100 pt-4">
              <p className="text-sm text-civic-500">
                A confirmation email has been sent. Present the QR code or confirmation code at
                check-in.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <Button variant="civic" onClick={handleReset}>
            <Calendar size={16} /> Book Another Appointment
          </Button>
        </Card>
      </main>
    );
  }

  const activeTxns = config.txnTypes.filter((t) => t.status !== "hidden");

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 space-y-6">
      <Card className="p-6">
        <h2 className="font-display text-xl font-bold text-civic-800">Schedule an Appointment</h2>
        <p className="mt-1 text-sm text-civic-500">
          Enter your details below. The system will find the best available slot and send a
          confirmation email automatically.
        </p>
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="font-display text-base font-semibold text-civic-700">Your Information</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <SectionLabel>First Name</SectionLabel>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Jane"
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm focus:border-civic-400 focus:outline-none focus:ring-1 focus:ring-civic-400"
            />
          </div>
          <div>
            <SectionLabel>Last Name</SectionLabel>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm focus:border-civic-400 focus:outline-none focus:ring-1 focus:ring-civic-400"
            />
          </div>
        </div>
        <div>
          <SectionLabel>Email Address</SectionLabel>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm focus:border-civic-400 focus:outline-none focus:ring-1 focus:ring-civic-400"
          />
          <p className="mt-1 text-xs text-civic-400">
            Confirmation email will be sent here automatically.
          </p>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="font-display text-base font-semibold text-civic-700">
          Transaction Type(s)
        </h3>
        <p className="text-sm text-civic-500">Select one or more services you need.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {activeTxns.map((t) => (
            <label
              key={t.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                selectedTxns.includes(t.id)
                  ? "border-civic-500 bg-civic-50"
                  : "border-civic-200 hover:border-civic-300"
              }`}
            >
              <input
                type="checkbox"
                checked={selectedTxns.includes(t.id)}
                onChange={() => toggleTxn(t.id)}
                className="h-4 w-4 rounded border-civic-300 text-civic-600 focus:ring-civic-500"
              />
              <div>
                <div className="text-sm font-medium text-ink">{t.name}</div>
                <div className="text-xs text-civic-400">{t.duration} min</div>
              </div>
            </label>
          ))}
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h3 className="font-display text-base font-semibold text-civic-700">Preferences</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <SectionLabel>Preferred Office</SectionLabel>
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
          <div>
            <SectionLabel>Preferred Time</SectionLabel>
            <select
              value={preferredTime}
              onChange={(e) => setPreferredTime(e.target.value as "" | "morning" | "afternoon")}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">No preference</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
            </select>
          </div>
          <div>
            <SectionLabel>Preferred Day</SectionLabel>
            <select
              value={preferredDow}
              onChange={(e) => setPreferredDow(e.target.value)}
              className="mt-1 w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">No preference</option>
              <option value="1">Monday</option>
              <option value="2">Tuesday</option>
              <option value="3">Wednesday</option>
              <option value="4">Thursday</option>
              <option value="5">Friday</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <Button variant="civic" loading={booking} onClick={handleBook}>
          <Send size={16} /> Find Slot & Book Appointment
        </Button>
      </Card>
    </main>
  );
}
