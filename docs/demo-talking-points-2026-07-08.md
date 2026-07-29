# Demo Talking Points — 2026-07-08

_Progress since the last demo (2026-06-25). Project: St. Lucie County Tax Collector conversational-AI chatbot._

---

## 30-second recap ("since 6/25 we…")

> "Since the last demo we shipped **AI document screening** to production, hardened all our
> secrets into **AWS Secrets Manager**, and completed a full **requirements audit** against the
> original spec so we know exactly what's done and what's next for handoff."

---

## ⭐ 1. Headliner — AI Document Pass/Reject Screen (NEW, live, verified)

The one net-new user-facing feature since 6/25. Built, deployed to production, and verified
end-to-end in a real browser.

**The pitch:** Residents upload documents in the chat; the bot uses **Claude Haiku 4.5 vision**
to catch obviously-wrong uploads (selfies, blank pages, screenshots, random photos) so junk
never reaches the tax office — with instant retry.

**Live demo flow (works on prod CloudFront):**
1. "I need to renew my vehicle registration" → confirm the transaction
2. Answer eligibility (have photo ID) → **active-duty military: yes** → not a heavy truck
3. Skip identity → **Confirm and continue** → reach **Upload docs** (two upload slots appear)
4. **Upload a selfie/junk → HARD REJECT** with a plain-English reason + "Try another file"
5. **Re-upload the real document → ACCEPTS** ("Uploaded: …")

**Points that make it sound thoughtful:**
- **Conservative by design** — fails *open* on anything unclear, so it never blocks a real
  resident. It screens for "obviously the wrong thing," not "is this a good-quality scan."
- **Matches the expected doc type** — e.g. military orders correctly reject against a
  registration slot (not just "document vs. not-document").
- **Cheap + fast** — Haiku vision, runs synchronously so the resident gets an instant verdict.

**Honest footnote (if asked):** only 2 document types are uploadable today (registration,
military orders). The AI screen is the safety net that makes *expanding* that list safe.

---

## 2. Security maturity — SEC-02 Secrets Manager cutover (shipped to prod)

- Moved all 6 runtime secrets out of Lambda env vars into **AWS Secrets Manager**, fetched at
  cold start, **fail-closed** (refuses to run with auth disabled). Live in production.
- **Why it matters:** production-grade hardening for a government app handling PII — signals the
  project maturing toward a clean handoff, not just prototype features.
- Talk about it; can't "show" it (invisible to users).

---

## 3. "We know exactly where we stand" — Requirements Audit (great for handoff audience)

Evaluated **all 90 original MVP requirements** against the live codebase with file-level evidence:

| Verdict | Count | Meaning |
|---|---|---|
| ✅ Done | ~19 | Implemented + verifiable in prod |
| 🟡 Partial / pivoted | ~58 | Built differently than spec, or partial, or built-not-wired |
| ⬜ Untouched | ~13 | Whole future-phase surfaces |

**The narrative (this is a confidence-builder, not a confession):**
> "We deliberately traded **breadth for depth**. Rather than build thin versions of all five
> product surfaces, we made the **public chatbot genuinely good and shipped it to production**.
> The chatbot is the real, deployed product. The clerk dashboard, scheduling engine, and
> notifications are understood future phases — and we have a documented map of every one."

**Foundations are genuinely solid** (all ✅): serverless auto-scaling, data-retention TTLs
(30-day PII / 3-year records), multi-tenant data model, least-privilege IAM.

**Three intentional pivots** (each meets intent, differs from literal spec — good to name proactively):
- DL identity: **Bedrock OCR → AuthID** (DL scan + selfie + liveness)
- Auth: **Cognito → shared password + HMAC tokens** (no per-user identity yet)
- Per-transaction AI: **per-state prompts + decision trees** (trees as source of truth)

**Future phases (be honest — NOT near-done):** service-clerk dashboard, wired scheduling/queue
engine (exists as an unhosted POC), notifications/Twilio SMS, Cognito/RBAC, admin config CRUD.

---

## 4. Production-readiness work (handoff story)

- Ran a prioritized **production-readiness audit** → a punch-list of cheap security closers
  (attach WAF, wire input validation, redact log path, pin TLS, close a session-ownership IDOR).
- Signals "we know the last mile," which is exactly what a partner handoff needs.

---

## 5. Design / research you can speak to (no code, decision-grade)

- **QR-code identity exploration** — researched mailing residents a pre-assigned, identity-bound
  chat session (anti-impersonation). Good "here's the strategic thinking" talking point.
- **Mobile UX** — phone-optimized layout (2-column hot buttons, quick-replies drawer, tighter
  input) for phone-majority TCSLC traffic. _Only re-show if it wasn't already the centerpiece on
  6/25 — most of it landed 6/22–6/24._

---

## Honest framing note (read before the meeting)

Compared to a full demo-to-demo cadence, **feature volume is modest** — the AI document screen
is really the one net-new user-facing thing. Lean into it as a **complete, polished,
deployed-and-verified feature**, paired with the **security + audit maturity** work. That framing
is both accurate and impressive. Don't imply a big pile of new features.

---

## Suggested 3-beat flow

1. **Recap** (30 sec) — the "since 6/25" line above.
2. **Live-demo the doc screen** — the reject → retry → accept loop is visceral and new. The star.
3. **Close on trajectory** — flash the requirements scoreboard: "we know exactly what's done vs.
   what's next," name the future phases, mention handoff-readiness.

---

## Possible "and we also shipped X" (only if built before the meeting)

- **Checkout redirect URL (FR-CHAT-09)** — point `CHECKOUT_URL` config at the real MyEasyGov URL
  (already in seed data) so the online-checkout redirect works live. ~15 min, low risk.
- **Lien-transfer letter (FR-CHAT-14)** — auto-generate a printable lienholder letter (pdfkit
  already in the repo). Bigger lift (~half-day). ⚠️ Verify against discovery transcript
  (L468–480 / Partner SOP §3.1) first — spec says "generate," design docs elsewhere say "guide
  them to obtain one." Confirm which Lucie actually asked for before building.

---

## Open flag to raise (not a demo item, but timely)

The prototype is deployed in a **DxHub Innovation Sandbox account** (sandbox-14 / `522814693903`).
Sandboxes are **leased/time-boxed** — confirm the lease won't expire before handoff and there's a
plan to keep the deployed prototype (or migrate it to the partner's account) alive.
