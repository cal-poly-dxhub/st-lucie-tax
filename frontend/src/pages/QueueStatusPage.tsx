import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Card, Button, Badge, SectionLabel } from "@st-lucie/ui";
import { Clock, Users, MapPin, CheckCircle, ArrowRight } from "lucide-react";

const API_BASE = import.meta.env.VITE_API_URL ?? "";

interface QueueStatusData {
  inQueue: true;
  firstName: string;
  queueNumber: number;
  status: "waiting" | "serving" | "testing" | "done";
  assignedDesk: number | null;
  positionAhead: number;
  checkedInAt: string;
}

interface AppointmentStatusData {
  inQueue: false;
  appointment: {
    firstName: string;
    date: string;
    time: string | null;
    status: string;
    officeName: string;
  };
}

type StatusData = QueueStatusData | AppointmentStatusData;

async function fetchStatus(code: string): Promise<StatusData> {
  const res = await fetch(`${API_BASE}/api/queue/status/${encodeURIComponent(code)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Not found");
  }
  return res.json();
}

function statusLabel(status: string) {
  switch (status) {
    case "waiting":
      return "Waiting";
    case "serving":
      return "Being served";
    case "testing":
      return "Written test";
    case "done":
      return "Complete";
    default:
      return status;
  }
}

function statusTone(status: string): "neutral" | "warn" | "go" {
  switch (status) {
    case "serving":
      return "go";
    case "waiting":
      return "warn";
    default:
      return "neutral";
  }
}

export function QueueStatusPage() {
  const { code } = useParams<{ code: string }>();
  const [manualCode, setManualCode] = useState("");
  const [lookupCode, setLookupCode] = useState(code ?? "");
  const [data, setData] = useState<StatusData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function load(c: string) {
    if (!c) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetchStatus(c);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load status");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  // Initial load and auto-refresh every 10 seconds
  useEffect(() => {
    if (!lookupCode) return;
    load(lookupCode);
    const interval = setInterval(() => load(lookupCode), 10_000);
    return () => clearInterval(interval);
  }, [lookupCode]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (manualCode.trim()) {
      setLookupCode(manualCode.trim().toUpperCase());
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="mb-2 text-center font-display text-2xl font-bold text-civic-900">
        Queue Status
      </h1>
      <p className="mb-6 text-center text-sm text-civic-500">
        Check your position in the queue using your confirmation code.
      </p>

      {/* Lookup form */}
      {!code && (
        <form onSubmit={handleSubmit} className="mb-6 flex gap-2">
          <input
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="Confirmation code"
            className="flex-1 rounded-lg border border-civic-200 px-4 py-2 text-sm focus:border-civic-500 focus:outline-none"
            aria-label="Confirmation code"
          />
          <Button type="submit" disabled={!manualCode.trim() || loading}>
            Check
          </Button>
        </form>
      )}

      {/* Loading */}
      {loading && !data && (
        <p className="py-8 text-center text-sm text-civic-400">Loading...</p>
      )}

      {/* Error */}
      {error && (
        <Card className="border-stop-200 bg-stop-50 p-4">
          <p className="text-sm font-medium text-stop-700">{error}</p>
        </Card>
      )}

      {/* Queue status display */}
      {data && data.inQueue && (
        <Card className="p-6">
          <p className="mb-4 text-sm text-civic-600">
            Hi <span className="font-semibold">{data.firstName}</span>!
          </p>

          <div className="mb-4 flex items-center justify-between">
            <SectionLabel>Your number</SectionLabel>
            <span className="text-3xl font-bold text-civic-900">#{data.queueNumber}</span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Badge tone={statusTone(data.status)}>{statusLabel(data.status)}</Badge>
            </div>

            {data.status === "waiting" && (
              <div className="flex items-center gap-2 text-sm text-civic-600">
                <Users size={16} />
                <span>
                  {data.positionAhead === 0
                    ? "You're next!"
                    : `${data.positionAhead} ${data.positionAhead === 1 ? "person" : "people"} ahead of you`}
                </span>
              </div>
            )}

            {data.status === "serving" && data.assignedDesk && (
              <div className="flex items-center gap-2 rounded-lg bg-go-50 px-4 py-3 text-sm font-semibold text-go-700">
                <ArrowRight size={16} />
                <span>Please proceed to Desk {data.assignedDesk}</span>
              </div>
            )}

            {data.status === "testing" && (
              <div className="flex items-center gap-2 text-sm text-civic-600">
                <CheckCircle size={16} />
                <span>Complete your written test — you'll be called back after.</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-civic-400">
              <Clock size={12} />
              <span>Checked in at {new Date(data.checkedInAt).toLocaleTimeString()}</span>
            </div>
          </div>

          <p className="mt-4 text-center text-xs text-civic-400">
            Auto-refreshes every 10 seconds
          </p>
        </Card>
      )}

      {/* Not in queue — show appointment info */}
      {data && !data.inQueue && (
        <Card className="p-6">
          <p className="mb-4 text-sm text-civic-600">
            Hi <span className="font-semibold">{data.appointment.firstName}</span>!
          </p>
          <SectionLabel>Appointment details</SectionLabel>
          <div className="mt-2 space-y-2 text-sm text-civic-700">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-civic-400" />
              <span>{data.appointment.officeName}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-civic-400" />
              <span>
                {data.appointment.date}
                {data.appointment.time ? ` at ${data.appointment.time}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral">{data.appointment.status}</Badge>
            </div>
          </div>
          <p className="mt-4 text-xs text-civic-400">
            You haven't checked in yet. Present your confirmation code at the front desk.
          </p>
        </Card>
      )}
    </div>
  );
}
