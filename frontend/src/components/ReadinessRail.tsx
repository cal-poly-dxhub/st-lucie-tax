import { Check, Circle, ShieldCheck, ClipboardList, FileCheck2, Minus, Users } from "lucide-react";
import type { CustomerRecord } from "@/lib/api";
import { cn } from "@st-lucie/ui";

interface StepProps {
  icon: React.ReactNode;
  label: string;
  detail: string;
  state: "done" | "pending" | "blocked";
  last?: boolean;
}

function Step({ icon, label, detail, state, last }: StepProps) {
  return (
    <li className="relative flex gap-3.5 pl-1">
      {!last && (
        <span
          className={cn(
            "absolute left-[18px] top-9 h-[calc(100%-12px)] w-px",
            state === "done" ? "bg-go-300" : "bg-civic-100",
          )}
        />
      )}
      <span
        className={cn(
          "relative z-10 grid size-9 shrink-0 place-items-center rounded-full ring-1 ring-inset transition-colors",
          state === "done" && "bg-go-500 text-white ring-go-600",
          state === "pending" && "bg-white text-civic-300 ring-civic-200",
          state === "blocked" && "bg-stop-50 text-stop-500 ring-stop-200",
        )}
      >
        {state === "done" ? <Check size={16} strokeWidth={3} /> : icon}
      </span>
      <div className="pb-6 pt-1">
        <div
          className={cn(
            "text-sm font-semibold",
            state === "done" ? "text-civic-800" : "text-civic-600",
          )}
        >
          {label}
        </div>
        <div className="text-xs text-civic-400">{detail}</div>
      </div>
    </li>
  );
}

export function ReadinessRail({ record }: { record: CustomerRecord | null }) {
  const isInQueue = record
    ? record.status === "checked-in" || record.status === "serving"
    : false;
  const docsValidated = record ? record.docs.filter((d) => d.clerkValidated).length : 0;
  const docsRequired = record ? record.docs.length : 0;

  return (
    <aside className="lg:sticky lg:top-8">
      <div className="overflow-hidden rounded-2xl border border-civic-800/40 bg-gradient-to-b from-civic-800 to-civic-950 text-white shadow-[0_24px_60px_-30px_rgba(8,37,57,0.9)]">
        <div className="border-b border-white/10 px-5 py-4">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-civic-200">
            Check-In Progress
          </div>
          {record ? (
            <div className="mt-1 font-display text-xl font-semibold tracking-tight">
              {record.firstName} {record.lastName}
            </div>
          ) : (
            <div className="mt-1 font-display text-xl font-semibold tracking-tight text-white/40">
              No record loaded
            </div>
          )}
        </div>

        <div className="px-5 py-5">
          {!record ? (
            <p className="text-sm leading-relaxed text-civic-200/70">
              Scan a QR code or search by name to begin. Verify identity, then send the customer
              for pre-screen — they'll join the queue automatically.
            </p>
          ) : (
            <ul>
              <Step
                icon={<ShieldCheck size={16} />}
                label="Identity verified"
                detail={record.identityVerified ? "Confirmed" : "Verify photo ID in person or via AuthID"}
                state={record.identityVerified ? "done" : "pending"}
              />
              <Step
                icon={<ClipboardList size={16} />}
                label="Pre-screen sent"
                detail={
                  record.prescreenCompleted
                    ? "Completed"
                    : isInQueue
                      ? "Completed"
                      : "Sent to customer's email"
                }
                state={record.prescreenCompleted || isInQueue ? "done" : "pending"}
              />
              <Step
                icon={<Users size={16} />}
                label="In queue"
                detail={isInQueue ? "Waiting or being served" : "Auto-joins after pre-screen"}
                state={isInQueue ? "done" : "pending"}
              />
              <Step
                icon={<FileCheck2 size={16} />}
                label="Documents validated"
                detail={
                  docsRequired === 0
                    ? "None required"
                    : `${docsValidated} of ${docsRequired} validated`
                }
                state={
                  docsRequired === 0 || docsValidated === docsRequired ? "done" : "pending"
                }
                last
              />
            </ul>
          )}
        </div>

        {record && (
          <div
            className={cn(
              "flex items-center gap-3 border-t px-5 py-4",
              isInQueue ? "border-go-500/30 bg-go-500/10" : "border-white/10 bg-white/5",
            )}
          >
            {isInQueue ? (
              <>
                <span className="grid size-8 place-items-center rounded-full bg-go-500 text-white">
                  <Check size={16} strokeWidth={3} />
                </span>
                <div>
                  <div className="text-sm font-bold text-go-300">In the queue</div>
                  <div className="text-xs text-civic-200/70">Customer is waiting for service</div>
                </div>
              </>
            ) : (
              <>
                <span className="grid size-8 place-items-center rounded-full bg-white/10 text-civic-200">
                  <Minus size={16} strokeWidth={3} />
                </span>
                <div>
                  <div className="text-sm font-bold text-white">
                    {record.identityVerified ? "Awaiting pre-screen" : "Verify identity to proceed"}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-civic-200/70">
                    <Circle size={8} className="fill-current" /> Not yet in queue
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
