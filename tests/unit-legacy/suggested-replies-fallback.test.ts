import { strictEqual, deepStrictEqual } from 'node:assert';
import { parseSuggestedRepliesFromMessage } from '../../services/chatbot/src/conversation/process-message.js';

// ---- MUST produce chips ----

// The literal Issue-3 failure: an open-ended follow-up with example options
// presented as a numbered list, where the LLM forgot set_suggested_replies.
const lostItem = `What did you lose? For example:\n\n1. License plate\n2. Vehicle title\n3. Registration sticker\n4. Parking placard`;
const lostItemChips = parseSuggestedRepliesFromMessage(lostItem);
strictEqual(lostItemChips.length, 4, 'lost-item numbered list yields 4 chips');
deepStrictEqual(
  lostItemChips.map(c => c.label),
  ['License plate', 'Vehicle title', 'Registration sticker', 'Parking placard'],
  'labels parsed verbatim',
);

const channelMenu = `Would you like to renew online or come in?\n\n1. Online via MyDMV\n2. In-office\n3. Not sure`;
strictEqual(parseSuggestedRepliesFromMessage(channelMenu).length, 3, 'online/in-office menu yields 3 chips');

// Markdown emphasis + "— gloss" + "(parenthetical)" are stripped.
const glossy = `Which applies?\n\n1. **Renew** — if your license is current\n2. Replace (lost or stolen)\n3. Transfer from another state`;
deepStrictEqual(
  parseSuggestedRepliesFromMessage(glossy).map(c => c.label),
  ['Renew', 'Replace', 'Transfer from another state'],
  'markdown / gloss / parenthetical stripped',
);

// Dedupe (case-insensitive) and cap at 8.
const dupes = `Pick:\n\n1. Renew\n2. renew\n3. Replace`;
strictEqual(parseSuggestedRepliesFromMessage(dupes).length, 2, 'case-insensitive dedupe');

// ---- MUST return [] ----

// Dash-bullet checklist (Issue-1 shape) — no numbered lines, so no chips.
const dashChecklist = `Here's what you'll need:\n\n- Florida vehicle title\n- Photo ID\n- Proof of insurance`;
deepStrictEqual(parseSuggestedRepliesFromMessage(dashChecklist), [], 'dash bullets are not harvested');

// Single numbered item — below the 2-chip floor.
const single = `Your only option:\n\n1. Renew online`;
deepStrictEqual(parseSuggestedRepliesFromMessage(single), [], 'single item -> no chips');

// DEFECT 1: a numbered PROCEDURE (sentences, terminal punctuation) must not
// become chips.
const procedure = `Here's how to proceed:\n\n1. First, gather your identity documents.\n2. Then complete the application form.\n3. Bring payment when you visit.`;
deepStrictEqual(parseSuggestedRepliesFromMessage(procedure), [], 'numbered sentences/procedure -> no chips');

// DEFECT 2: a numbered DOC checklist (multiple document-name labels) is a rogue
// list, not a routing menu.
const numberedDocs = `You'll need to bring:\n\n1. Marriage certificate\n2. Divorce decree\n3. Court order\n4. Birth certificate`;
deepStrictEqual(parseSuggestedRepliesFromMessage(numberedDocs), [], 'numbered doc names -> no chips (rogue list)');

// A numbered list of sub-QUESTIONS must not be harvested (labels end in '?').
const subQuestions = `A few things:\n\n1. Are you renewing?\n2. Is your address current?`;
deepStrictEqual(parseSuggestedRepliesFromMessage(subQuestions), [], 'question-shaped items -> no chips');

console.log('OK');
