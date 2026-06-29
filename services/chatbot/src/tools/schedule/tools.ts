/**
 * Tools for the schedule state. The bot opens the scheduling widget; the
 * frontend fetches the offered slot and books via the chatbot's
 * /scheduling/* proxy routes. The bot does not list times itself.
 */
import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";

export const scheduleTools: Tool[] = [
  {
    toolSpec: {
      name: "open_scheduler",
      description:
        "Open the appointment scheduling widget. Call once when entering the schedule state. The widget shows an available time and lets the customer book. Do NOT name offices or times yourself.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {
            customerMessage: {
              type: "string",
              description:
                "Short warm line shown before the widget. E.g. 'Last step — let's find you a time.'",
            },
          },
          required: ["customerMessage"],
        },
      },
    },
  },
];

export interface ScheduleToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  uiAction?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function handleScheduleTool(
  toolName: string,
  _input: Record<string, unknown>,
  _session: Session,
): Promise<ScheduleToolResult> {
  if (toolName === "open_scheduler") {
    return {
      content: [
        {
          text: JSON.stringify({
            status: "scheduler-open",
            guidance:
              "Tell the customer the scheduler is ready below; do not list times. The widget handles it.",
          }),
        },
      ],
      uiAction: { type: "open-scheduler" },
    };
  }
  return { content: [{ text: `Unknown tool: ${toolName}` }] };
}
