import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";

export const renderBucketsTools: Tool[] = [
  {
    toolSpec: {
      name: "render_resolved_buckets",
      description:
        "Read-only. Returns the customer's currently-resolved 'what to bring' list grouped into bring-in items, optional uploads, and forms. ONLY CALL when the customer specifically asks what they need to bring AND the resolveDecisionTrees step has completed. Returns an empty payload otherwise — do NOT improvise items in that case; explain that the list is being built.",
      inputSchema: {
        json: {
          type: "object" as const,
          properties: {},
        },
      },
    },
  },
];

export interface RenderBucketsResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  [key: string]: unknown;
}

export function handleRenderBucketsTool(
  _toolName: string,
  _input: Record<string, unknown>,
  session: Session,
): RenderBucketsResult {
  const resolved = session.structuredContext.resolvedBuckets;
  const totalDuration = session.structuredContext.transactions
    .filter((t) => t.status === "active")
    .reduce((s, t) => s + (t.durationMinutes ?? 0), 0);

  if (!resolved) {
    return {
      content: [
        {
          text: JSON.stringify({
            status: "not-yet-resolved",
            guidance:
              "The list is not yet built. Tell the customer their full list will be ready in a couple of turns. Do NOT improvise items.",
          }),
        },
      ],
    };
  }

  const out = {
    status: "ok" as const,
    totalDurationMinutes: totalDuration,
    bringIn: (resolved.bringIns ?? []).map((i) => ({ itemId: i.itemId, label: i.label })),
    optionalUploads: (resolved.optionalUploads ?? []).map((i) => ({
      itemId: i.itemId,
      label: i.label,
    })),
    forms: (resolved.forms ?? []).map((i) => ({ itemId: i.itemId, label: i.label })),
    guidance:
      "These items are AUTHORITATIVE. Render them exactly as labels above; do not paraphrase, drop, or add items. Mention duration in minutes.",
  };
  return {
    content: [{ text: JSON.stringify(out) }],
  };
}
