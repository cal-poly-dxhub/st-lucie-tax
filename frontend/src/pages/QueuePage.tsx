import { useEffect, useState } from "react";
import { RefreshCw, Users, Zap } from "lucide-react";
import { api, type QueueEntry, type ClerkSession, type TxnType } from "@/lib/api";
import { useToast } from "@/components/toast-context";
import { Badge, Button, Card, SectionLabel } from "@/components/ui";

export function QueuePage() {
  const notify = useToast();
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [clerks, setClerks] = useState<ClerkSession[]>([]);
  const [txnTypes, setTxnTypes] = useState<TxnType[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const data = await api.liveQueue();
      setQueue(data.queue);
      setClerks(data.clerks);
      if (data.txnTypes) setTxnTypes(data.txnTypes);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, []);

  async function seed() {
    try {
      const res = await api.seedQueue();
      if (res.ok) {
        notify("success", `Seeded ${res.seeded.length} customers into queue.`);
        load();
      }
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Server not running.");
    }
  }

  const txnMap = Object.fromEntries(txnTypes.map((t) => [t.id, t.name]));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Users className="text-civic-500" size={20} />
            <div>
              <h2 className="font-display text-xl font-bold text-civic-800">Live Queue</h2>
              <p className="text-sm text-civic-500">
                All customers currently in the queue, loaded from the database.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="border-warn-200 text-warn-700 hover:bg-warn-50"
              onClick={seed}
            >
              <Zap size={14} /> Seed 5
            </Button>
            <Button variant="outline" onClick={load}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        {loading ? (
          <p className="text-center text-sm text-civic-400">Loading queue…</p>
        ) : queue.length === 0 ? (
          <p className="text-center text-sm text-civic-400">
            Queue is empty. Check in a customer to see them here.
          </p>
        ) : (
          <div className="space-y-2">
            {queue.map((q) => (
              <div
                key={q.id}
                className={`flex items-center gap-4 rounded-lg border px-4 py-3 ${
                  q.is_priority
                    ? "border-l-4 border-l-warn-500 border-warn-200 bg-warn-50"
                    : "border-civic-100 bg-white"
                }`}
              >
                <div className={`text-2xl font-bold ${q.is_priority ? "text-warn-700" : "text-civic-700"}`}>
                  {q.is_priority ? "P" : ""}
                  {q.queue_number}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {q.first_name} {q.last_name}
                    {q.is_priority && (
                      <Badge tone="warn" className="ml-2">Priority</Badge>
                    )}
                  </div>
                  <div className="text-xs text-civic-400">
                    {(q.txn_type_ids ?? []).map((id) => txnMap[id] || "Unknown").join(", ")}
                    {q.checked_in_at && (
                      <>
                        {" | Checked in "}
                        {new Date(q.checked_in_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </>
                    )}
                  </div>
                </div>
                <Badge
                  tone={
                    q.status === "serving" ? "civic" : q.status === "testing" ? "warn" : "neutral"
                  }
                >
                  {q.status === "serving" ? `Serving — Desk ${q.assigned_desk}` : q.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <SectionLabel>Clerk Sessions</SectionLabel>
        {clerks.length === 0 ? (
          <p className="mt-2 text-center text-sm text-civic-400">No clerk sessions active.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-civic-100 text-left text-xs font-semibold uppercase text-civic-400">
                <th className="pb-2">Clerk</th>
                <th className="pb-2">Desk</th>
                <th className="pb-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {clerks.map((c, i) => (
                <tr key={i} className="border-b border-civic-50">
                  <td className="py-2 font-medium text-ink">{c.name ?? `Desk ${c.desk_number}`}</td>
                  <td className="py-2 text-civic-500">{c.desk_number}</td>
                  <td className="py-2">
                    <Badge tone={c.is_available ? "go" : "civic"}>
                      {c.is_available ? "Available" : "Serving"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </main>
  );
}
