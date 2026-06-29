/**
 * DynamoDB entity shapes matching single-table key structure.
 *
 * Key structure:
 *   PK: TENANT#stlucie#ENTITY_TYPE#entity_id
 *   SK: METADATA | RELATED_ENTITY#entity_id | timestamp
 *
 * GSI1 (Appointments by Location+Date):
 *   GSI1PK: TENANT#stlucie#LOCATION#loc1#DATE#2026-04-06
 *   GSI1SK: APPT#appt-abc
 */

export interface DynamoItem {
  PK: string;
  SK: string;
  GSI1PK?: string;
  GSI1SK?: string;
  ttl?: number;
  entityType: string;
  [key: string]: unknown;
}

export interface SessionItem extends DynamoItem {
  entityType: "SESSION";
  sessionId: string;
  tenantId: string;
  currentState: string;
  structuredContext: Record<string, unknown>;
  stateConversationTurns: Array<Record<string, unknown>>;
  incompletePreWork: boolean;
  channel: string;
  walkInLocationId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDocItem extends DynamoItem {
  entityType: "SESSION_DOC";
  sessionId: string;
  documentType: string;
  status: string;
  s3Key?: string;
  ocrResult?: Record<string, unknown>;
  validationResult?: string;
}

export interface SessionHistoryItem extends DynamoItem {
  entityType: "SESSION_HISTORY";
  sessionId: string;
  role: string;
  content: string;
  rawContent?: unknown;
  timestamp: string;
}

export interface TransactionTypeItem extends DynamoItem {
  entityType: "TXNTYPE";
  txnTypeId: string;
  name: string;
  description: Record<string, unknown>;
  averageDurationMinutes: number;
  serviceHours?: { start: string; end: string };
  status: string;
  locationAvailability?: string[];
}

export interface PreScreeningQuestionItem extends DynamoItem {
  entityType: "PRESCREENING";
  txnTypeId: string;
  questionKey: string;
  questionText: string;
  answerType: string;
  blockingRule?: string;
  blockingMessage?: string;
  sequence: number;
}

export interface ConfigItem extends DynamoItem {
  entityType: "CONFIG";
  configType: string;
  value: unknown;
}

export interface AppointmentItem extends DynamoItem {
  entityType: "APPT";
  appointmentId: string;
  tenantId: string;
  sessionId: string;
  locationId: string;
  date: string;
  startTime: string;
  endTime: string;
  totalDurationMinutes: number;
  status: string;
  qrCode?: string;
  createdAt: string;
}

export interface AppointmentTxnItem extends DynamoItem {
  entityType: "APPT_TXN";
  appointmentId: string;
  txnTypeId: string;
  name: string;
  durationMinutes: number;
  status: string;
  blockedReason?: string;
}

export interface LocationItem extends DynamoItem {
  entityType: "LOCATION";
  locationId: string;
  name: string;
  address: string;
  hours: { open: string; close: string };
  stationCount: number;
  capacityRunRate: number;
  lunchShift?: { start: string; end: string };
  transactionTypes: string[];
}

export interface QueueEntryItem extends DynamoItem {
  entityType: "QUEUE";
  locationId: string;
  customerId: string;
  sessionId: string;
  queueType: "regular" | "priority" | "assigned";
  assignedClerkId?: string;
  position: number;
  status: string;
  timestamp: string;
}
