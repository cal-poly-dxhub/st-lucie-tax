import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type QueueEntry } from "@/lib/api";

export function LobbyDisplay() {
  const [serving, setServing] = useState<QueueEntry[]>([]);
  const [waiting, setWaiting] = useState<QueueEntry[]>([]);

  async function load() {
    try {
      const data = await api.liveQueue();
      setServing(data.queue.filter((q) => q.status === "serving"));
      setWaiting(data.queue.filter((q) => q.status === "waiting"));
    } catch {
      // silent — lobby just shows stale data
    }
  }

  useEffect(() => {
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#1a202c] p-8">
      <Link
        to="/check-in"
        className="fixed left-4 top-4 inline-flex items-center gap-1.5 rounded-lg bg-[#4a5568] px-4 py-2.5 text-sm font-semibold text-gray-200 transition-colors hover:bg-[#2d3748] hover:text-white"
      >
        ← Office Ops
      </Link>

      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-white">St. Lucie County Tax Collector</h1>
        <p className="mt-1 text-sm text-gray-400">Now Serving</p>
      </div>

      <div className="grid w-full max-w-[900px] grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
        {serving.length > 0 ? (
          serving.map((q, i) => (
            <div
              key={q.id}
              className={`rounded-xl p-6 text-center text-white ${
                i === 0 ? "animate-lobby-pulse bg-[#38a169]" : "bg-[#2d3748]"
              }`}
            >
              <div className="text-[56px] font-bold leading-none">
                {q.queue_number}
              </div>
              <div className="mt-2 text-sm opacity-80">Desk {q.assigned_desk}</div>
            </div>
          ))
        ) : (
          <p className="col-span-full text-center text-gray-500">No one being served</p>
        )}
      </div>

      <h2 className="mt-8 text-lg font-bold text-white/70">Up Next</h2>
      <div className="mt-4 text-center text-[40px] font-bold tracking-[4px] text-gray-400">
        {waiting.length > 0
          ? waiting
              .slice(0, 8)
              .map((q) => q.queue_number)
              .join("   ")
          : "—"}
      </div>
    </div>
  );
}
