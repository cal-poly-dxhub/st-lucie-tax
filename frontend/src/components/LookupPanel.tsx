import { useState } from "react";
import { QrCode, Search, ScanLine, UserSearch, Clock } from "lucide-react";
import { api, type NameMatch } from "@/lib/api";
import { Button, Card, SectionLabel } from "./ui";
import { useToast } from "./toast-context";

interface Props {
  officeId: number;
  date: string;
  onLoad: (appointmentId: number) => void;
  loadingId: number | null;
}

export function LookupPanel({ officeId, date, onLoad, loadingId }: Props) {
  const notify = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [matches, setMatches] = useState<NameMatch[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [scanning, setScanning] = useState(false);

  async function lookupByCode() {
    const trimmed = code.trim();
    if (!trimmed) return;
    setScanning(true);
    try {
      const result = await api.lookup(trimmed);
      if (!result.found) {
        notify("error", "No appointment found for that code.");
        return;
      }
      onLoad(result.appointmentId);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Lookup failed.");
    } finally {
      setScanning(false);
    }
  }

  async function searchByName() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSearching(true);
    try {
      const results = await api.searchName(trimmed, officeId, date);
      setMatches(results);
      if (results.length === 0) notify("error", `No scheduled matches for "${trimmed}".`);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card className="animate-rise overflow-hidden">
      <div className="flex items-center gap-2 border-b border-civic-100 px-6 py-4">
        <ScanLine className="text-civic-500" size={18} />
        <h2 className="font-display text-lg font-semibold tracking-tight text-civic-800">
          Find a customer
        </h2>
      </div>

      <div className="grid gap-px bg-civic-100 md:grid-cols-2">
        {/* QR / confirmation code */}
        <div className="bg-white p-6">
          <SectionLabel>Scan / confirmation code</SectionLabel>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-civic-200 bg-civic-50/60 px-3 py-2.5 focus-within:border-civic-400">
            <QrCode className="shrink-0 text-civic-400" size={18} />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && lookupByCode()}
              placeholder="Scan QR or paste code…"
              className="tnum w-full bg-transparent font-mono text-sm text-ink outline-none placeholder:text-civic-300"
            />
          </div>
          <Button
            variant="civic"
            onClick={lookupByCode}
            loading={scanning}
            className="mt-3 w-full"
          >
            <ScanLine size={16} /> Load record
          </Button>
          <p className="mt-3 text-xs leading-relaxed text-civic-400">
            Hardware scanners type into the field and submit on Enter. Seed codes are UUIDs.
          </p>
        </div>

        {/* Name search */}
        <div className="bg-white p-6">
          <SectionLabel>Search by name</SectionLabel>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-civic-200 bg-civic-50/60 px-3 py-2.5 focus-within:border-civic-400">
            <UserSearch className="shrink-0 text-civic-400" size={18} />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchByName()}
              placeholder="First or last name…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-civic-300"
            />
          </div>
          <Button
            variant="outline"
            onClick={searchByName}
            loading={searching}
            className="mt-3 w-full"
          >
            <Search size={16} /> Search scheduled
          </Button>

          {matches && matches.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {matches.map((m) => {
                const busy = loadingId === m.appointmentId;
                return (
                  <li key={m.appointmentId}>
                    <button
                      onClick={() => onLoad(m.appointmentId)}
                      disabled={busy}
                      className="group flex w-full items-center justify-between rounded-lg border border-civic-100 bg-white px-3 py-2 text-left transition-all hover:border-civic-300 hover:bg-civic-50 disabled:opacity-60"
                    >
                      <span className="text-sm font-semibold text-ink">
                        {m.firstName} {m.lastName}
                      </span>
                      <span className="flex items-center gap-1 font-mono text-xs text-civic-400">
                        <Clock size={12} />
                        {m.appointmentTime?.slice(0, 5) ?? "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
