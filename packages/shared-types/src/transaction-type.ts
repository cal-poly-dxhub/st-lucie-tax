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
  status: "active" | "inactive" | "hidden";
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
  transactionTypeId: string;
  /**
   * Optional grouping for the landing-screen quick-reply UI. When present on
   * any button, the UI renders categorized rows; when omitted, all buttons
   * render as a flat list (back-compat for older seeds).
   */
  category?: string;
  /**
   * Optional short helper text shown under the button label on hover/focus.
   * Useful when a category has several visually-similar buttons (e.g.
   * "Renew license" vs "Replace license").
   */
  description?: string;
}

export interface IdentifiedTransaction {
  txnTypeId: string;
  name: string;
  durationMinutes: number;
  documentSummary: string;
}
