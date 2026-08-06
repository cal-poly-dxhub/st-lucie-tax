import { describe, expect, it } from "vitest";
import { decide } from "../../../services/chatbot/src/authid/decision.js";
import type { ProofResultRaw } from "../../../services/chatbot/src/authid/types.js";

// Guards the "ignore missing signals" policy (AUTHID_MISSING_SIGNAL_OUTCOME
// default = "ignore"). Our AuthID tenant's verification policy does NOT emit the
// tamper signals (SelfieInjection/Barcode/PAD/DocumentInjection) for ANY scan,
// so the previous fail-closed "reject" default rejected 100% of honest users.
// New rule: a scan is judged only on signals actually present; only an EXPLICIT
// failure blocks. These cases use the real payload shape observed live.

const P = (data: Record<string, unknown>): ProofResultRaw =>
  ({ Payload: { Data: data } }) as unknown as ProofResultRaw;

const FUTURE_DOC = { Document: { Data: [{ Key: "DateOfExpiry", Value: "2035-01-01" }] } };

describe("AuthID decide() — missing-signal policy defaults to ignore", () => {
  it("PASSES an honest scan whose tamper signals are absent (the real live payload)", () => {
    // Matched + live + strong score, but no SelfieInjection/Barcode/PAD/DocInjection
    // fields — exactly what the UAT tenant returned for a genuine, honest scan.
    const d = decide(
      P({
        Matched: true,
        MatchScore: 85,
        LivenessDetectionResult: { IsLive: true, Probability: 0.97 },
        ...FUTURE_DOC,
      }),
    );
    expect(d.outcome).toBe("pass");
    expect(d.reasons).toEqual([]);
  });

  it("still REJECTS an explicit face/document mismatch", () => {
    const d = decide(
      P({ Matched: false, LivenessDetectionResult: { IsLive: true }, ...FUTURE_DOC }),
    );
    expect(d.outcome).toBe("reject");
    expect(d.reasons).toContain("selfie-document-mismatch");
  });

  it("still REJECTS an explicit liveness failure", () => {
    const d = decide(
      P({ Matched: true, LivenessDetectionResult: { IsLive: false }, ...FUTURE_DOC }),
    );
    expect(d.outcome).toBe("reject");
    expect(d.reasons).toContain("liveness-failed");
  });

  it("still REJECTS an explicit tamper FAIL even though missing ones are ignored", () => {
    const d = decide(
      P({
        Matched: true,
        LivenessDetectionResult: { IsLive: true },
        SelfieInjectionAttackDetectionResult: "FAIL",
        ...FUTURE_DOC,
      }),
    );
    expect(d.outcome).toBe("reject");
    expect(d.reasons).toContain("selfie-injection-attack");
  });

  it("still REJECTS an expired document (explicit, not a missing signal)", () => {
    const d = decide(
      P({
        Matched: true,
        LivenessDetectionResult: { IsLive: true },
        Document: { Data: [{ Key: "DateOfExpiry", Value: "2000-01-01" }] },
      }),
    );
    expect(d.outcome).toBe("reject");
    expect(d.reasons).toContain("document-expired");
  });

  it("honors an explicit policy override back to fail-closed (reject on missing)", () => {
    const honestButBare = P({
      Matched: true,
      MatchScore: 85,
      LivenessDetectionResult: { IsLive: true },
      ...FUTURE_DOC,
    });
    const strict = decide(honestButBare, { policy: { missingSignalOutcome: "reject" } });
    expect(strict.outcome).toBe("reject"); // stricter tenants can still fail closed
    const ignore = decide(honestButBare, { policy: { missingSignalOutcome: "ignore" } });
    expect(ignore.outcome).toBe("pass");
  });
});
