import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, Button, Badge } from "@st-lucie/ui";
import { Calendar, Clock, MapPin, XCircle, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface AppointmentInfo {
  firstName: string;
  date: string;
  time: string | null;
  status: string;
  officeName: string;
  officeId: number;
  txnTypeIds: number[];
  maskedEmail: string;
}

interface SlotResult {
  slotDate: string;
  slotTime: string;
  officeName: string;
  dateFormatted: string;
  timeFormatted: string;
}

interface Office {
  id: number;
  name: string;
}

async function fetchOffices(): Promise<Office[]> {
  const res = await fetch(`${API_BASE}/api/config`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.offices ?? [];
}

async function lookupAppointment(code: string): Promise<AppointmentInfo> {
  const res = await fetch(`${API_BASE}/api/appointment/lookup/${encodeURIComponent(code)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Not found");
  }
  return res.json();
}

async function cancelAppointment(code: string, email: string): Promise<{ ok: boolean; alreadyCancelled?: boolean }> {
  const res = await fetch(`${API_BASE}/api/appointment/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationCode: code, email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Cancel failed");
  return data;
}

async function findSlot(
  code: string,
  email: string,
  preferredTime: string | null,
  preferredDow: number | null,
  preferredOffice: number | null,
): Promise<SlotResult> {
  const res = await fetch(`${API_BASE}/api/appointment/find-slot`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      confirmationCode: code,
      email,
      preferredTime: preferredTime || null,
      preferredDow,
      preferredOffice,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "No slots found");
  return data;
}

async function changeAppointment(
  code: string,
  email: string,
  newDate: string,
  newTime: string,
): Promise<{ ok: boolean; newDate: string; newTime: string }> {
  const res = await fetch(`${API_BASE}/api/appointment/change`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirmationCode: code, email, newDate, newTime }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Change failed");
  return data;
}

type Mode = "view" | "cancel" | "change";

export function ManageAppointmentPage() {
  const { code } = useParams<{ code: string }>();
  const [manualCode, setManualCode] = useState("");
  const [lookupCode, setLookupCode] = useState(code ?? "");
  const [info, setInfo] = useState<AppointmentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>("view");
  const [email, setEmail] = useState("");
  const [preferredTime, setPreferredTime] = useState<"morning" | "afternoon" | "">("");
  const [preferredDow, setPreferredDow] = useState<string>("");
  const [preferredOffice, setPreferredOffice] = useState<string>("");
  const [offices, setOffices] = useState<Office[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [foundSlot, setFoundSlot] = useState<SlotResult | null>(null);

  useEffect(() => {
    fetchOffices().then(setOffices);
  }, []);

  async function load(c: string) {
    if (!c) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setMode("view");
    setFoundSlot(null);
    try {
      const result = await lookupAppointment(c);
      setInfo(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load appointment");
      setInfo(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (lookupCode) load(lookupCode);
  }, [lookupCode]);

  function handleLookup(e: React.FormEvent) {
    e.preventDefault();
    if (manualCode.trim()) {
      setLookupCode(manualCode.trim().toUpperCase());
    }
  }

  async function handleCancel() {
    if (!lookupCode || !email) return;
    setActionLoading(true);
    setError(null);
    try {
      const result = await cancelAppointment(lookupCode, email);
      if (result.alreadyCancelled) {
        setSuccess("This appointment was already cancelled.");
      } else {
        setSuccess("Your appointment has been cancelled successfully.");
      }
      setMode("view");
      setEmail("");
      // Reload to show updated status
      await load(lookupCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleFindSlot() {
    if (!lookupCode || !email) return;
    setActionLoading(true);
    setError(null);
    setFoundSlot(null);
    try {
      const slot = await findSlot(
        lookupCode,
        email,
        preferredTime || null,
        preferredDow ? Number(preferredDow) : null,
        preferredOffice ? Number(preferredOffice) : null,
      );
      setFoundSlot(slot);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No slots found";
      if (msg.includes("no_available_slots")) {
        setError("No available slots in the next 30 days. Try different preferences.");
      } else {
        setError(msg);
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleConfirmReschedule() {
    if (!lookupCode || !email || !foundSlot) return;
    setActionLoading(true);
    setError(null);
    try {
      await changeAppointment(lookupCode, email, foundSlot.slotDate, foundSlot.slotTime);
      setSuccess(
        `Your appointment has been rescheduled to ${foundSlot.dateFormatted} at ${foundSlot.timeFormatted}.`,
      );
      setMode("view");
      setEmail("");
      setPreferredTime("");
      setPreferredDow("");
      setPreferredOffice("");
      setFoundSlot(null);
      // Reload to show updated info
      await load(lookupCode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reschedule failed");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-2 text-center font-display text-2xl font-bold text-civic-900">
        Manage Appointment
      </h1>
      <p className="mb-6 text-center text-sm text-civic-500">
        Cancel or reschedule your appointment using your confirmation code.
      </p>

      {/* Lookup form */}
      {!code && (
        <form onSubmit={handleLookup} className="mb-6 flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Confirmation code"
            className="flex-1 rounded-lg border border-civic-200 px-4 py-2 text-sm focus:border-civic-500 focus:outline-none"
            aria-label="Confirmation code"
          />
          <Button type="submit" disabled={!manualCode.trim() || loading}>
            Look up
          </Button>
        </form>
      )}

      {/* Loading */}
      {loading && <p className="py-8 text-center text-sm text-civic-400">Loading...</p>}

      {/* Success message */}
      {success && (
        <Card className="mb-4 border-go-200 bg-go-50 p-4">
          <p className="text-sm font-medium text-go-700">{success}</p>
        </Card>
      )}

      {/* Error message */}
      {error && (
        <Card className="mb-4 border-stop-200 bg-stop-50 p-4">
          <p className="text-sm font-medium text-stop-700">{error}</p>
        </Card>
      )}

      {/* Appointment info */}
      {info && (
        <Card className="p-6">
          <p className="mb-4 text-sm text-civic-600">
            Hi <span className="font-semibold">{info.firstName}</span>!
          </p>

          <div className="space-y-2 text-sm text-civic-700">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-civic-400" />
              <span>{info.officeName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-civic-400" />
              <span>{info.date}</span>
            </div>
            {info.time && (
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-civic-400" />
                <span>{info.time}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Badge tone={info.status === "cancelled" ? "neutral" : "go"}>{info.status}</Badge>
            </div>
          </div>

          {/* Actions — only for scheduled appointments */}
          {info.status === "scheduled" && mode === "view" && (
            <div className="mt-6 flex gap-2">
              <Button variant="outline" onClick={() => setMode("change")}>
                <RefreshCw size={14} /> Reschedule
              </Button>
              <Button variant="outline" className="text-stop-600" onClick={() => setMode("cancel")}>
                <XCircle size={14} /> Cancel
              </Button>
            </div>
          )}

          {/* Cancel confirmation */}
          {mode === "cancel" && (
            <div className="mt-6 space-y-3 rounded-lg border border-stop-200 bg-stop-50/50 p-4">
              <p className="text-sm font-medium text-stop-700">
                Confirm cancellation
              </p>
              <p className="text-xs text-civic-500">
                Enter the email address used when booking ({info.maskedEmail}) to confirm.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                className="w-full rounded-lg border border-civic-200 px-3 py-2 text-sm focus:border-civic-500 focus:outline-none"
                aria-label="Email for verification"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="text-stop-600"
                  loading={actionLoading}
                  disabled={!email.trim()}
                  onClick={handleCancel}
                >
                  Confirm Cancel
                </Button>
                <Button variant="outline" onClick={() => { setMode("view"); setError(null); }}>
                  Back
                </Button>
              </div>
            </div>
          )}

          {/* Reschedule form — preference-based slot selection */}
          {mode === "change" && (
            <div className="mt-6 space-y-3 rounded-lg border border-civic-200 bg-civic-50/50 p-4">
              <p className="text-sm font-medium text-civic-700">
                Reschedule appointment
              </p>
              <p className="text-xs text-civic-500">
                Enter your email ({info.maskedEmail}) and set your preferences. We'll find the best available slot for you.
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Your email address"
                className="w-full rounded-lg border border-civic-200 px-3 py-2 text-sm focus:border-civic-500 focus:outline-none"
                aria-label="Email for verification"
              />
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-civic-600">
                    Preferred Office
                  </label>
                  <select
                    value={preferredOffice}
                    onChange={(e) => setPreferredOffice(e.target.value)}
                    className="w-full rounded-lg border border-civic-200 px-3 py-2 text-sm focus:border-civic-500 focus:outline-none"
                    aria-label="Preferred office"
                  >
                    <option value="">No preference</option>
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-civic-600">
                    Preferred Time
                  </label>
                  <select
                    value={preferredTime}
                    onChange={(e) => setPreferredTime(e.target.value as "" | "morning" | "afternoon")}
                    className="w-full rounded-lg border border-civic-200 px-3 py-2 text-sm focus:border-civic-500 focus:outline-none"
                    aria-label="Preferred time of day"
                  >
                    <option value="">No preference</option>
                    <option value="morning">Morning</option>
                    <option value="afternoon">Afternoon</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-civic-600">
                    Preferred Day
                  </label>
                  <select
                    value={preferredDow}
                    onChange={(e) => setPreferredDow(e.target.value)}
                    className="w-full rounded-lg border border-civic-200 px-3 py-2 text-sm focus:border-civic-500 focus:outline-none"
                    aria-label="Preferred day of week"
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

              {/* Found slot display */}
              {foundSlot && (
                <div className="rounded-lg border border-go-200 bg-go-50 p-3">
                  <p className="text-sm font-medium text-go-700">Available slot found:</p>
                  <div className="mt-1 space-y-1 text-sm text-go-800">
                    <div className="flex items-center gap-2">
                      <Calendar size={14} />
                      <span>{foundSlot.dateFormatted}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock size={14} />
                      <span>{foundSlot.timeFormatted}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <MapPin size={14} />
                      <span>{foundSlot.officeName}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                {!foundSlot ? (
                  <Button
                    loading={actionLoading}
                    disabled={!email.trim()}
                    onClick={handleFindSlot}
                  >
                    Find Available Slot
                  </Button>
                ) : (
                  <>
                    <Button
                      loading={actionLoading}
                      onClick={handleConfirmReschedule}
                    >
                      Confirm Reschedule
                    </Button>
                    <Button
                      variant="outline"
                      disabled={actionLoading}
                      onClick={() => { setFoundSlot(null); setError(null); }}
                    >
                      Try Different Preferences
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => { setMode("view"); setError(null); setFoundSlot(null); }}>
                  Back
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
