/**
 * Wraps known acronyms (FL, CDL, HVUT, etc.) inside a string with `<abbr>`
 * tooltips so customers can hover/focus to see the long-form expansion.
 *
 * Lookup is keyed by the *displayed* token (after humanize), so we wrap "CDL"
 * not "cdl". Tokens not in the curated long-form map render as plain text.
 *
 * Skips wrapping inside the streaming MessageBubble (per UX plan A2/S4 risk
 * note: parsing on every token would flicker tooltips). Used by ConfirmFacts,
 * SidePanel, SmartQuickReplies — surfaces that render finalized text.
 */
import { Fragment } from 'react';
import { acronymLongForm } from '../utils/humanize';

interface Props {
  text: string;
}

export function AcronymText({ text }: Props) {
  // Split on word boundaries while preserving the separators so we can
  // reconstruct the original whitespace/punctuation. \b alone collapses
  // multi-character acronyms like "MyDMV" oddly, so split on any run of
  // word characters and keep the gaps.
  const parts = text.split(/(\b[A-Za-z][A-Za-z]+\b)/);
  return (
    <>
      {parts.map((part, i) => {
        const long = acronymLongForm(part);
        if (long) {
          return (
            <abbr key={i} title={long} className="acronym">
              {part}
            </abbr>
          );
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </>
  );
}
