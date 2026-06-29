/**
 * Decision logic for AuthID Proof results.
 *
 * Per https://developer.authid.ai/docs/the-onboarding-inspecting-results:
 * "authID does not automatically determine outcomes based on the Proof
 * process signals. Developers must code their own decision logic that
 * properly accounts for failed signals that indicate fraud."
 *
 * Pure function — no I/O, no side effects.
 */
import type { Decision, ProofResultRaw, ExtractedIdentity } from "./types.js";

export function decide(result: ProofResultRaw): Decision {
  const data = result.Payload.Data;
  const rejectReasons: string[] = [];
  const reviewReasons: string[] = [];

  if (data.Matched === false) rejectReasons.push("selfie-document-mismatch");
  if (data.LivenessDetectionResult.IsLive === false) rejectReasons.push("liveness-failed");
  if (data.selfieInjectionAttackDetectionResult === "FAIL")
    rejectReasons.push("selfie-injection-attack");
  if (data.BarcodeSecurity === "FAIL") rejectReasons.push("barcode-tampered");

  const expiryEntry = data.Document.Data.find((kv) => kv.Key === "DateOfExpiry");
  if (expiryEntry) {
    const expiry = new Date(`${expiryEntry.Value}T23:59:59Z`);
    if (Number.isFinite(expiry.getTime()) && expiry.getTime() < Date.now()) {
      rejectReasons.push("document-expired");
    }
  }

  if (data.mismatchMrzOcr === true) reviewReasons.push("mrz-ocr-mismatch");
  if (data.padResult === "FAIL") reviewReasons.push("document-replay-detected");
  if (data.documentInjectionAttackDetectionResult === "FAIL")
    reviewReasons.push("document-injection-attack");

  if (rejectReasons.length > 0) {
    return { outcome: "reject", reasons: [...rejectReasons, ...reviewReasons] };
  }
  if (reviewReasons.length > 0) {
    return { outcome: "review", reasons: reviewReasons };
  }
  return { outcome: "pass", reasons: [] };
}

export function extractIdentity(result: ProofResultRaw): ExtractedIdentity {
  const kv = new Map(result.Payload.Data.Document.Data.map((e) => [e.Key, e.Value]));
  return {
    fullName: kv.get("FullName"),
    dateOfBirth: kv.get("DateOfBirth"),
    address: kv.get("Address"),
  };
}
