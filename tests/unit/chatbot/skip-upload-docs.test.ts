import { describe, expect, it } from "vitest";

import { skipState } from "../../../services/chatbot/src/state-machine/skip-state.js";
import type { Session } from "@st-lucie/shared-types";

// Contract guard for the deterministic upload-docs skip. The chatbot SPA's
// "Skip — I'll bring everything to the office" button calls the /skip endpoint,
// which delegates to skipState(session, "upload-docs"). This asserts that skip
// ALWAYS advances the state machine out of upload-docs regardless of what the
// resident did (or didn't) upload — the guarantee the button relies on, so a
// rejected/absent upload can never strand them in this state.

function uploadDocsSession(docs: Array<{ status: string }> = []): Session {
  return {
    currentState: "upload-docs",
    incompletePreWork: false,
    stateConversationTurns: [],
    structuredContext: { documents: docs },
  } as unknown as Session;
}

describe("skipState — upload-docs deterministic skip", () => {
  it("advances out of upload-docs with nothing uploaded", () => {
    const session = uploadDocsSession([]);
    const result = skipState(session, "upload-docs");

    expect(result.previousState).toBe("upload-docs");
    expect(result.newState).toBe("checkout-check");
    expect(session.currentState).toBe("checkout-check");
    expect(session.incompletePreWork).toBe(true);
  });

  it("advances even when a required doc is still pending (e.g. after a rejected upload)", () => {
    const session = uploadDocsSession([{ status: "pending" }, { status: "validated" }]);
    const result = skipState(session, "upload-docs");

    expect(session.currentState).toBe("checkout-check");
    // Pending docs are flagged skipped so the clerk collects them in person; an
    // already-validated upload is left untouched.
    expect(session.structuredContext.documents[0].status).toBe("skipped");
    expect(session.structuredContext.documents[1].status).toBe("validated");
    expect(result.warning).toMatch(/increase your time at the office/i);
  });

  it("refuses to skip when the session is not actually in upload-docs", () => {
    const session = uploadDocsSession([]);
    session.currentState = "resolve-facts" as Session["currentState"];

    expect(() => skipState(session, "upload-docs")).toThrow(/current state is resolve-facts/i);
  });
});
