/**
 * State-to-tools registry.
 * Maps each conversation state to its tool definitions and handler.
 * New states' tools are added as they're implemented in later phases.
 */

import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import type { ConversationState, Session } from "@st-lucie/shared-types";
import {
  identifyTransactionTools,
  handleIdentifyTransactionTool,
} from "../tools/identify-transaction/tools.js";
import {
  buildUniversalBlockersTools,
  handleUniversalBlockersTool,
} from "../tools/universal-blockers/tools.js";
import { verifyIdentityTools, handleVerifyIdentityTool } from "../tools/verify-identity/tools.js";
import { uploadDocsTools, handleUploadDocsTool } from "../tools/upload-docs/tools.js";
import { preScreenTools, handlePreScreenTool } from "../tools/pre-screen/tools.js";
import { checkoutTools, handleCheckoutTool } from "../tools/checkout/tools.js";
import { scheduleTools, handleScheduleTool } from "../tools/schedule/tools.js";
import { confirmTools, handleConfirmTool } from "../tools/confirm/tools.js";
import { resolveFactsTools, handleResolveFactsTool } from "../tools/resolve-facts/tools.js";
import { renderBucketsTools, handleRenderBucketsTool } from "../tools/render-buckets/index.js";
import {
  suggestedRepliesTools,
  handleSuggestedRepliesTool,
} from "../tools/suggested-replies/tools.js";
import type { ToolHandler } from "./bedrock-client.js";

/**
 * Get tool definitions for the current state.
 *
 * Some states (notably universal-blockers) build their tool schema
 * dynamically based on session context — e.g. omitting the
 * licenseSuspended input when no active txn is DL-family.
 */
export function getStateTools(state: ConversationState, session: Session): Tool[] {
  switch (state) {
    case "identify-transaction":
      return [...identifyTransactionTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "universal-blockers":
      return [
        ...buildUniversalBlockersTools(session),
        ...renderBucketsTools,
        ...suggestedRepliesTools,
      ];

    case "verify-identity":
      return [...verifyIdentityTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "upload-docs":
      return [...uploadDocsTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "pre-screen":
      return [...preScreenTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "checkout-check":
      return [...checkoutTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "schedule":
      return [...scheduleTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "confirm":
      return [...confirmTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "landing":
      return [...renderBucketsTools, ...suggestedRepliesTools];

    case "resolve-facts":
      return [...resolveFactsTools, ...renderBucketsTools, ...suggestedRepliesTools];

    case "confirm-facts":
      // No LLM tools — customer edits via REST endpoints (/edit-facts,
      // /confirm-facts). The frontend card drives the state.
      return [...renderBucketsTools, ...suggestedRepliesTools];
  }
}

/**
 * Get tool handler for the current state.
 *
 * `render_resolved_buckets` is a read-only, side-effect-free tool wired into
 * every state. We intercept it at the top of the dispatcher so each per-state
 * handler doesn't have to know about it.
 */
export function getStateToolHandler(state: ConversationState, session: Session): ToolHandler {
  const perStateHandler = getPerStateToolHandler(state, session);
  return async (toolName, input) => {
    if (toolName === "render_resolved_buckets") {
      return handleRenderBucketsTool(toolName, input, session);
    }
    if (toolName === "set_suggested_replies") {
      return handleSuggestedRepliesTool(toolName, input, session);
    }
    return perStateHandler(toolName, input);
  };
}

function getPerStateToolHandler(state: ConversationState, session: Session): ToolHandler {
  switch (state) {
    case "identify-transaction":
      return (toolName, input) => handleIdentifyTransactionTool(toolName, input, session);

    case "universal-blockers":
      return (toolName, input) => handleUniversalBlockersTool(toolName, input, session);

    case "verify-identity":
      return (toolName, input) => handleVerifyIdentityTool(toolName, input, session);

    case "upload-docs":
      return (toolName, input) => handleUploadDocsTool(toolName, input, session);

    case "pre-screen":
      return (toolName, input) => handlePreScreenTool(toolName, input, session);

    case "checkout-check":
      return (toolName, input) => handleCheckoutTool(toolName, input, session);

    case "schedule":
      return (toolName, input) => handleScheduleTool(toolName, input, session);

    case "confirm":
      return (toolName, input) => handleConfirmTool(toolName, input, session);

    case "resolve-facts":
      return (toolName, input) => handleResolveFactsTool(toolName, input, session);

    default:
      // No-op handler for states without tools yet
      return async (toolName) => ({
        content: [{ text: `Tool ${toolName} not available in state ${state}` }],
      });
  }
}
