/**
 * Clerk-side verification: log into the office-ops app and call the authed
 * POST /api/lookup for a confirmation code — reads the `docs` array the Service
 * Clerk view renders. Proves a bridged chatbot upload shows to the clerk.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const SITE = "https://st-lucie-tax-collector.calpoly.io/";
const CODE = process.env.CODE;
const creds = Object.fromEntries(
  readFileSync(process.env.CREDS, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    }),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const b = await chromium.launch({ headless: true });
  const p = await b.newPage();
  let API = null;
  p.on("request", (r) => {
    const u = r.url();
    if (!API && /\/api\//.test(u) && !/\/api\/chat|\/api\/admin/.test(u))
      API = u.slice(0, u.indexOf("/api/")) + "/api";
  });
  await p.goto(SITE, { waitUntil: "networkidle", timeout: 60000 });
  await sleep(1500);
  const email = p.locator('input[type=email]').first();
  if (await email.count()) {
    await email.fill(creds.USER || creds.LIVE_USER);
    await p.locator('input[type=password]').first().fill(creds.PASS || creds.LIVE_PASS);
    await p.getByRole("button", { name: /sign in|log ?in|continue/i }).first().click();
    await sleep(6000);
  }
  await p.waitForLoadState("networkidle").catch(() => {});

  const out = await p.evaluate(
    async ({ apiBase, code }) => {
      let auth = {};
      try {
        const k = Object.keys(localStorage).filter((x) =>
          /CognitoIdentityServiceProvider.*idToken/.test(x),
        );
        if (k.length) auth = { Authorization: `Bearer ${localStorage.getItem(k[0])}` };
      } catch {}
      const base = apiBase || "/api";
      const r = await fetch(`${base}/lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...auth },
        body: JSON.stringify({ confirmationCode: code }),
      });
      const body = r.ok ? await r.json() : { error: r.status, text: await r.text() };
      return { status: r.status, apiBase: base, body };
    },
    { apiBase: API, code: CODE },
  );

  console.log(JSON.stringify(out, null, 2));
  await b.close();
})().catch((e) => {
  console.log("FATAL " + e.message);
  process.exit(1);
});
