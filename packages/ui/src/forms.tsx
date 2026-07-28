import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cn } from "./cn";

const controlBase =
  "w-full rounded-lg border border-civic-200 bg-white px-3 py-2 text-sm text-ink transition-colors " +
  "placeholder:text-civic-300 focus:border-civic-400 focus:outline-2 focus:outline-offset-0 focus:outline-civic-400/40 " +
  "disabled:cursor-not-allowed disabled:bg-civic-50 disabled:text-civic-400";

/** Labelled form row. `hint` sits under the control; `error` replaces it. */
export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label
        htmlFor={htmlFor}
        className="text-[11px] font-bold uppercase tracking-[0.12em] text-civic-500"
      >
        {label}
        {required && <span className="ml-0.5 text-stop-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs font-medium text-stop-700">{error}</p>
      ) : hint ? (
        <p className="text-xs text-civic-400">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({
  className,
  invalid,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, invalid && "border-stop-200 focus:border-stop-500", className)}
    />
  );
}

export function Select({
  className,
  invalid,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(controlBase, invalid && "border-stop-200 focus:border-stop-500", className)}
    >
      {children}
    </select>
  );
}

export function Textarea({
  className,
  invalid,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      {...props}
      aria-invalid={invalid || undefined}
      className={cn(
        controlBase,
        "resize-y",
        invalid && "border-stop-200 focus:border-stop-500",
        className,
      )}
    />
  );
}

/**
 * Borderless control for editing a value in place inside a table cell. Reads as
 * text until focused, so a table in edit mode stays scannable.
 */
export function InlineInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-ink",
        "hover:border-civic-200 hover:bg-white",
        "focus:border-civic-400 focus:bg-white focus:outline-none",
        "disabled:text-civic-400",
        className,
      )}
    />
  );
}

/** Checkbox sized and coloured for matrix cells. */
export function Check({
  className,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      {...props}
      type="checkbox"
      className={cn(
        "size-4 cursor-pointer rounded border-civic-300 text-civic-500 accent-civic-500",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-civic-400",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    />
  );
}
