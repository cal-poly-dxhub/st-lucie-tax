/**
 * Input validation for API endpoints.
 * Per spec: NFR-SEC — input validation on all API parameters.
 */

const MAX_MESSAGE_LENGTH = 5000;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ALLOWED_FILE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".pdf", ".heic", ".heif"];

export function validateSessionId(sessionId: string): string | null {
  if (!sessionId) return "sessionId is required";
  if (!SESSION_ID_PATTERN.test(sessionId)) return "Invalid sessionId format";
  return null;
}

export function validateMessage(message: string): string | null {
  if (!message || !message.trim()) return "Message is required";
  if (message.length > MAX_MESSAGE_LENGTH)
    return `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`;
  return null;
}

export function validateDocumentType(documentType: string): string | null {
  if (!documentType) return "documentType is required";
  // Allow custom types (from transaction requirements) but sanitize
  if (documentType.length > 100) return "documentType too long";
  if (/[<>"'&]/.test(documentType)) return "documentType contains invalid characters";
  return null;
}

export function validateFilename(filename: string): string | null {
  if (!filename) return "filename is required";
  if (filename.length > 200) return "filename too long";
  const ext = "." + filename.split(".").pop()?.toLowerCase();
  if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
    return `Unsupported file type. Allowed: ${ALLOWED_FILE_EXTENSIONS.join(", ")}`;
  }
  return null;
}

export function validateStateName(stateName: string): string | null {
  const validStates = [
    "landing",
    "identify-transaction",
    "universal-blockers",
    "verify-identity",
    "resolve-facts",
    "confirm-facts",
    "upload-docs",
    "checkout-check",
    "schedule",
    "confirm",
  ];
  if (!stateName) return "stateName is required";
  if (!validStates.includes(stateName)) return `Invalid state: ${stateName}`;
  return null;
}
