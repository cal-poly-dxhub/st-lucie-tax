/**
 * End-to-end proof of the chatbot→clerk document bridge.
 *
 * Logs in through the real SPA (Cognito), then drives the flow via the SPA's
 * OWN authenticated fetch (page.evaluate) so every call carries the real auth
 * header exactly as a customer's browser would:
 *   1. create session
 *   2. send an opener + answers to reach upload-docs for a doc-bearing txn
 *   3. presign an upload, PUT a passing test image, run AI validate (accept)
 *   4. fetch a slot, book → capture appointmentId + confirmationCode
 *
 * Prints the appointmentId so the verify step can check the office-ops bucket +
 * documents row. Uses an @example.com email so the session is flagged a test.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SITE = "https://st-lucie-tax-collector.calpoly.io/chat/";
const creds = Object.fromEntries(
  readFileSync(process.env.CREDS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const USER = creds.USER || creds.LIVE_USER;
const PASS = creds.PASS || creds.LIVE_PASS;
const IMG = "/mnt/c/Users/mason/Downloads/address_proof_PASS_recent.jpg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rec = (m) => console.log(`[bridge-e2e] ${m}`);

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  let API = null;
  p.on("request", (r) => {
    const u = r.url();
    if (!API && u.includes("/chatbot/")) API = u.slice(0, u.indexOf("/chatbot/"));
  });

  await p.goto(SITE, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(1500);
  // ---- login ----
  const email = p.locator('input[type=email]').first();
  if (await email.count()) {
    await email.fill(USER);
    await p.locator('input[type=password]').first().fill(PASS);
    await p.getByRole("button", { name: /sign in|log ?in|continue/i }).first().click();
    await sleep(6000);
  }
  await p.waitForLoadState("networkidle").catch(() => {});
  // The SPA fires /chatbot/hot-buttons etc. on load, so API is sniffed by now.
  rec(`sniffed API base: ${API}`);
  const testEmail = `bridge-e2e-${Date.now()}@example.com`;

  // Read the base64 image into the page context.
  const imgB64 = readFileSync(IMG).toString("base64");

  const result = await p.evaluate(
    async ({ testEmail, imgB64, apiBase }) => {
      const out = { steps: [] };
      const log = (m) => out.steps.push(m);
      // apiBase is the base the SPA itself calls (sniffed from a live request).
      let authHeader = {};
      try {
        // amazon-cognito stores tokens in localStorage under CognitoIdentity keys
        const keys = Object.keys(localStorage).filter((k) =>
          /CognitoIdentityServiceProvider.*idToken/.test(k),
        );
        if (keys.length) authHeader = { Authorization: `Bearer ${localStorage.getItem(keys[0])}` };
      } catch {}
      const H = { "Content-Type": "application/json", ...authHeader };

      // 1. create session
      let r = await fetch(`${apiBase}/chatbot/sessions`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ channel: "web" }),
      });
      if (!r.ok) return { error: `createSession ${r.status}`, ...out };
      const { sessionId } = await r.json();
      out.sessionId = sessionId;
      log(`session ${sessionId}`);

      const send = async (message) => {
        const rr = await fetch(`${apiBase}/chatbot/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: H,
          body: JSON.stringify({ message }),
        });
        return rr.ok ? rr.json() : { error: rr.status };
      };
      const state = async () => {
        const rr = await fetch(`${apiBase}/chatbot/session-state/${sessionId}`, {
          headers: authHeader,
        });
        return rr.ok ? rr.json() : { error: rr.status };
      };

      // 2. drive to an ID-card flow (no online path → reaches upload-docs).
      await send("I need a Florida state ID card");
      // Answer the eligibility/fact questions generically to progress.
      const answers = [
        "Original — first-time ID",
        "US citizen",
        "US passport",
        "Yes",
        "Two or more",
        "No",
        "No",
        "No",
      ];
      for (const a of answers) {
        const st = await state();
        out.lastState = st.currentState || st.state;
        if ((st.currentState || st.state) === "upload-docs") break;
        await send(a);
        await new Promise((r) => setTimeout(r, 400));
      }
      let st = await state();
      out.lastState = st.currentState || st.state;
      log(`state after answers: ${out.lastState}`);

      // Pull resolved upload slots from session state.
      const buckets = st.structuredContext?.resolvedBuckets || st.resolvedBuckets || {};
      const uploads = buckets.optionalUploads || [];
      out.optionalUploads = uploads.map((u) => u.itemId || u.label);
      if (!uploads.length) {
        out.note = "no optional uploads surfaced; capturing state for diagnosis";
      }
      const itemId = (uploads[0] && (uploads[0].itemId || uploads[0].id)) || "address-proof-1";
      out.chosenItem = itemId;

      // 3. presign → PUT → validate (paths match apps/chatbot-app/src/api.ts)
      const up = await fetch(`${apiBase}/chatbot/sessions/${sessionId}/upload-url`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ documentType: itemId, filename: "proof.jpg" }),
      }).then((x) => (x.ok ? x.json() : { error: x.status }));
      if (up.error) return { error: `upload-url ${up.error}`, ...out };
      out.s3Key = up.s3Key;
      log(`presigned ${up.s3Key}`);

      // PUT the bytes to S3 (no auth header — presigned).
      const bin = Uint8Array.from(atob(imgB64), (c) => c.charCodeAt(0));
      const putRes = await fetch(up.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "image/jpeg" },
        body: bin,
      });
      log(`s3 PUT ${putRes.status}`);

      const val = await fetch(`${apiBase}/chatbot/sessions/${sessionId}/validate-document`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({ documentType: itemId, s3Key: up.s3Key, filename: "proof.jpg" }),
      }).then((x) => (x.ok ? x.json() : { error: x.status }));
      out.validate = val;
      log(`validate verdict: ${val.verdict || val.error}`);

      // 3b. advance to `schedule` deterministically via the SPA's own state
      // endpoints (chat messages don't reliably advance). confirm-facts first,
      // then skip through upload-docs/checkout-check to schedule.
      const post = (path, body) =>
        fetch(`${apiBase}/chatbot/sessions/${sessionId}/${path}`, {
          method: "POST",
          headers: H,
          body: JSON.stringify(body || {}),
        }).then((x) => x.json().then((j) => ({ status: x.status, ...j })).catch(() => ({ status: x.status })));

      for (let i = 0; i < 12; i++) {
        const cur = await state();
        const s = cur.currentState || cur.state;
        out.lastState = s;
        if (s === "schedule") break;
        if (s === "confirm-facts") {
          const cf = await post("confirm-facts", {});
          out.steps.push(`confirm-facts -> ${cf.status} ${cf.error || cf.newState || ""}`);
          if (cf.error === "unresolved-facts") {
            out.unresolved = cf.newlyUnresolved;
            break;
          }
        } else if (s === "upload-docs") {
          const sk = await post("skip", { stateName: s });
          out.steps.push(`skip ${s} -> ${sk.status} ${sk.newState || sk.error || ""}`);
        } else if (s === "checkout-check") {
          // Not skippable — advances when the LLM calls proceed_to_scheduling.
          const r = await send("I'll schedule an in-office appointment");
          out.steps.push(`checkout-check msg -> state ${r.state || r.error || "?"}`);
        } else {
          const r = await send("continue");
          out.steps.push(`msg in ${s} -> ${r.state || r.error || "?"}`);
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      log(`state before book: ${out.lastState}`);

      // 4. slot + book
      const slot = await fetch(`${apiBase}/chatbot/sessions/${sessionId}/scheduling/slot`, {
        headers: authHeader,
      }).then((x) => (x.ok ? x.json() : { error: x.status }));
      out.slot = slot.slot || slot;
      if (!slot.slot) return { error: "no slot offered", ...out };

      const book = await fetch(`${apiBase}/chatbot/sessions/${sessionId}/scheduling/book`, {
        method: "POST",
        headers: H,
        body: JSON.stringify({
          officeId: slot.slot.officeId,
          date: slot.slot.date,
          time: slot.slot.time,
          firstName: "Bridge",
          lastName: "Test",
          email: testEmail,
          phone: "772-555-0142",
        }),
      }).then((x) => (x.ok ? x.json() : { error: x.status, status: x.status }));
      out.book = book;
      log(`book: appt ${book.appointmentId} code ${book.qrCode}`);
      return out;
    },
    { testEmail, imgB64, apiBase: API || "" },
  );

  rec("RESULT: " + JSON.stringify(result, null, 2));
  await b.close();
})().catch((e) => {
  console.log("[bridge-e2e] FATAL " + e.message);
  process.exit(1);
});
