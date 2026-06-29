/**
 * Beta-tester transcript PDF generator.
 *
 * Sections, in order:
 *   1. Cover (sessionId, current state, dates, tester notes)
 *   2. Per-message feedback summary (good/bad/comment counts + comments)
 *   3. Conversation transcript
 *   4. Facts (asserted + inferred + unknown)
 *   5. Transactions (active + blocked)
 *   6. Debug-log appendix (one block per LOG# event)
 *
 * Returns a complete Buffer so the caller can stream it as application/pdf.
 */
import PDFDocument from "pdfkit";
import type { Session } from "@st-lucie/shared-types";

export interface TranscriptPdfInput {
  session: Session;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp?: string;
    messageId?: string;
  }>;
  debugLogs: Array<{ timestamp: string; eventType: string; payload: unknown }>;
  notes?: string;
  messageFeedback?: Record<
    string,
    {
      reaction?: "good" | "bad";
      comment?: string;
      submittedAt?: string;
    }
  >;
}

export async function buildTranscriptPdf(input: TranscriptPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "LETTER", margin: 54 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const { session, messages, debugLogs, notes, messageFeedback } = input;
  const ctx = session.structuredContext;
  const facts = ctx.facts || {};
  const txns = ctx.transactions || [];

  // ---- 1. COVER ----
  doc
    .fontSize(18)
    .fillColor("#0d4d8a")
    .text("St. Lucie Tax Collector — Beta Tester Transcript", { align: "left" });
  doc.moveDown(0.5);
  // Tester email goes first so anyone triaging knows whose session this is
  // before they read the rest.
  if (session.betaTesterEmail) {
    doc.fontSize(11).fillColor("#222").text(`Beta tester: ${session.betaTesterEmail}`);
    doc.moveDown(0.2);
  }
  doc.fontSize(10).fillColor("#555").text(`Session: ${session.sessionId}`);
  doc.text(`Current state: ${session.currentState}`);
  doc.text(`Created: ${session.createdAt}`);
  doc.text(`Updated: ${session.updatedAt}`);
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.moveDown();

  if (notes && notes.trim().length > 0) {
    sectionHeading(doc, "Tester notes");
    doc.fontSize(10).fillColor("#222").text(notes, { paragraphGap: 4 });
    doc.moveDown();
  }

  // ---- 2. PER-MESSAGE FEEDBACK SUMMARY ----
  if (messageFeedback && Object.keys(messageFeedback).length > 0) {
    sectionHeading(doc, "Per-message reactions");
    let goodCount = 0;
    let badCount = 0;
    const comments: Array<{ messageId: string; text: string }> = [];
    for (const [mid, fb] of Object.entries(messageFeedback)) {
      if (fb.reaction === "good") goodCount += 1;
      if (fb.reaction === "bad") badCount += 1;
      if (fb.comment && fb.comment.trim().length > 0) {
        comments.push({ messageId: mid, text: fb.comment });
      }
    }
    doc.fontSize(10).fillColor("#222");
    doc.text(`Good: ${goodCount}    Bad: ${badCount}    Comments: ${comments.length}`);
    doc.moveDown(0.5);
    for (const c of comments) {
      doc.fillColor("#888").text(`[${c.messageId.slice(0, 8)}…]`, { continued: false });
      doc.fillColor("#222").text(c.text, { indent: 12, paragraphGap: 4 });
    }
    doc.moveDown();
  }

  // ---- 3. TRANSCRIPT ----
  if (messages.length > 0) {
    sectionHeading(doc, "Conversation transcript");
    for (const m of messages) {
      const fb = m.messageId ? messageFeedback?.[m.messageId] : undefined;
      const tagColor = m.role === "user" ? "#0d4d8a" : "#444";

      // Header line: [ROLE] [REACTION?] timestamp
      doc.fontSize(9).fillColor(tagColor).text(`[${m.role.toUpperCase()}]`, { continued: true });
      if (fb?.reaction === "good") {
        doc.fillColor("#0a7a2f").text(" [GOOD]", { continued: true });
      } else if (fb?.reaction === "bad") {
        doc.fillColor("#a33").text(" [BAD]", { continued: true });
      }
      doc.fillColor(tagColor).text(m.timestamp ? ` ${m.timestamp}` : "");

      // Body
      doc
        .fontSize(10)
        .fillColor("#222")
        .text(m.content || "", { paragraphGap: 6 });

      // Inline comment block (green header) right under the message it belongs to.
      if (fb?.comment && fb.comment.trim().length > 0) {
        doc.fontSize(9).fillColor("#0a7a2f").text("[COMMENT]");
        doc.fontSize(10).fillColor("#222").text(fb.comment, { paragraphGap: 6 });
      }
    }
    doc.moveDown();
  }

  // ---- 4. FACTS ----
  const factEntries = Object.entries(facts);
  if (factEntries.length > 0) {
    sectionHeading(doc, "Facts");
    doc.fontSize(9).fillColor("#222");
    for (const [key, val] of factEntries) {
      doc.fillColor("#0d4d8a").text(key, { continued: true });
      doc.fillColor("#222").text(`  =  ${val.value}  `, { continued: true });
      doc.fillColor("#888").text(`(${val.confidence} via ${val.source})`);
    }
    doc.moveDown();
  }

  // ---- 5. TRANSACTIONS ----
  if (txns.length > 0) {
    sectionHeading(doc, "Transactions");
    doc.fontSize(10);
    for (const t of txns) {
      const color = t.status === "active" ? "#0a7a2f" : t.status === "blocked" ? "#a33" : "#666";
      doc.fillColor(color).text(`[${t.status.toUpperCase()}] ${t.name} (${t.txnTypeId})`);
      if (t.blockingInfo) {
        doc.fontSize(9).fillColor("#666").text(`   ${t.blockingInfo.customerMessage}`);
        if (t.blockingInfo.nextSteps) {
          doc.text(`   Next: ${t.blockingInfo.nextSteps}`);
        }
        doc.fontSize(10);
      }
    }
    doc.moveDown();
  }

  // ---- 6. DEBUG LOG APPENDIX ----
  if (debugLogs.length > 0) {
    sectionHeading(doc, `Debug log (${debugLogs.length} events)`);
    doc.fontSize(7).fillColor("#222").font("Courier");
    for (const log of debugLogs) {
      doc.fillColor("#888").text(`${log.timestamp}  ${log.eventType}`);
      const json = safeStringify(log.payload, 2);
      doc.fillColor("#222").text(json, { paragraphGap: 4 });
    }
    doc.font("Helvetica");
  }

  doc.end();
  return done;
}

function sectionHeading(doc: PDFKit.PDFDocument, label: string): void {
  doc.fontSize(13).fillColor("#0d4d8a").text(label);
  doc
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor("#dde")
    .lineWidth(0.5)
    .stroke();
  doc.moveDown(0.4);
}

function safeStringify(v: unknown, indent: number): string {
  try {
    return JSON.stringify(v, null, indent);
  } catch {
    return String(v);
  }
}
