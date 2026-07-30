import { useEffect, useState } from "react";
import { Building2, MapPin, CalendarDays, Loader2 } from "lucide-react";
import { api, type ConfigResponse, type CustomerRecord } from "@/lib/api";
import { useToast } from "@st-lucie/ui";
import { LookupPanel } from "@/components/LookupPanel";
import { RecordCard } from "@/components/RecordCard";
import { ReadinessRail } from "@/components/ReadinessRail";

export function CheckInDesk() {
  const notify = useToast();
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [officeId, setOfficeId] = useState(1);
  const [record, setRecord] = useState<CustomerRecord | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  useEffect(() => {
    api
      .config()
      .then((cfg) => {
        setConfig(cfg);
        if (cfg.offices[0]) setOfficeId(cfg.offices[0].id);
      })
      .catch((err) => notify("error", err instanceof Error ? err.message : "Failed to load config."));
  }, [notify]);

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("code");
    if (!code) return;
    api
      .lookup(code.trim())
      .then((result) => {
        if (result.found) setRecord(result);
        else notify("error", "No appointment found for that code.");
      })
      .catch((err) => notify("error", err instanceof Error ? err.message : "Lookup failed."));
  }, [notify]);

  async function loadRecord(appointmentId: number) {
    setLoadingId(appointmentId);
    try {
      const result = await api.lookupById(appointmentId);
      if (!result.found) {
        notify("error", "Appointment not found.");
        return;
      }
      setRecord(result);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Failed to load record.");
    } finally {
      setLoadingId(null);
    }
  }

  async function refreshRecord() {
    if (!record) return;
    try {
      const result = await api.lookupById(record.appointmentId);
      if (result.found) setRecord(result);
    } catch (err) {
      notify("error", err instanceof Error ? err.message : "Failed to refresh record.");
    }
  }

  const office = config?.offices.find((o) => o.id === officeId);
  const date = config?.demoDate ?? "";

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-1.5 text-sm text-civic-500">
          <MapPin size={14} />
          <span className="font-medium">{office?.name ?? "Loading…"}</span>
          {office && <span className="text-civic-300">· {office.total_desks} desks</span>}
        </div>

        <div className="flex items-center gap-2">
          {config && (
            <div className="flex items-center gap-1.5 rounded-lg border border-civic-200 bg-white px-2.5 py-1.5">
              <Building2 size={15} className="text-civic-400" />
              <select
                value={officeId}
                onChange={(e) => {
                  setOfficeId(Number(e.target.value));
                  setRecord(null);
                }}
                className="bg-transparent text-sm font-semibold text-ink outline-none"
              >
                {config.offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {date && (
            <div className="flex items-center gap-1.5 rounded-lg border border-civic-200 bg-white px-2.5 py-1.5 text-sm font-medium text-civic-600">
              <CalendarDays size={15} className="text-civic-300" />
              <span className="tnum">{date}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <LookupPanel officeId={officeId} date={date} onLoad={loadRecord} loadingId={loadingId} />

          {loadingId !== null && !record && (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-civic-100 bg-white/70 py-12 text-civic-400">
              <Loader2 className="animate-spin" size={18} /> Loading record…
            </div>
          )}

          {record ? (
            <RecordCard record={record} onMutated={refreshRecord} onDismiss={() => setRecord(null)} />
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-civic-200 bg-white/50 px-6 py-16 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-civic-50 text-civic-300">
                <MapPin size={26} />
              </div>
              <h3 className="mt-4 font-display text-lg font-semibold text-civic-700">
                No customer loaded
              </h3>
              <p className="mt-1 max-w-sm text-sm text-civic-400">
                Scan a QR code or search by name above to pull up a customer's appointment,
                documents, and readiness checklist.
              </p>
            </div>
          )}
        </div>

        <ReadinessRail record={record} />
      </div>
    </main>
  );
}
