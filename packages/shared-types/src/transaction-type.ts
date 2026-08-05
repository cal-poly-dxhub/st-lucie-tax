/**
 * Transaction type and pre-screening types.
 */

export interface TransactionTypeMetadata {
  summary: string;
  keywords: string[];
  commonPhrases: string[];
  requiredDocumentSummary: string;
  requiredDocuments: string[];
  onlineEligible: boolean;
  onlineUrl?: string;
  relatedTransactionIds: string[];
  relatedPrompts: Record<string, string>;
  notes: string;
}

export interface TransactionType {
  txnTypeId: string;
  name: string;
  description: TransactionTypeMetadata;
  averageDurationMinutes: number;
  serviceHours?: { start: string; end: string };
  status: "active" | "internal" | "hidden";
  locationAvailability?: string[];
}

export interface PreScreeningQuestion {
  questionKey: string;
  questionText: string;
  answerType: "yes_no" | "text" | "number";
  blockingRule?: string;
  blockingMessage?: string;
  txnTypeId: string;
  sequence: number;
}

export interface HotButton {
  label: string;
  prompt: string;
  /**
   * Optional grouping for the landing-screen quick-reply UI. When present on
   * any button, the UI renders categorized rows; when omitted, all buttons
   * render as a flat list (back-compat for older seeds).
   */
  category?: string;
}

export interface IdentifiedTransaction {
  txnTypeId: string;
  name: string;
  durationMinutes: number;
  documentSummary: string;
}
