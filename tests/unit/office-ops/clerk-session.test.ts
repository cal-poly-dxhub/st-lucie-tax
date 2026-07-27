import { describe, expect, test } from "vitest";
import {
  clerkLogin,
  setClerkAvailability,
  clerkLogout,
} from "../../../services/office-ops/src/clerk-session.js";
import { mockDb } from "./helpers/mock-db.js";

const CLERK = 10;
const OFFICE = 1;
const DESK = 3;

describe("clerkLogin", () => {
  test("opens a session and returns it when the clerk is active and not logged in", async () => {
    const db = mockDb([
      { rows: [{ id: CLERK }] }, // active clerk lookup
      { rows: [] }, // no existing open session
      {
        rows: [
          {
            id: 700,
            clerk_id: CLERK,
            office_id: OFFICE,
            desk_number: DESK,
            is_available: true,
          },
        ],
      },
    ]);

    const outcome = await clerkLogin(db, CLERK, OFFICE, DESK);

    expect(outcome).toEqual({
      ok: true,
      session: {
        sessionId: 700,
        clerkId: CLERK,
        officeId: OFFICE,
        deskNumber: DESK,
        isAvailable: true,
      },
    });
    expect(db.calls[2].values).toEqual([CLERK, OFFICE, DESK]);
  });

  test("returns clerk_not_found for an unknown or inactive clerk", async () => {
    const db = mockDb([{ rows: [] }]);

    const outcome = await clerkLogin(db, CLERK, OFFICE, DESK);

    expect(outcome).toEqual({ ok: false, error: "clerk_not_found" });
    // No session is created.
    expect(db.calls).toHaveLength(1);
  });

  test("returns already_logged_in when an open session exists at the office", async () => {
    const db = mockDb([{ rows: [{ id: CLERK }] }, { rows: [{ id: 700 }] }]);

    const outcome = await clerkLogin(db, CLERK, OFFICE, DESK);

    expect(outcome).toEqual({ ok: false, error: "already_logged_in" });
    expect(db.calls).toHaveLength(2);
  });
});

describe("setClerkAvailability", () => {
  test("updates availability on the open session", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await setClerkAvailability(db, CLERK, OFFICE, false);

    expect(db.calls[0].sql).toContain("logged_out_at IS NULL");
    expect(db.calls[0].values).toEqual([CLERK, OFFICE, false]);
  });

  test("throws when the clerk has no open session", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(setClerkAvailability(db, CLERK, OFFICE, true)).rejects.toThrow(
      `No active session found for clerk ${CLERK} at office ${OFFICE}`,
    );
  });
});

describe("clerkLogout", () => {
  test("closes the open session and marks the clerk unavailable", async () => {
    const db = mockDb([{ rowCount: 1 }]);

    await clerkLogout(db, CLERK, OFFICE);

    expect(db.calls[0].sql).toContain("logged_out_at = NOW()");
    expect(db.calls[0].sql).toContain("is_available = FALSE");
    expect(db.calls[0].values).toEqual([CLERK, OFFICE]);
  });

  test("throws when the clerk has no open session", async () => {
    const db = mockDb([{ rowCount: 0 }]);

    await expect(clerkLogout(db, CLERK, OFFICE)).rejects.toThrow(
      `No active session found for clerk ${CLERK} at office ${OFFICE}`,
    );
  });
});
