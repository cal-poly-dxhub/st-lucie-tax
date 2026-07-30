/**
 * AI document pass/reject screen.
 *
 * Runs synchronously right after a resident uploads a file to S3 (see the
 * POST /chatbot/sessions/:id/validate-document route). The goal is to keep
 * TRULY extraneous images (selfies, blank pages, screenshots, random photos)
 * off the tax office's backend — not to police document quality.
 *
 * Policy is conservative + FAIL-OPEN, mirroring the accept/review/reject shape
 * of services/chatbot/src/authid/decision.ts: only a high-confidence "reject"
 * from the vision model blocks the upload. Every other outcome — accept, a
 * low-confidence reject, an unreadable format, a transcode failure, an S3 read
 * failure, a Bedrock error, or a timeout — resolves to ACCEPT. A wrongly-
 * rejected real resident is far worse than one junk file reaching a clerk.
 *
 * Formats: JPEG/PNG/GIF/WEBP screen as Bedrock ImageBlocks, PDFs as
 * DocumentBlocks (read natively), and HEIC/HEIF are transcoded to JPEG first.
 * Only genuinely unreadable bytes pass through un-screened.
 *
 * The model also TRANSCRIBES any printed dates into the verdict (observedDates
 * + datesLegible) — observation only in Phase 1; no expiry decision consumes
 * them yet (that pure decision engine is Phase 2).
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type ContentBlock,
  type Tool,
} from "@aws-sdk/client-bedrock-runtime";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import type { DocumentDateAnchor, ObservedDates } from "@st-lucie/shared-types";
import { getCatalogItem } from "../data-loaders/item-catalog.js";
import { transcodeHeicToJpeg } from "./transcode-heic.js";
import { checkValidity, buildExpiryReason, buildContentAdvisory } from "./check-validity.js";

// Re-export so existing importers of these types from this module keep working.
export type { ObservedDates } from "@st-lucie/shared-types";

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });
// Accept either name: our fork used DOC_BUCKET_NAME; the integration CDK stack
// (infra/lib/chatbot-stack.ts) sets DOC_BUCKET. Read both, else the validator
// hits `no-bucket-config` and fails open on every upload (no vision/validity
// check) — silently disabling the smart-rejection screen.
const BUCKET_NAME = process.env.DOC_BUCKET_NAME || process.env.DOC_BUCKET || "";

// Bedrock Haiku 4.5 cross-region inference profile. The EXACT id is
// tenant-specific (verify with `aws bedrock list-inference-profiles` before
// deploy, like AUTHID_DL_DOC_TYPE_CODE was) — the env var is the source of
// truth; this literal is only a sane default.
const VISION_MODEL_ID =
  process.env.BEDROCK_VISION_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0";

// The vision model runs in its OWN region, separate from the main chatbot
// (Sonnet) region. Haiku 4.5 model access is enabled in us-east-2 / us-west-2
// but NOT us-east-1 in this account, so screening calls target us-east-2 by
// default. Everything else (Sonnet, KB, DynamoDB, S3) stays in AWS_REGION.
const VISION_REGION = process.env.BEDROCK_VISION_REGION || "us-east-2";
const bedrock = new BedrockRuntimeClient({ region: VISION_REGION });

// Bedrock returns transient ThrottlingException/ServiceUnavailableException
// during bursts. Retry a few times with backoff, respecting the abort signal.
const RETRYABLE = new Set([
  "ThrottlingException",
  "ServiceUnavailableException",
  "ModelTimeoutException",
  "InternalServerException",
  "TooManyRequestsException",
]);

async function converseWithRetry(
  cmd: ConverseCommand,
  signal: AbortSignal,
): Promise<ConverseCommandOutput> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await bedrock.send(cmd, { abortSignal: signal });
    } catch (err) {
      lastErr = err;
      const name = (err as { name?: string } | undefined)?.name ?? "";
      if (!RETRYABLE.has(name) || signal.aborted) throw err;
      await new Promise<void>((r) => setTimeout(r, 400 * Math.pow(2, attempt)));
    }
  }
  throw lastErr;
}

// Only a model reject at or above this confidence blocks the upload. Tunable
// in prod via env to make rejection rarer without a redeploy.
const REJECT_CONFIDENCE_THRESHOLD = Number(process.env.DOC_VALIDATION_REJECT_THRESHOLD ?? "0.85");

// Runtime kill-switch for date-based (expiry/recency) rejection. Defaults ON;
// set DOC_VALIDATION_EXPIRY_ENABLED=false to disable expiry rejects without a
// redeploy if a validity rule misfires in prod. Only gates the date decision —
// plausibility screening and date OBSERVATION are unaffected.
const EXPIRY_ENABLED = process.env.DOC_VALIDATION_EXPIRY_ENABLED !== "false";

// Size gate bounds (bytes). Below the floor a file is almost certainly a
// truncated/empty upload (fail-open — the resident re-picks naturally). Above
// the ceiling we can't fit the image in a Bedrock request, so we skip the AI
// and fail open. Both are deliberately generous.
const MIN_BYTES = 1024; // 1 KB
const MAX_BYTES = 3.75 * 1024 * 1024; // ~3.75 MB raw (Bedrock image payload ceiling)

// Hard wall on the model call so a slow Bedrock response can't make the
// resident stare. On timeout we abort and fail open.
const BEDROCK_TIMEOUT_MS = 9000;

// HEIC transcode budget. libheif is wasm/CPU work with no abort signal, so we
// race it against this timer and fail open if it would blow the request budget.
// Kept well inside BEDROCK_TIMEOUT_MS + the 29s API-Gateway wall.
const HEIC_TRANSCODE_TIMEOUT_MS = 4000;

export type DetectedFormat = "jpeg" | "png" | "gif" | "webp" | "pdf" | "heic" | "unknown";

/** Formats the Bedrock Converse ImageBlock accepts (the model-screened set). */
export type ImageFormat = "jpeg" | "png" | "gif" | "webp";

// ObservedDates (the dates the vision model transcribes off a document) is
// shared with the validity engine — see @st-lucie/shared-types.

/** The anchor keys the model may report, in a fixed order for stable parsing. */
const OBSERVED_DATE_KEYS: DocumentDateAnchor[] = ["issued", "dated", "signed", "expires"];

export interface ValidationVerdict {
  verdict: "accept" | "reject";
  observedDocument?: string;
  confidence?: number;
  reason?: string;
  /** True for any accept that wasn't a genuine AI accept (error/timeout/
   *  unreadable/unsupported/low-confidence). Lets the caller + UI distinguish
   *  "the AI looked and approved" from "we couldn't screen, so we let it through". */
  failOpen?: boolean;
  /** Dates the model read off the document. Absent when nothing legible was
   *  reported. Consumed by the Phase 2 validity (expiry) decision. */
  observedDates?: ObservedDates;
  /** Model's self-report that the document's dates were legible. Absent when the
   *  model didn't report it. */
  datesLegible?: boolean;
  /** Machine slug when a reject was driven by the validity rule rather than
   *  plausibility: 'document-too-old' | 'document-expired'. For admin/debug;
   *  the customer-facing sentence is in `reason`. */
  expiryReason?: string;
  /** Non-blocking, customer-facing NOTICE from a content/status check (e.g. the
   *  Sunbiz printout looks Inactive). Rides on an ACCEPT verdict — the upload is
   *  NOT blocked; the resident is nudged to self-correct. Absent when no concern. */
  advisory?: string;
}

/**
 * Pull the observed dates out of the model's raw tool input, DEFENSIVELY: keep
 * only known anchor keys whose value is a string, drop everything else. Returns
 * undefined when no usable date is present, so callers can omit the field. Never
 * throws on a garbage payload.
 */
export function parseObservedDates(raw: unknown): ObservedDates | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const src = raw as Record<string, unknown>;
  const out: ObservedDates = {};
  for (const key of OBSERVED_DATE_KEYS) {
    const v = src[key];
    if (typeof v === "string") out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Pull the legibility flag out of the model's raw tool input; undefined unless a real boolean. */
export function parseDatesLegible(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

/**
 * Pull the model's content-check concerns (attributes it judged clearly
 * missing/wrong) out of the raw tool input. Keeps only non-blank strings;
 * returns undefined when there's nothing usable. Never throws.
 */
export function parseContentConcerns(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.filter((c): c is string => typeof c === "string" && c.trim() !== "");
  return out.length > 0 ? out : undefined;
}

interface ValidateArgs {
  tenantId: string;
  sessionId: string;
  documentType: string; // catalog itemId
  s3Key: string;
  filename: string;
}

/**
 * Sniff the real format from the first bytes. Never trust the filename or the
 * stored Content-Type — both are caller-controlled and getContentType() in
 * generate-url.ts derives ContentType from the filename extension.
 */
export function detectFormat(buf: Buffer): DetectedFormat {
  if (buf.length < 12) return "unknown";
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // GIF: 47 49 46 38 ("GIF8")
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return "gif";
  // WEBP: RIFF .... WEBP (52 49 46 46 at 0, 57 45 42 50 at 8)
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return "webp";
  }
  // PDF: 25 50 44 46 ("%PDF")
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
  // HEIC/HEIF: ftyp box — "ftyp" (66 74 79 70) at offset 4
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return "heic";
  return "unknown";
}

/**
 * How a detected format reaches the vision model:
 *  - 'image'       → raster formats sent as a Bedrock ImageBlock.
 *  - 'document'    → PDF sent as a Bedrock DocumentBlock (read natively).
 *  - 'transcode'   → HEIC transcoded to JPEG first, then sent as an ImageBlock.
 *  - 'passthrough' → fail-open accept with NO model call (genuinely unreadable).
 */
export type ScreenRoute = "image" | "document" | "transcode" | "passthrough";

/** Which screening path a detected format takes. */
export function routeFormat(fmt: DetectedFormat): ScreenRoute {
  if (fmt === "jpeg" || fmt === "png" || fmt === "gif" || fmt === "webp") return "image";
  if (fmt === "pdf") return "document";
  if (fmt === "heic") return "transcode";
  return "passthrough";
}

/**
 * Conservative decision mapping — the testable core. Mirrors authid
 * decision.ts decide(): only a confident reject is an action; everything else
 * (accept, low/missing-confidence reject) is an accept.
 */
export function mapVerdictToAction(v: {
  verdict: "accept" | "reject";
  confidence?: number;
}): "hard-reject" | "accept" {
  if (
    v.verdict === "reject" &&
    typeof v.confidence === "number" &&
    v.confidence >= REJECT_CONFIDENCE_THRESHOLD
  ) {
    return "hard-reject";
  }
  return "accept";
}

/** Human-readable expectation fed to the model, derived from the catalog itemId. */
export function buildExpectedDocText(documentType: string): string {
  const item = getCatalogItem(documentType);
  const label = item?.label ?? documentType;
  const notes = item?.notes ? ` Context: ${item.notes}` : "";
  return (
    `The resident was asked to upload: "${label}".${notes} ` +
    `Could this image plausibly BE that document?`
  );
}

const SYSTEM_POLICY_PROMPT =
  "You are a document-intake screener for a county tax-collector office. A " +
  "resident uploaded an image they believe is a specific required document. " +
  "Your ONLY job is to catch images that are CLEARLY not a document at all, or " +
  "are CLEARLY a completely different, unrelated document — so obvious junk " +
  "doesn't reach a clerk.\n\n" +
  "DEFAULT TO ACCEPT. Accept unless you are HIGHLY confident the image is one " +
  "of: a selfie or photo of a person with no document; a blank, black, or " +
  "meaningless image; a screenshot of an app, error message, or web page; an " +
  "unrelated photo (pet, food, landscape, meme); or a completely different " +
  "KIND of official document than the one expected.\n\n" +
  "NEVER reject for: blur, glare, low light, cropping, rotation, partial " +
  "framing, handwriting, a phone photo of a paper, an unusual layout, or " +
  "because you are unsure. When unsure, ACCEPT. A wrongly-rejected real " +
  "resident is far worse than one piece of junk reaching a clerk.\n\n" +
  "Call record_document_verdict exactly once. Set confidence to how sure you " +
  "are of the verdict; use a value at or above 0.85 ONLY when the document is " +
  "unmistakably wrong.";

/**
 * A SECOND system block (kept separate from the plausibility policy above so
 * that policy is never disturbed). Asks the model to TRANSCRIBE any printed
 * dates into observedDates + set datesLegible — observation only. Today's date
 * is provided purely to disambiguate 2-digit years and month/day order; the
 * model must NOT decide expiry (a pure function does that in Phase 2).
 */
export function buildObservationInstructions(asOf: Date): string {
  const today = asOf.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return (
    `Today's date is ${today}. ` +
    "In addition to the plausibility verdict, transcribe any clearly-printed " +
    "dates on the document into observedDates (as YYYY-MM-DD), and set " +
    "datesLegible to whether those dates were clearly readable. This is " +
    "observation only: report exactly what is printed, do NOT infer or guess a " +
    "date, and do NOT judge whether the document is expired or too old. Use " +
    "today's date only to disambiguate ambiguous year or month/day order."
  );
}

/**
 * If the catalog item declares content/status checks, ask the model to look for
 * each required attribute and report any it judges CLEARLY missing or wrong into
 * contentConcerns. Returns undefined (no block added) when the item has none.
 * This is ADVISORY: the model's concerns only produce a soft warning, never a
 * reject — so the prompt tells it to flag only clear, high-confidence problems.
 */
export function buildContentCheckInstructions(documentType: string): string | undefined {
  const checks = getCatalogItem(documentType)?.validity?.contentChecks;
  if (!checks || checks.length === 0) return undefined;
  const list = checks.map((c, i) => `  ${i + 1}. ${c.requiredAttribute}`).join("\n");
  return (
    "This document is expected to SHOW the following. For each, only if you are " +
    "confident it is CLEARLY missing or wrong on the document, add a short, " +
    'specific note to contentConcerns (e.g. "Sunbiz status shows INACTIVE, not ' +
    'Active"). If an attribute is present, unclear, or you are unsure, say ' +
    "NOTHING about it — leave contentConcerns empty. These notes are advisory " +
    "only and never block the upload, so do not guess.\n" +
    list
  );
}

const verdictTool: Tool = {
  toolSpec: {
    name: "record_document_verdict",
    description: "Record whether the uploaded document is plausibly the expected document.",
    inputSchema: {
      json: {
        type: "object",
        properties: {
          verdict: {
            type: "string",
            enum: ["accept", "reject"],
            description: "accept unless highly confident the document is wrong.",
          },
          observedDocument: {
            type: "string",
            description: "What you actually see, in a few words.",
          },
          confidence: {
            type: "number",
            description: "Confidence in the verdict, 0 to 1.",
          },
          reason: {
            type: "string",
            description: "If reject, one short, friendly, customer-facing sentence explaining why.",
          },
          observedDates: {
            type: "object",
            description:
              "Any clearly-printed dates you can read, transcribed as YYYY-MM-DD. " +
              "Omit a field if that date is not visible. Do NOT guess, infer, or judge " +
              "whether the document is expired — only report what is printed.",
            properties: {
              issued: { type: "string", description: "Date the document was issued or printed." },
              dated: {
                type: "string",
                description: "The document's own effective date, if distinct from issued.",
              },
              signed: { type: "string", description: "Signature or certification date." },
              expires: { type: "string", description: "Printed expiration or valid-through date." },
            },
          },
          datesLegible: {
            type: "boolean",
            description:
              "true if the dates on the document are clearly readable; false if they are " +
              "cropped, blurred, obscured, or absent.",
          },
          contentConcerns: {
            type: "array",
            items: { type: "string" },
            description:
              "ONLY when the instructions list required attributes: short, specific notes " +
              "about any required attribute you are confident is CLEARLY missing or wrong " +
              '(e.g. "status shows INACTIVE, not Active"). Leave empty if all present, ' +
              "unclear, or you are unsure — these are advisory and never block.",
          },
        },
        required: ["verdict", "observedDocument", "confidence"],
      },
    },
  },
};

const ACCEPT = (reason: string): ValidationVerdict => ({
  verdict: "accept",
  failOpen: true,
  reason,
});

/**
 * Screen one uploaded document. Always resolves (never throws) — every failure
 * path returns a fail-open accept.
 */
export async function validateDocument(args: ValidateArgs): Promise<ValidationVerdict> {
  const { documentType, s3Key } = args;

  if (!BUCKET_NAME) return ACCEPT("no-bucket-config");

  // 1. Read the uploaded object back from S3.
  let buf: Buffer;
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: s3Key }));
    if (!obj.Body) return ACCEPT("s3-empty-body");
    const bytes = await obj.Body.transformToByteArray();
    buf = Buffer.from(bytes);
  } catch {
    return ACCEPT("s3-read-failed");
  }

  // 2. Size gate.
  if (buf.length < MIN_BYTES) return ACCEPT("too-small");
  if (buf.length > MAX_BYTES) return ACCEPT("too-large");

  // 3. Format detection + routing → build the Bedrock media content block.
  //    image     → ImageBlock (raster formats).
  //    document  → DocumentBlock (PDF, read natively — text + layout).
  //    transcode → HEIC decoded to JPEG first, then an ImageBlock.
  //    passthrough → genuinely unreadable bytes; fail-open accept, no model call.
  const fmt = detectFormat(buf);
  const route = routeFormat(fmt);
  let mediaBlock: ContentBlock;
  if (route === "image") {
    mediaBlock = { image: { format: fmt as ImageFormat, source: { bytes: buf } } };
  } else if (route === "document") {
    // Fixed, safe DocumentBlock name (Bedrock restricts the charset; never use
    // the caller-controlled filename).
    mediaBlock = { document: { format: "pdf", name: "uploaded-document", source: { bytes: buf } } };
  } else if (route === "transcode") {
    const jpeg = await transcodeHeicToJpeg(buf, HEIC_TRANSCODE_TIMEOUT_MS);
    if (!jpeg) return ACCEPT("heic-transcode-failed");
    if (jpeg.length > MAX_BYTES) return ACCEPT("heic-transcoded-too-large");
    mediaBlock = { image: { format: "jpeg", source: { bytes: jpeg } } };
  } else {
    return ACCEPT("unreadable-format");
  }

  // 4. Vision call, bounded by an abort timeout.
  const systemBlocks = [
    { text: SYSTEM_POLICY_PROMPT },
    { text: buildObservationInstructions(new Date()) },
  ];
  const contentInstructions = buildContentCheckInstructions(documentType);
  if (contentInstructions) systemBlocks.push({ text: contentInstructions });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BEDROCK_TIMEOUT_MS);
  try {
    const response = await converseWithRetry(
      new ConverseCommand({
        modelId: VISION_MODEL_ID,
        system: systemBlocks,
        messages: [
          {
            role: "user",
            content: [{ text: buildExpectedDocText(documentType) }, mediaBlock],
          },
        ],
        toolConfig: {
          tools: [verdictTool],
          toolChoice: { tool: { name: "record_document_verdict" } },
        },
        inferenceConfig: { maxTokens: 512, temperature: 0 },
      }),
      controller.signal,
    );

    const content = response.output?.message?.content ?? [];
    const toolUse = content.find(
      (b) => "toolUse" in b && b.toolUse?.name === "record_document_verdict",
    );
    const input = (toolUse && "toolUse" in toolUse ? toolUse.toolUse?.input : undefined) as
      | {
          verdict?: unknown;
          observedDocument?: unknown;
          confidence?: unknown;
          reason?: unknown;
          observedDates?: unknown;
          datesLegible?: unknown;
          contentConcerns?: unknown;
        }
      | undefined;

    if (!input || (input.verdict !== "accept" && input.verdict !== "reject")) {
      return ACCEPT("no-verdict");
    }

    const verdict = input.verdict;
    const confidence = typeof input.confidence === "number" ? input.confidence : undefined;
    const observedDocument =
      typeof input.observedDocument === "string" ? input.observedDocument : undefined;
    const reason = typeof input.reason === "string" ? input.reason : undefined;
    // Phase 1 observation: reported + persisted, but no decision consumes them yet.
    const observedDates = parseObservedDates(input.observedDates);
    const datesLegible = parseDatesLegible(input.datesLegible);

    if (mapVerdictToAction({ verdict, confidence }) === "hard-reject") {
      return {
        verdict: "reject",
        observedDocument,
        confidence,
        reason:
          reason ||
          "That doesn't look like the document we asked for. You can re-upload, or bring it to the office.",
        ...(observedDates ? { observedDates } : {}),
        ...(datesLegible !== undefined ? { datesLegible } : {}),
      };
    }

    // Plausibility passed (genuine accept, or a below-threshold reject we'd
    // otherwise let through). Now the independent, deterministic validity check:
    // is the document expired / too old per its catalog rule? Fail-open on every
    // uncertain case (see check-validity.ts). Gated by the runtime kill-switch.
    const validity = getCatalogItem(documentType)?.validity;
    const expiry = EXPIRY_ENABLED
      ? checkValidity(validity, observedDates, datesLegible, new Date(), observedDocument)
      : { status: "ok" as const };
    if (expiry.status === "expired") {
      return {
        verdict: "reject",
        observedDocument,
        confidence,
        reason: buildExpiryReason(validity!),
        expiryReason: expiry.reason,
        ...(observedDates ? { observedDates } : {}),
        ...(datesLegible !== undefined ? { datesLegible } : {}),
      };
    }

    // Content/status advisory (never blocks): if the item declares contentChecks
    // and the model flagged a clear concern, attach a non-blocking notice to the
    // accept so the resident can self-correct. Absent when there's nothing to say.
    const advisory = buildContentAdvisory(
      validity?.contentChecks,
      parseContentConcerns(input.contentConcerns),
    );

    // accept, or a below-threshold reject that we let through (fail-open).
    return {
      verdict: "accept",
      observedDocument,
      confidence,
      ...(verdict === "reject" ? { failOpen: true, reason: "below-threshold" } : {}),
      ...(observedDates ? { observedDates } : {}),
      ...(datesLegible !== undefined ? { datesLegible } : {}),
      ...(advisory ? { advisory } : {}),
    };
  } catch (err) {
    // AbortError (timeout) or any non-retryable Bedrock error → fail open.
    // Log name+message (not the image) so a fail-open is diagnosable in
    // CloudWatch instead of a silent accept.
    const name = (err as { name?: string } | undefined)?.name ?? "Error";
    const message = (err as { message?: string } | undefined)?.message ?? String(err);
    console.error(`[validate-document] Bedrock call failed (${name}): ${message} — failing open`);
    return ACCEPT("bedrock-error");
  } finally {
    clearTimeout(timer);
  }
}
