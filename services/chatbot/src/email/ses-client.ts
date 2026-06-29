/**
 * SES client singleton — mirrors the Bedrock client pattern in
 * services/chatbot/src/conversation/bedrock-client.ts.
 *
 * Exposes one `sendEmail()` that fires a plain-text + optional-HTML message.
 * Region defaults to AWS_REGION; the caller is responsible for supplying a
 * verified `from` address (via SES_FROM_ADDRESS env in local-server.ts).
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";

const client = new SESClient({ region: process.env.AWS_REGION || "us-east-1" });

export interface SendEmailArgs {
  from: string;
  to: string;
  subject: string;
  textBody: string;
  htmlBody?: string;
}

export async function sendEmail(args: SendEmailArgs): Promise<string> {
  const result = await client.send(
    new SendEmailCommand({
      Source: args.from,
      Destination: { ToAddresses: [args.to] },
      Message: {
        Subject: { Data: args.subject, Charset: "UTF-8" },
        Body: {
          Text: { Data: args.textBody, Charset: "UTF-8" },
          ...(args.htmlBody ? { Html: { Data: args.htmlBody, Charset: "UTF-8" } } : {}),
        },
      },
    }),
  );
  return result.MessageId ?? "";
}
