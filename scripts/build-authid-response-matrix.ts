/**
 * Build the AuthID response-matrix reference doc (docx).
 *
 * Two tables, both keyed: issue/cause/situation | resident-facing consequence |
 * complications/notes.
 *   Table A — every layer of an AuthID response EXCEPT Layer 4 (modal-appearance,
 *             postMessage events, backend /authid-result statuses, transport).
 *   Table B — Layer 4 on its own: the reject reason-code expansion.
 *
 * Reflects the fail-closed hardening on branch authid-failclosed-hardening.
 *
 * Run:
 *   npx tsx scripts/build-authid-response-matrix.ts
 * Output: docs/authid-response-matrix.docx
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ShadingType,
  PageBreak,
} from "docx";

const OUT = resolve("docs/authid-response-matrix.docx");

// ---- text helpers (mirror scripts/build-test-brief.ts) --------------------

function H1(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text, bold: true, size: 34 })],
    spacing: { before: 360, after: 160 },
  });
}
function H2(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, bold: true, size: 26 })],
    spacing: { before: 280, after: 140 },
  });
}
function P(
  text: string,
  opts: { italic?: boolean; bold?: boolean; color?: string } = {},
): Paragraph {
  const { italic, ...rest } = opts;
  return new Paragraph({
    children: [new TextRun({ text, italics: italic, ...rest })],
    spacing: { after: 100 },
  });
}

// ---- table helpers --------------------------------------------------------

interface Cell {
  text: string;
  bold?: boolean;
  bg?: string;
  color?: string;
}

/** A cell that may hold multiple lines (each string = its own paragraph). */
function cell(
  lines: string | string[],
  opts: { bold?: boolean; bg?: string; color?: string; width?: number } = {},
): TableCell {
  const arr = Array.isArray(lines) ? lines : [lines];
  return new TableCell({
    width: opts.width
      ? { size: opts.width, type: WidthType.PERCENTAGE }
      : { size: 100, type: WidthType.AUTO },
    shading: opts.bg ? { type: ShadingType.SOLID, color: opts.bg, fill: opts.bg } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: arr.map(
      (t, i) =>
        new Paragraph({
          children: [new TextRun({ text: t, bold: opts.bold, color: opts.color, size: 18 })],
          spacing: { after: i === arr.length - 1 ? 0 : 60 },
        }),
    ),
  });
}

/** rows[0] is the header row. colWidths are percentages summing to ~100. */
function matrixTable(rows: Array<Array<Cell | string[]>>, colWidths: number[]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: colWidths.map((w) => Math.round((w / 100) * 9000)),
    rows: rows.map(
      (r, rowIdx) =>
        new TableRow({
          tableHeader: rowIdx === 0,
          children: r.map((c, colIdx) => {
            if (Array.isArray(c)) return cell(c, { width: colWidths[colIdx] });
            return cell(c.text, {
              bold: c.bold,
              bg: c.bg,
              color: c.color,
              width: colWidths[colIdx],
            });
          }),
        }),
    ),
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "999999" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: "cccccc" },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: "cccccc" },
    },
  });
}

const HDR = "d9e2f3"; // light blue header shading
const H: (t: string) => Cell = (t) => ({ text: t, bold: true, bg: HDR });

// ---- Table A: all layers EXCEPT Layer 4 -----------------------------------

const COLS3 = [30, 34, 36];

function headerRow(): Cell[] {
  return [
    H("Issue / cause / situation"),
    H("Resident-facing consequence"),
    H("Complications / notes"),
  ];
}

// Each data row: [situation lines, consequence lines, notes lines]
const TABLE_A: string[][][] = [
  // ---- Layer 1: before the modal appears (start_authid_proof on entry) ----
  [
    ["LAYER 1 — Opening verification", "Proof transaction created OK"],
    ['Resident sees the "Verify Identity" + "Skip For Now" buttons.'],
    ["Normal path. pendingAuthIdProof is stored, so a page refresh re-arms the widget."],
  ],
  [
    ["LAYER 1", "AuthID unreachable / token failure / 4xx-5xx when creating the transaction"],
    ['Sees only a "Continue" (skip) button plus "verification temporarily unavailable" copy.'],
    [
      "Fail-soft by design — never blocks the visit. The bot is instructed NOT to improvise another verification method. uiAction = authid-unavailable.",
    ],
  ],
  // ---- Layer 2: the modal's postMessage events ----
  [
    ["LAYER 2 — AuthID modal events", 'Modal posts "verifiedPage" (capture complete)'],
    ['Widget switches to "Verifying — one moment…" while we fetch the result.'],
    [
      'IMPORTANT: means "capture finished," NOT "passed." Triggers our decision logic. Duplicate posts are de-duped.',
    ],
  ],
  [
    ["LAYER 2", "Modal posts a decline / cancel / close page (resident backs out mid-flow)"],
    [
      'Widget tears down; the flow proceeds exactly as a "Skip" (advances unverified, visit flagged incomplete).',
    ],
    ["Matched by keyword (declin/cancel/close/abort/exit). Treated identically to clicking Skip."],
  ],
  [
    [
      "LAYER 2",
      "AuthID's own intermediate error / retry screens (e.g. liveness error, capture retry)",
    ],
    ["Resident stays inside the AuthID widget; AuthID shows its own retry guidance."],
    [
      "We ignore these and act only on terminal pages. Any screen we do not recognize simply leaves the widget mounted — no app action.",
    ],
  ],
  [
    [
      "LAYER 2",
      "Modal posts NOTHING (iframe blank/blocked, camera denied + idle, network dies mid-capture)",
    ],
    ["Resident is left on the AuthID overlay with page-scroll locked."],
    [
      'EDGE CASE: during capture there is no app-rendered close button — escape depends on AuthID posting a cancel page. Recovery today = refresh (widget re-mounts) or browser back. A future in-app "cancel" affordance would close this.',
    ],
  ],
  // ---- Layer 3: our backend /authid-result responses ----
  [
    [
      "LAYER 3 — Backend /authid-result",
      "status: pending (AuthID still processing after the short ~8s poll)",
    ],
    ['Stays on "Verifying — one moment…"; the app silently re-polls (~3.5s interval, ~60s cap).'],
    [
      "The non-blocking fix. Each request is short and never rides past the 29s API-Gateway timeout. No session write on pending.",
    ],
  ],
  [
    [
      "LAYER 3",
      "status: pass (all required signals present and explicitly PASS, license not expired)",
    ],
    [
      'Brief "Verifying…", then advances to the review step with the license fields pre-filled; the bot greets.',
    ],
    [
      "Identity written from AuthID's extracted license (may override self-reported DOB → facts/trees re-resolved). The follow-on greeting is best-effort; if it fails the resident still advances.",
    ],
  ],
  [
    ["LAYER 3", "status: review (mrz-ocr-mismatch, document-replay, or document-injection FAIL)"],
    ["Same as pass — advances with the license pre-filled."],
    [
      "POLICY NOTE: in the beta, review behaves the same as pass (there is no human reviewer). Reasons are stored for triage but gate nothing. document-injection sits here by decision; a single env flag flips it to a hard reject.",
    ],
  ],
  [
    ["LAYER 3", "status: rejected (a hard-reject reason fired — see Table B)"],
    [
      'Widget tears down; a plain-language message appears as a bot turn; the verify/skip gate re-renders. Recoverable reasons also show a "Try again" button.',
    ],
    [
      'Session is HELD in verify-identity; no identity written. Sensitive reasons show generic "visit in person" copy (no detail leak); fixable reasons show an actionable hint. Skip always remains available.',
    ],
  ],
  [
    ["LAYER 3", "status: authid-failed (AuthID marked the operation failed — status > 1)"],
    [
      'Generic "couldn\'t complete verification" message; the gate re-renders with Skip (and Try again).',
    ],
    [
      "Now PERSISTED (decision = failed, in-flight cleared) — previously this returned without saving anything. Held at the gate; Skip works. No specific reasons, so copy stays generic.",
    ],
  ],
  [
    ["LAYER 3", "pending re-poll cap exceeded (~60s of pending with no terminal result)"],
    [
      'Error box: "…taking longer than expected." plus a "Continue without verifying" (skip) button.',
    ],
    ["A clean skip escape, not a trap. The session is untouched and still in verify-identity."],
  ],
  // ---- Layer 5: transport / HTTP / state errors ----
  [
    [
      "LAYER 5 — Transport / HTTP / state",
      "HTTP 404 (session gone) / 400 (not in verify-identity) / 400 (no in-flight transaction)",
    ],
    ['Error box + "Continue without verifying".'],
    [
      "e.g. verifiedPage fired but the operation was already consumed by a prior attempt → 400 → skip escape. Expected, not a crash.",
    ],
  ],
  [
    ["LAYER 5", "HTTP 500 (unexpected: DynamoDB write failure, result-fetch network error)"],
    ["Same error box + skip escape."],
    [
      "Now RARE — the decision logic no longer throws on bad/partial payloads (it fails closed to a reject instead). Only genuine I/O failures remain.",
    ],
  ],
  [
    ["LAYER 5", "API-Gateway 504 (gateway timeout)"],
    ["Should no longer occur on the verification poll."],
    [
      "Residual: the pass path still runs a synchronous model call (autoGreet) in-request; a very slow greet could theoretically approach the 29s ceiling. Bounded and pre-existing — flag if it surfaces.",
    ],
  ],
  [
    ["LAYER 5", 'Resident retries after a recoverable rejection ("Try again")'],
    ["A fresh verification widget mounts and the resident re-scans."],
    [
      "AuthID one-time secrets are single-use, so retry mints a brand-new Proof transaction (reuses the same start-proof path). If AuthID is unavailable at retry, it drops back to the Skip-only gate.",
    ],
  ],
];

// ---- Table B: Layer 4 — the rejection reason-code expansion ---------------

const COLS_B = [30, 20, 50];

function headerRowB(): Cell[] {
  return [
    H("Reject reason code (issue / cause)"),
    H("Resident-facing message"),
    H("Complications / notes"),
  ];
}

// [reason+cause lines, message-tier lines, notes lines]
const TABLE_B: string[][][] = [
  [
    ["selfie-document-mismatch", "The selfie did not match the license photo (Matched = false)."],
    ['Fixable — lighting/centering hint; "Try again" offered.'],
    ["Legitimate first-fail is common (glare, angle). Retry mints a fresh transaction."],
  ],
  [
    ["liveness-failed", "The system could not confirm a live person (IsLive = false)."],
    ['Fixable — "look at the camera in good light"; retry offered.'],
    [
      "Presentation-attack / spoof signal, but also trips on poor capture — hence retryable, not terminal.",
    ],
  ],
  [
    ["document-expired", "The license expiry date is in the past."],
    ['Fixable — "renew before we can verify"; retry offered.'],
    [
      "Computed by our own date math, independent of AuthID — reliable even if AuthID does not surface expiry.",
    ],
  ],
  [
    [
      "selfie-injection-attack",
      "Selfie injection detector returned FAIL (a synthetic/injected camera feed).",
    ],
    ['Sensitive — generic "visit in person"; NO retry.'],
    [
      "Anti-fraud. We never tell the actor which detector caught them, so error copy cannot be used to probe the system.",
    ],
  ],
  [
    ["barcode-tampered", "License barcode security check returned FAIL."],
    ["Sensitive — generic; NO retry."],
    ["Anti-fraud (tampered/forged document). Generic copy, no detail leak."],
  ],
  [
    ["match-signal-missing", "The Matched field was absent or not a boolean."],
    ["Sensitive — generic; NO retry."],
    [
      "NEWLY FAIL-CLOSED. Before hardening, a missing Matched was treated as a pass — a silent hole. Now a reject.",
    ],
  ],
  [
    ["liveness-signal-missing", "The liveness result object / IsLive was absent or garbled."],
    ["Sensitive — generic; NO retry."],
    [
      "NEWLY FAIL-CLOSED. Before hardening this THREW (HTTP 500) and dumped the resident back at the gate. Now a clean reject, no crash.",
    ],
  ],
  [
    [
      "selfie-injection-signal-missing",
      "The selfie-injection signal was absent or not an explicit PASS.",
    ],
    ["Sensitive — generic; NO retry."],
    ['NEWLY FAIL-CLOSED (was a silent pass). "Absent" and "not explicitly PASS" both fail closed.'],
  ],
  [
    ["barcode-signal-missing", "The barcode-security signal was absent or not an explicit PASS."],
    ["Sensitive — generic; NO retry."],
    ["NEWLY FAIL-CLOSED (was a silent pass)."],
  ],
  [
    [
      "pad-signal-missing",
      "The document presentation-attack (padResult) signal was absent or garbled.",
    ],
    ["Sensitive — generic; NO retry."],
    [
      "NEWLY FAIL-CLOSED (was a silent pass). A present padResult=FAIL is REVIEW (Table A); an ABSENT one is reject.",
    ],
  ],
  [
    ["document-injection-signal-missing", "The document-injection signal was absent or garbled."],
    ["Sensitive — generic; NO retry."],
    ["NEWLY FAIL-CLOSED (was a silent pass)."],
  ],
  [
    ["expiry-missing", "No DateOfExpiry present in the result (neither location)."],
    ["Sensitive — generic; NO retry."],
    [
      "NEWLY FAIL-CLOSED. An attacker who scrubs the expiry can no longer defeat the expiry gate by omission.",
    ],
  ],
  [
    ["expiry-unparseable", "DateOfExpiry present but not a valid date."],
    ["Sensitive — generic; NO retry."],
    ["NEWLY FAIL-CLOSED (was a silent pass)."],
  ],
  [
    [
      "malformed-result-payload",
      "The AuthID result had no usable Payload.Data (garbage / partial response).",
    ],
    ["Sensitive — generic; NO retry."],
    [
      "NEWLY FAIL-CLOSED. Any unclassifiable payload is a reject, not a 500 — the decision function never throws.",
    ],
  ],
  [
    [
      "match-score-below-floor / match-score-missing",
      "Optional confidence floor: match score below the configured minimum, or absent when the floor is on.",
    ],
    ["Sensitive — generic; NO retry."],
    [
      "OFF by default (AUTHID_MIN_MATCH_SCORE unset). Mechanism only — a knob for St. Lucie to tune strictness beyond the boolean Matched.",
    ],
  ],
];

// ---- assemble -------------------------------------------------------------

async function build() {
  const children: (Paragraph | Table)[] = [];

  children.push(H1("AuthID — Every Possible Response & How the App Handles It"));
  children.push(
    P(
      "Reference for the fail-closed hardening (branch authid-failclosed-hardening). Columns: issue / cause / situation | resident-facing consequence | complications & notes.",
      { italic: true },
    ),
  );
  children.push(
    P(
      'Mental model: the AuthID modal posting "verifiedPage" means CAPTURE finished, not that the person PASSED. Our own decision logic then classifies the result. Every outcome below leaves the resident able to proceed — verification is skippable by design and no failure traps them.',
      {},
    ),
  );

  children.push(
    H2("Table A — All response layers except the rejection detail (Layers 1, 2, 3, 5)"),
  );
  children.push(matrixTable([headerRow(), ...TABLE_A], COLS3));

  children.push(new Paragraph({ children: [new PageBreak()] }));

  children.push(H2('Table B — Layer 4: the rejection case, expanded (why a "rejected" happened)'));
  children.push(
    P(
      'Every row here produces a Layer-3 "rejected": session held in verify-identity, no identity written, Skip always available. "NEWLY FAIL-CLOSED" marks cases that silently PASSED (or threw a 500) before this work.',
      { italic: true },
    ),
  );
  children.push(matrixTable([headerRowB(), ...TABLE_B], COLS_B));

  children.push(P("", {}));
  children.push(
    P(
      'Not shown as rejects: REVIEW-tier signals (mrz-ocr-mismatch, document-replay-detected, document-injection-attack) currently let the resident continue like a pass in the beta — see Table A, Layer 3 "review". PASS requires every required signal present AND explicitly PASS, with a future expiry.',
      { italic: true },
    ),
  );

  const doc = new Document({
    creator: "st-lucie AuthID hardening",
    title: "AuthID response matrix",
    description: "Every AuthID response and the app's intentional, fail-closed handling.",
    sections: [{ properties: {}, children }],
  });

  const buf = await Packer.toBuffer(doc);
  writeFileSync(OUT, buf);
  console.log(`Wrote ${OUT} (${buf.length} bytes)`);
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
