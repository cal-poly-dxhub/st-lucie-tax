import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

type Tone = "go" | "civic" | "warn" | "stop" | "neutral";

const badgeTone: Record<Tone, string> = {
  go: "bg-go-50 text-go-700 ring-go-300/50",
  civic: "bg-civic-50 text-civic-700 ring-civic-300/50",
  warn: "bg-warn-50 text-warn-700 ring-warn-200",
  stop: "bg-stop-50 text-stop-700 ring-stop-200",
  neutral: "bg-civic-950/5 text-civic-800 ring-civic-950/10",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        badgeTone[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

type Variant = "go" | "civic" | "ghost" | "outline";

const buttonVariant: Record<Variant, string> = {
  go: "bg-go-500 text-white hover:bg-go-600 active:bg-go-700 shadow-sm shadow-go-700/20",
  civic: "bg-civic-500 text-white hover:bg-civic-600 active:bg-civic-700 shadow-sm shadow-civic-900/20",
  outline: "border border-civic-200 bg-white text-civic-700 hover:border-civic-400 hover:bg-civic-50",
  ghost: "text-civic-600 hover:bg-civic-50",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
}

export function Button({
  variant = "civic",
  loading,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-civic-400",
        "disabled:cursor-not-allowed disabled:opacity-50",
        buttonVariant[variant],
        className,
      )}
    >
      {loading && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  );
}

export function Card({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={style}
      className={cn(
        "rounded-2xl border border-civic-100 bg-white/90 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_18px_40px_-24px_rgba(8,37,57,0.35)] backdrop-blur",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-civic-400">
      {children}
    </div>
  );
}
