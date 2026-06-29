/**
 * Tools for the upload-docs state.
 * Customer can skip this state (sets incompletePreWork flag).
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";
import { generateUploadUrl } from "../../upload/generate-url.js";
import { isUploadable } from "./classify.js";

export const uploadDocsTools: Tool[] = [
  {
    toolSpec: {
      name: "list_required_documents",
      description:
        "List all required documents for the customer's selected transactions. Shows which have been uploaded and which are still pending.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "request_document_upload",
      description: "Request the customer to upload a specific document. Generates a presigned URL.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            documentType: { type: "string", description: "The document type to upload" },
          },
          required: ["documentType"],
        },
      },
    },
  },
  {
    toolSpec: {
      name: "skip_document_upload",
      description:
        "Skip document upload entirely. Warns the customer about increased in-office time and flags the appointment as incomplete pre-work.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "complete_document_upload",
      description:
        "Mark document upload as complete and advance to pre-screening. Call when all documents are uploaded or the customer is done uploading.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
];

export interface UploadDocsToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  uiAction?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function handleUploadDocsTool(
  toolName: string,
  input: Record<string, unknown>,
  session: Session,
): Promise<UploadDocsToolResult> {
  switch (toolName) {
    case "list_required_documents":
      return handleListDocs(session);
    case "request_document_upload":
      return handleRequestUpload(input.documentType as string, session);
    case "skip_document_upload":
      return handleSkipUpload(session);
    case "complete_document_upload":
      return handleCompleteUpload(session);
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

function handleListDocs(session: Session): UploadDocsToolResult {
  // Filter out DL — already captured in verify-identity state
  const docs = session.structuredContext.documents.filter((d) => {
    const lower = d.documentType.toLowerCase();
    return !lower.includes("driver license") && !lower.includes("driver's license");
  });

  // Conditional document patterns — these should only be shown if the
  // bot confirms they apply via a qualifying question
  const CONDITIONAL_PATTERNS: Array<{ pattern: string; question: string }> = [
    {
      pattern: "military orders",
      question: "Are you active-duty military or recently discharged?",
    },
    { pattern: "lienholder", question: "Is the vehicle financed or leased?" },
    { pattern: "lien satisfaction", question: "Has the lien been paid off?" },
    { pattern: "lien information", question: "Is this financed or leased?" },
    { pattern: "if vehicle is from out of state", question: "Is the vehicle from out of state?" },
    {
      pattern: "out-of-state registration",
      question: "Is the vehicle currently registered in another state?",
    },
    { pattern: "out-of-state title", question: "Is this from out of state?" },
    {
      pattern: "if owned less than 6 months",
      question: "Have you owned the vehicle for less than 6 months?",
    },
    { pattern: "sales tax paid", question: "Have you owned this for less than 6 months?" },
    { pattern: "sales tax payment", question: "Have you owned this for less than 6 months?" },
    {
      pattern: "if not already real id",
      question:
        "Does your current license have a star in the upper right corner (REAL ID compliant)?",
    },
    {
      pattern: "if name has changed",
      question: "Has your name changed since your primary ID was issued?",
    },
    {
      pattern: "name change documents if",
      question: "Has your name changed since your primary ID was issued?",
    },
    { pattern: "if minor", question: "Is the applicant under 18?" },
    { pattern: "if under 18", question: "Is the applicant under 18?" },
    { pattern: "parental consent", question: "Is the applicant under 18?" },
    {
      pattern: "if someone other",
      question: "Is someone other than the registered owner handling this?",
    },
    {
      pattern: "if transferring a plate",
      question: "Are you transferring a plate from another vehicle?",
    },
    {
      pattern: "when purchasing a license plate",
      question: "Are you purchasing a new license plate?",
    },
    {
      pattern: "when transferring",
      question: "Are you transferring a plate from another vehicle?",
    },
    { pattern: "for personalized", question: "Is this for a personalized plate with custom text?" },
    { pattern: "for renewals or decal", question: "Is this a renewal or decal transfer?" },
    {
      pattern: "if claiming",
      question: "Are you a Florida resident claiming the residency discount?",
    },
    {
      pattern: "endorsement test",
      question: "Are you adding a special endorsement (hazmat, passenger, etc.)?",
    },
    { pattern: "if applicable", question: "" }, // too vague — skip unless caught above
  ];

  const bringInPerson: string[] = [];
  const canUpload: string[] = [];
  const conditional: Array<{ document: string; question: string }> = [];

  for (const d of docs) {
    const lower = d.documentType.toLowerCase();

    // Check if this is a conditional document
    const cond = CONDITIONAL_PATTERNS.find((c) => lower.includes(c.pattern));
    if (cond) {
      if (cond.question) {
        conditional.push({ document: d.documentType, question: cond.question });
      }
      // Don't add to bring/upload lists — bot will ask qualifying question first
      continue;
    }

    if (isUploadable(d.documentType)) {
      canUpload.push(d.documentType);
    } else {
      bringInPerson.push(d.documentType);
    }
  }

  // Deduplicate conditional questions (same question for multiple docs)
  const seenQuestions = new Set<string>();
  const uniqueConditionals: Array<{ documents: string[]; question: string }> = [];
  for (const c of conditional) {
    if (!seenQuestions.has(c.question)) {
      seenQuestions.add(c.question);
      uniqueConditionals.push({
        documents: conditional.filter((x) => x.question === c.question).map((x) => x.document),
        question: c.question,
      });
    }
  }

  return {
    content: [
      {
        text: JSON.stringify({
          documentsToRemember: bringInPerson,
          documentsCanUpload: canUpload,
          conditionalDocuments: uniqueConditionals.length > 0 ? uniqueConditionals : undefined,
          note:
            uniqueConditionals.length > 0
              ? "Some documents depend on your situation. Ask the qualifying questions below before including them in the lists."
              : undefined,
        }),
      },
    ],
  };
}

async function handleRequestUpload(
  documentType: string,
  session: Session,
): Promise<UploadDocsToolResult> {
  try {
    const safeName = documentType.replace(/[^a-zA-Z0-9-_]/g, "-").substring(0, 50);
    const result = await generateUploadUrl(
      session.tenantId,
      session.sessionId,
      safeName,
      `${safeName}.jpg`,
    );

    return {
      content: [
        {
          text: JSON.stringify({
            status: "upload_ready",
            documentType,
            s3Key: result.s3Key,
          }),
        },
      ],
      uiAction: {
        type: "request_upload",
        documentType,
        uploadUrl: result.uploadUrl,
        s3Key: result.s3Key,
      },
    };
  } catch {
    return {
      content: [
        { text: "Unable to generate upload URL. You can bring this document to the office." },
      ],
    };
  }
}

function handleSkipUpload(session: Session): UploadDocsToolResult {
  session.incompletePreWork = true;
  for (const doc of session.structuredContext.documents) {
    if (doc.status === "pending") {
      doc.status = "skipped";
    }
  }

  return {
    content: [
      {
        text: JSON.stringify({
          status: "skipped",
          warning:
            "Document upload skipped. The clerk will collect documents at the office, which may increase your visit time.",
        }),
      },
    ],
    shouldAdvance: true,
  };
}

function handleCompleteUpload(_session: Session): UploadDocsToolResult {
  return {
    content: [
      {
        text: JSON.stringify({
          status: "complete",
          message: "Document upload complete. Moving to pre-screening questions.",
        }),
      },
    ],
    shouldAdvance: true,
  };
}
