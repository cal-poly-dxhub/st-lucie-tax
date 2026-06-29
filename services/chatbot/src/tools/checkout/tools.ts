/**
 * Tools for the checkout-check state.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";
import { getPool } from "@st-lucie/data-access";

export const checkoutTools: Tool[] = [
  {
    toolSpec: {
      name: "check_checkout_eligibility",
      description:
        "Check if any of the customer's active transactions can be completed online. Returns eligible transactions and the checkout URL.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
  {
    toolSpec: {
      name: "proceed_to_scheduling",
      description:
        "Skip online checkout and proceed to in-office appointment scheduling. Call when the customer declines online checkout or no transactions are eligible.",
      inputSchema: {
        json: { type: "object" as const, properties: {} },
      },
    },
  },
];

export interface CheckoutToolResult {
  content: ToolResultContentBlock[];
  shouldAdvance?: boolean;
  uiAction?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function handleCheckoutTool(
  toolName: string,
  _input: Record<string, unknown>,
  session: Session,
): Promise<CheckoutToolResult> {
  switch (toolName) {
    case "check_checkout_eligibility":
      return handleCheckEligibility(session);
    case "proceed_to_scheduling":
      return handleProceed();
    default:
      return { content: [{ text: `Unknown tool: ${toolName}` }] };
  }
}

async function handleCheckEligibility(session: Session): Promise<CheckoutToolResult> {
  const pool = getPool();

  const activeTransactions = session.structuredContext.transactions.filter(
    (t) => t.status === "active",
  );
  const activeTxnIds = activeTransactions.map((t) => t.txnTypeId);

  const result = await pool.query<{
    txn_type_id: string;
    is_online_eligible: boolean;
    online_redirect_url: string | null;
  }>(
    `SELECT txn_type_id, is_online_eligible, online_redirect_url
     FROM transaction_types
     WHERE txn_type_id = ANY($1) AND office_id IS NULL`,
    [activeTxnIds],
  );

  const eligibleSet = new Set(
    result.rows.filter((r) => r.is_online_eligible).map((r) => r.txn_type_id),
  );
  const eligible = activeTransactions.filter((t) => eligibleSet.has(t.txnTypeId));

  if (eligible.length === 0) {
    return {
      content: [
        {
          text: JSON.stringify({
            eligible: false,
            message:
              "None of your transactions can be completed online. Proceeding to appointment scheduling.",
          }),
        },
      ],
      shouldAdvance: true,
    };
  }

  const checkoutUrl = result.rows.find((r) => r.online_redirect_url)?.online_redirect_url ?? "";

  return {
    content: [
      {
        text: JSON.stringify({
          eligible: true,
          eligibleTransactions: eligible.map((t) => t.name),
          checkoutUrl,
          message: `${eligible.length} of your ${activeTransactions.length} transaction(s) can be completed online. Ask the customer if they would like to complete them online or continue to in-office scheduling.`,
        }),
      },
    ],
    uiAction: checkoutUrl
      ? {
          type: "redirect_checkout",
          url: checkoutUrl,
          eligibleTransactions: eligible.map((t) => t.name),
        }
      : undefined,
  };
}

function handleProceed(): CheckoutToolResult {
  return {
    content: [
      {
        text: JSON.stringify({
          status: "proceed",
          message: "Proceeding to appointment scheduling.",
        }),
      },
    ],
    shouldAdvance: true,
  };
}
