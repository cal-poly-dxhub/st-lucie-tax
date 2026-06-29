/**
 * Transcript email composer. Pure function — no I/O, no side effects. Takes a
 * session snapshot + chronological transcript and renders subject, plain text,
 * and minimal HTML. Testable with a fixture.
 */

import type { Session, FactValue } from "@st-lucie/shared-types";
import { loadFactDefinitions } from "../data-loaders/fact-definitions.js";

export interface TranscriptInput {
  session: Session;
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface TranscriptEmail {
  subject: string;
  textBody: string;
  htmlBody: string;
}

export function buildTranscriptEmail(input: TranscriptInput): TranscriptEmail {
  const { session, transcript } = input;
  const ctx = session.structuredContext;
  const defs = loadFactDefinitions();
  const defByKey = new Map(defs.map((d) => [d.factKey, d]));

  const txns = ctx.transactions.filter((t) => t.status === "active");
  const blockedTxns = ctx.transactions.filter((t) => t.status === "blocked" && t.blockingInfo);
  const totalMin = txns.reduce((sum, t) => sum + (t.durationMinutes || 0), 0);
  const subject =
    txns.length > 0
      ? `Your St. Lucie Tax Collector visit plan: ${txns.map((t) => t.name).join(", ")}`
      : blockedTxns.length > 0
        ? "Before your St. Lucie Tax Collector visit — action needed"
        : "Your St. Lucie Tax Collector visit plan";

  // ---- Plain-text body ----
  const lines: string[] = [];
  lines.push("Your St. Lucie County Tax Collector visit plan");
  lines.push("=".repeat(48));
  lines.push("");

  if (blockedTxns.length > 0) {
    lines.push("CANNOT BE PROCESSED TODAY");
    lines.push("-".repeat(48));
    for (const t of blockedTxns) {
      const b = t.blockingInfo!;
      lines.push(`  ✗ ${t.name}`);
      lines.push(`      ${b.customerMessage}`);
      if (b.nextSteps) lines.push(`      Next: ${b.nextSteps}`);
      lines.push("");
    }
  }

  if (txns.length > 0) {
    lines.push("SERVICES");
    lines.push("-".repeat(48));
    for (const t of txns) lines.push(`  • ${t.name}  (~${t.durationMinutes} min)`);
    lines.push(`  Total estimated time: ${totalMin} min`);
    lines.push("");
  }

  // Finalized answers (asserted + inferred, skip 'unknown')
  const factEntries = Object.entries(ctx.facts || {}).filter(([, v]) => v.confidence !== "unknown");
  if (factEntries.length > 0) {
    lines.push("YOUR ANSWERS");
    lines.push("-".repeat(48));
    for (const [key, val] of factEntries) {
      const def = defByKey.get(key);
      const label = def?.questionText ?? def?.label ?? key;
      lines.push(`  Q: ${label}`);
      lines.push(`  A: ${val.value}  (${val.confidence})`);
      lines.push("");
    }
  }

  const buckets = ctx.resolvedBuckets;
  if (buckets) {
    if (buckets.bringIns.length > 0) {
      lines.push("BRING TO YOUR APPOINTMENT");
      lines.push("-".repeat(48));
      for (const item of buckets.bringIns) lines.push(`  • ${item.label}`);
      lines.push("");
    }
    if (buckets.optionalUploads.length > 0) {
      lines.push("UPLOAD BEFORE YOUR VISIT (optional)");
      lines.push("-".repeat(48));
      for (const item of buckets.optionalUploads) lines.push(`  • ${item.label}`);
      lines.push("");
    }
    if (buckets.forms.length > 0) {
      lines.push("FORMS TO COMPLETE BEFORE YOU COME");
      lines.push("-".repeat(48));
      for (const item of buckets.forms) {
        lines.push(`  • ${item.label}`);
        if (item.source) lines.push(`      ${item.source}`);
      }
      lines.push("");
    }
  }

  if (transcript.length > 0) {
    lines.push("CONVERSATION TRANSCRIPT");
    lines.push("-".repeat(48));
    for (const turn of transcript) {
      lines.push(`[${turn.role.toUpperCase()}]`);
      lines.push(turn.content);
      lines.push("");
    }
  }

  lines.push("---");
  lines.push(`Generated ${new Date().toISOString()}. Reply to this email for help.`);

  const textBody = lines.join("\n");

  // ---- Minimal HTML body ----
  const htmlBody = renderHtml({
    subject,
    txns,
    blockedTxns,
    totalMin,
    factEntries,
    defByKey,
    buckets,
    transcript,
  });

  return { subject, textBody, htmlBody };
}

function renderHtml(args: {
  subject: string;
  txns: Array<{ name: string; durationMinutes: number }>;
  blockedTxns: Session["structuredContext"]["transactions"];
  totalMin: number;
  factEntries: Array<[string, FactValue]>;
  defByKey: Map<string, { questionText?: string; label?: string }>;
  buckets?: Session["structuredContext"]["resolvedBuckets"];
  transcript: Array<{ role: "user" | "assistant"; content: string }>;
}): string {
  const esc = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const parts: string[] = [];
  parts.push(
    '<!DOCTYPE html><html><body style="font-family:system-ui,sans-serif;max-width:720px;margin:0 auto;padding:20px;color:#222;">',
  );
  parts.push(`<h1 style="color:#0d4d8a;margin-bottom:4px;">Your visit plan</h1>`);
  parts.push(`<p style="color:#666;margin-top:0;">${esc(args.subject)}</p>`);

  if (args.blockedTxns.length > 0) {
    parts.push(
      '<div style="background:#fff4f4;border:1px solid #e0a6a6;border-radius:6px;padding:16px;margin:16px 0;">',
    );
    parts.push('<h2 style="color:#a33;margin:0 0 8px 0;">Cannot be processed today</h2>');
    parts.push(
      '<p style="margin:0 0 12px 0;">The following services need action before your visit. Do not come into the office for these until they are resolved.</p>',
    );
    for (const t of args.blockedTxns) {
      const b = t.blockingInfo!;
      parts.push(`<div style="margin:10px 0;"><strong>✗ ${esc(t.name)}</strong>`);
      parts.push(`<div style="color:#444;margin-top:4px;">${esc(b.customerMessage)}</div>`);
      if (b.nextSteps) {
        parts.push(
          `<div style="color:#0d4d8a;margin-top:6px;"><strong>Next:</strong> ${esc(b.nextSteps)}</div>`,
        );
      }
      parts.push("</div>");
    }
    parts.push("</div>");
  }

  if (args.txns.length > 0) {
    parts.push("<h2>Services</h2><ul>");
    for (const t of args.txns) {
      parts.push(
        `<li>${esc(t.name)} <span style="color:#999;">(~${t.durationMinutes} min)</span></li>`,
      );
    }
    parts.push(`</ul><p><strong>Total estimated time:</strong> ${args.totalMin} min</p>`);
  }

  if (args.factEntries.length > 0) {
    parts.push(
      '<h2>Your answers</h2><table cellpadding="8" style="border-collapse:collapse;width:100%;">',
    );
    for (const [key, val] of args.factEntries) {
      const def = args.defByKey.get(key);
      const label = def?.questionText ?? def?.label ?? key;
      parts.push(
        `<tr style="border-bottom:1px solid #eee;"><td style="color:#555;">${esc(label)}</td><td><strong>${esc(val.value)}</strong> <span style="color:#999;font-size:0.85em;">(${esc(val.confidence)})</span></td></tr>`,
      );
    }
    parts.push("</table>");
  }

  const b = args.buckets;
  if (b) {
    if (b.bringIns.length > 0) {
      parts.push("<h2>Bring to your appointment</h2><ul>");
      for (const i of b.bringIns) parts.push(`<li>${esc(i.label)}</li>`);
      parts.push("</ul>");
    }
    if (b.optionalUploads.length > 0) {
      parts.push("<h2>Upload before your visit (optional)</h2><ul>");
      for (const i of b.optionalUploads) parts.push(`<li>${esc(i.label)}</li>`);
      parts.push("</ul>");
    }
    if (b.forms.length > 0) {
      parts.push("<h2>Forms to complete before you come</h2><ul>");
      for (const i of b.forms) {
        const link = i.source
          ? ` <a href="${esc(i.source)}" style="color:#0d4d8a;">download</a>`
          : "";
        parts.push(`<li>${esc(i.label)}${link}</li>`);
      }
      parts.push("</ul>");
    }
  }

  if (args.transcript.length > 0) {
    parts.push("<h2>Conversation transcript</h2>");
    for (const turn of args.transcript) {
      const color = turn.role === "user" ? "#0d4d8a" : "#555";
      parts.push(
        `<p><strong style="color:${color};">${turn.role.toUpperCase()}:</strong><br>${esc(turn.content).replace(/\n/g, "<br>")}</p>`,
      );
    }
  }

  parts.push(
    `<hr style="border:none;border-top:1px solid #eee;margin-top:32px;"><p style="color:#888;font-size:0.85em;">Generated ${new Date().toISOString()}. Reply to this email for help.</p>`,
  );
  parts.push("</body></html>");
  return parts.join("");
}
