import { strictEqual } from 'node:assert';
import { assertNoRogueChecklist } from '../../services/chatbot/src/conversation/process-message.js';

// Negative cases — must not rewrite.
const universalBlockersAnswer = `One quick check before we go further:\n\n**Do you have at least one form of government-issued photo ID?**\n\n1. Yes\n2. No`;
strictEqual(
  assertNoRogueChecklist(universalBlockersAnswer, 'universal-blockers').rewritten,
  false,
  'blocker chips must not be flagged',
);

const resolveFactsQuestion = `**What kind of vehicle is this?**\n\n1. Passenger car\n2. Motorcycle\n3. Trailer\n4. Low-speed vehicle\n5. Vessel\n6. Mobile home`;
strictEqual(
  assertNoRogueChecklist(resolveFactsQuestion, 'resolve-facts').rewritten,
  false,
  'fact-question chips must not be flagged (no doc keywords)',
);

const sanctionedFinal = `Required Documents to Bring:\n\n1. Photo ID\n2. HSMV 82040\n3. HSMV 84490\n4. HSMV 82105\n5. Builder receipts`;
strictEqual(
  assertNoRogueChecklist(sanctionedFinal, 'confirm-facts').rewritten,
  false,
  'rendering state may include a list',
);

// Conversational mention of "documents you'll need" in prose must not trigger
// the guard — only header-position mentions should. Regression for an issue
// where the bot's first resolve-facts question got nuked because the prose
// included "to determine what documents you'll need to bring".
const proseMentionWithChips = `I'll help you with your driver license renewal. Let me ask you a few questions to determine exactly what documents you'll need to bring.\n\n**Would you like to renew online at MyDMV Portal, or do you need to come in-office?**\n\n1. Online via MyDMV\n2. In-office\n3. Not sure`;
strictEqual(
  assertNoRogueChecklist(proseMentionWithChips, 'resolve-facts').rewritten,
  false,
  "prose-position \"documents you'll need\" must not trigger",
);

// A fact question with 5+ document-name answer chips must NOT be rewritten —
// it's a "pick one" question (has a '?'), not a "bring these" checklist.
// Regression for the resolve-facts identity-doc question getting nuked.
const docChoiceQuestion = `**Which primary identity document do you have?**\n\n1. US passport\n2. Birth certificate\n3. Naturalization certificate\n4. Citizenship certificate\n5. Consular report of birth abroad\n6. None of these\n7. Not sure`;
strictEqual(
  assertNoRogueChecklist(docChoiceQuestion, 'resolve-facts').rewritten,
  false,
  'a doc-named multiple-choice QUESTION must not be flagged as a checklist',
);

// Positive cases — must rewrite.
const headerInVerify = `**Required Documents to Bring:**\n\n1. Title\n2. Photo ID\n3. Insurance proof`;
strictEqual(
  assertNoRogueChecklist(headerInVerify, 'verify-identity').rewritten,
  true,
  'header-shaped reply in verify-identity must be caught',
);

const longListInResolveFacts = `Here's what you'll need:\n\n1. Florida vehicle title\n2. Photo ID\n3. Proof of insurance\n4. HSMV 82040 form\n5. Certified weight slip`;
strictEqual(
  assertNoRogueChecklist(longListInResolveFacts, 'resolve-facts').rewritten,
  true,
  'doc-keyword + 5+ items in resolve-facts must be caught',
);

// Rule 3 — the turn-7 escape: multi-section doc checklist (bold category
// headers + bullets + doc keywords) ENDING with a trailing courtesy question.
// The trailing '?' previously evaded the keyword rule; Rule 3 ignores it.
const turn7Checklist = `The documents you need depend on the service, but here are the general requirements:\n\n**Primary Identity Document** (one of these):\n- Valid U.S. passport\n- Original or certified birth certificate\n- Certificate of Naturalization or Citizenship\n\n**Social Security Proof**:\n- Social Security card with current name\n- W-2 form or paystub\n\n**Florida Address Proof** (two documents):\n- Utility bill\n- Bank statement\n\n**Name Change Documents** (if applicable):\n- Marriage certificate or divorce decree\n\nWould you like more details about any of these, or do you have a specific service in mind?`;
strictEqual(
  assertNoRogueChecklist(turn7Checklist, 'identify-transaction').rewritten,
  true,
  'multi-section doc checklist with a trailing courtesy question must be caught (Rule 3)',
);

// Rule 2 (position-aware) — a FLAT declarative checklist ending with a trailing
// courtesy '?'. The '?' sits BELOW the last list item, so it does not count as
// a framing question.
const flatChecklistTrailingQ = `Here's what you'll need to bring:\n\n- Florida vehicle title\n- Photo ID\n- Proof of insurance\n- HSMV 82040 form\n- Certified weight slip\n\nWould you like more details, or do you have a specific service in mind?`;
strictEqual(
  assertNoRogueChecklist(flatChecklistTrailingQ, 'identify-transaction').rewritten,
  true,
  'flat doc checklist with a trailing courtesy question must be caught (Rule 2 position-aware)',
);

// Regression — prompt-mandated transaction MENUS must NOT be rewritten. These
// contain "title"/"registration"/"license" tokens but are routing choices, not
// doc checklists. The narrowed Rule 2 (lead-phrase OR doc-ONLY keyword) leaves
// them alone, and they have 0 bold-header lines so Rule 3 can't fire.
const top5StuckMenu = `I need a bit more information. Could you tell me what you need to do?\n\n1. Renew your current Florida license\n2. Replace a lost or stolen license\n3. Transfer from another state\n4. Apply for a new ID card\n5. Ask about requirements or fees\n\nWhich would you like to start with?`;
strictEqual(
  assertNoRogueChecklist(top5StuckMenu, 'identify-transaction').rewritten,
  false,
  'Top-5 stuck routing menu (trailing question) must NOT be rewritten',
);

const newResidentMenu = `Welcome to Florida! As a new resident, which of these apply to you?\n\n1. Transfer your out-of-state driver license to Florida\n2. Transfer vehicle title from another state\n3. Register your vehicle in Florida\n4. Get a Florida ID card\n\nWhich of these do you need?`;
strictEqual(
  assertNoRogueChecklist(newResidentMenu, 'identify-transaction').rewritten,
  false,
  'new-resident multi-select menu must NOT be rewritten',
);

const ambiguousPurchaseMenu = `I want to make sure I help with the right thing. Which situation matches yours?\n\n1. I bought a new car from a dealer\n2. I bought a used car from a private seller\n3. I'm transferring a title from out of state\n4. I inherited a vehicle\n5. Something else\n\nWhich situation matches yours?`;
strictEqual(
  assertNoRogueChecklist(ambiguousPurchaseMenu, 'identify-transaction').rewritten,
  false,
  'ambiguous-purchase clarification menu must NOT be rewritten',
);

console.log('OK');
