/**
 * set_suggested_replies — universal tool available in ALL states.
 *
 * The LLM calls this whenever it presents a list of options to the customer.
 * The replies are stored on structuredContext.suggestedReplies and returned to
 * the frontend, which renders them as clickable chips below the chat input.
 *
 * This solves the "stale chips" problem: previously the LLM would present
 * "1. DL Renewal, 2. DL Replacement..." as prose, but the frontend had no
 * structured data to update the quick-reply buttons from.
 */

import type { Tool, ToolResultContentBlock } from '@aws-sdk/client-bedrock-runtime';
import type { Session } from '@st-lucie/shared-types';

export const suggestedRepliesTools: Tool[] = [
  {
    toolSpec: {
      name: 'set_suggested_replies',
      description:
        'Set the quick-reply buttons shown below the chat input. Call this EVERY time you present a list of options to the customer (numbered list, yes/no question, multiple choices). The buttons will match exactly what you offered. Call with an empty replies array to clear the buttons (e.g., when asking a free-form question).',
      inputSchema: {
        json: {
          type: 'object',
          properties: {
            replies: {
              type: 'array',
              description: 'The options to show as clickable buttons. Each has a short label (what the button shows) and a value (the text sent when tapped — usually the same as the label).',
              items: {
                type: 'object',
                properties: {
                  label: { type: 'string', description: 'Button text shown to the customer (short, 2-6 words).' },
                  value: { type: 'string', description: 'Message sent when tapped. Usually same as label unless a longer phrase is needed for the bot to understand.' },
                },
                required: ['label', 'value'],
              },
            },
          },
          required: ['replies'],
        },
      },
    },
  },
];

export function handleSuggestedRepliesTool(
  _toolName: string,
  input: Record<string, unknown>,
  session: Session,
): { content: ToolResultContentBlock[]; shouldAdvance?: boolean } {
  const replies = input.replies as Array<{ label: string; value: string }> | undefined;
  if (!Array.isArray(replies)) {
    session.structuredContext.suggestedReplies = [];
    return { content: [{ text: JSON.stringify({ status: 'cleared' }) }] };
  }

  // Cap at 8 options to prevent UI overflow.
  const cleaned = replies.slice(0, 8).map(r => ({
    label: String(r.label || '').slice(0, 60),
    value: String(r.value || r.label || '').slice(0, 120),
  }));

  session.structuredContext.suggestedReplies = cleaned;
  return { content: [{ text: JSON.stringify({ status: 'ok', count: cleaned.length }) }] };
}
