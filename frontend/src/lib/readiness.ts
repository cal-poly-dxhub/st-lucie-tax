import type { CustomerRecord } from "./api";

export interface ReadinessGap {
  key: string;
  label: string;
}

export interface Readiness {
  ready: boolean;
  gaps: ReadinessGap[];
  docsValidated: number;
  docsRequired: number;
}

// A customer is ready for the queue when identity is verified, the pre-screen
// is complete, and every required document is both uploaded and clerk-validated.
export function computeReadiness(rec: CustomerRecord): Readiness {
  const gaps: ReadinessGap[] = [];

  if (!rec.identityVerified) gaps.push({ key: "identity", label: "Identity not verified" });
  if (!rec.prescreenCompleted) gaps.push({ key: "prescreen", label: "Pre-screen not completed" });

  const docsRequired = rec.docs.length;
  const docsValidated = rec.docs.filter((d) => d.clerkValidated).length;

  for (const doc of rec.docs) {
    if (!doc.uploaded) {
      gaps.push({ key: `doc-${doc.docId}`, label: `${doc.name} not uploaded` });
    } else if (doc.aiReviewStatus === "reject") {
      gaps.push({ key: `doc-${doc.docId}`, label: `${doc.name} flagged by AI review` });
    } else if (!doc.clerkValidated) {
      gaps.push({ key: `doc-${doc.docId}`, label: `${doc.name} not validated` });
    }
  }

  return { ready: gaps.length === 0, gaps, docsValidated, docsRequired };
}
