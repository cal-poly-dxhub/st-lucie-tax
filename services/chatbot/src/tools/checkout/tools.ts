/**
 * Tools for the checkout-check state.
 */

import type { Tool, ToolResultContentBlock } from "@aws-sdk/client-bedrock-runtime";
import type { Session } from "@st-lucie/shared-types";
import { getConfigValue } from "@st-lucie/data-access";

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
  // Load all transaction types to check onlineEligible
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient, ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const client = new DynamoDBClient({ region: process.env.AWS_REGION || "us-east-1" });
  const docClient = DynamoDBDocumentClient.from(client);

  const result = await docClient.send(
    new ScanCommand({
      TableName: process.env.DYNAMODB_TABLE_NAME || "st-lucie-platform",
      FilterExpression: "entityType = :et",
      ExpressionAttributeValues: { ":et": "TXNTYPE" },
    }),
  );

  const txnTypes = new Map<string, Record<string, unknown>>();
  for (const item of result.Items || []) {
    txnTypes.set(item.txnTypeId as string, item);
  }

  const activeTransactions = session.structuredContext.transactions.filter(
    (t) => t.status === "active",
  );
  const eligible = activeTransactions.filter((t) => {
    const txnType = txnTypes.get(t.txnTypeId);
    const desc = txnType?.description as Record<string, unknown> | undefined;
    return desc?.onlineEligible === true;
  });

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

  const checkoutUrl = ((await getConfigValue(session.tenantId, "CHECKOUT_URL")) as string) || "";

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
