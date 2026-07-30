/**
 * API request/response types for Chatbot Service.
 */

import type { ConversationState, StructuredContext, AvailableSlot } from "./session.js";

export interface CreateSessionRequest {
  tenantId: string;
  channel: "web" | "walkin" | "sms";
  walkInLocationId?: string;
}

export interface CreateSessionResponse {
  sessionId: string;
  state: ConversationState;
  hotButtons: Array<{ label: string; prompt: string }>;
}

export interface ProcessMessageRequest {
  message: string;
  attachments?: string[];
}

export interface UIAction {
  type:
    | "request_upload"
    | "show_ocr_results"
    | "show_scheduling"
    | "show_qr_code"
    | "redirect_checkout"
    | "none";
  documentType?: string;
  purpose?: string;
  fields?: Record<string, string>;
  slots?: AvailableSlot[];
  qrCodeUrl?: string;
  appointmentSummary?: AppointmentSummary;
  url?: string;
}

export interface KBSource {
  title: string;
  url?: string;
  type: "page" | "pdf";
}

export interface ProcessMessageResponse {
  sessionId: string;
  message: string;
  state: ConversationState;
  structuredContext: StructuredContext;
  uiAction?: UIAction;
  kbSources?: KBSource[];
  /**
   * Server-assigned id for the assistant turn this response represents. The
   * client uses it as the feedback key so per-message reactions persist under
   * the same id stored on the HISTORY row — letting the admin render feedback
   * inline. One id per visible reply (the autoGreet continuation shares it).
   */
  messageId?: string;
}

export interface SessionStateResponse {
  sessionId: string;
  state: ConversationState;
  structuredContext: StructuredContext;
  incompletePreWork: boolean;
}

export interface PresignedUrlRequest {
  documentType: string;
  filename: string;
}

export interface PresignedUrlResponse {
  uploadUrl: string;
  s3Key: string;
  expiresIn: number;
}

export interface SkipStateRequest {
  stateName: string;
}

export interface StateTransitionResponse {
  previousState: ConversationState;
  newState: ConversationState;
  warning?: string;
}

export interface ConfirmIdentityRequest {
  corrections?: Record<string, string>;
}

export interface AppointmentSummary {
  appointmentId: string;
  locationName: string;
  date: string;
  startTime: string;
  transactions: Array<{ name: string; status: string; durationMinutes: number }>;
  totalDurationMinutes: number;
}

export interface OcrResult {
  name?: string;
  dob?: string;
  dlNumber?: string;
  address?: string;
  confidence: number;
  rawExtraction: Record<string, string>;
}

export interface DocumentStatus {
  documentType: string;
  status: "pending" | "uploaded" | "validated" | "failed" | "skipped";
  validationMessage?: string;
  ocrResult?: OcrResult;
}
