import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { pool } from "../db.js";
import { ses, EMAIL } from "../config.js";
import { buildQueueSummonEmail, sendEmail } from "../../src/email.js";

// SQS-triggered worker that drains queued summon/confirmation emails. Buffering
// SES behind a queue means a SES throttle never blocks the clerk's summon or
// complete-and-next action — the producer enqueues and returns immediately.
// Messages are { type: "summon", queueId } for now.
interface SummonMessage {
  type: "summon";
  queueId: number;
}

async function handleSummon(queueId: number): Promise<void> {
  const { rows } = await pool.query<{
    confirmation_code: string;
    first_name: string;
    contact_email: string | null;
    assigned_desk: number | null;
    office_name: string;
  }>(
    `SELECT a.confirmation_code, a.first_name, a.contact_email,
            q.assigned_desk, o.name AS office_name
     FROM queue q
     JOIN appointments a ON a.id = q.appointment_id
     JOIN offices o ON o.id = q.office_id
     WHERE q.id = $1`,
    [queueId],
  );
  const row = rows[0];
  if (!row?.contact_email || row.assigned_desk === null) return;

  await sendEmail(
    ses,
    buildQueueSummonEmail({
      recipientEmail: row.contact_email,
      firstName: row.first_name,
      confirmationCode: row.confirmation_code,
      deskNumber: row.assigned_desk,
      officeName: row.office_name,
      fromEmail: EMAIL,
    }),
  );
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const msg = JSON.parse(record.body) as SummonMessage;
      if (msg.type === "summon") await handleSummon(msg.queueId);
    } catch (err) {
      console.error("email worker failed for message", record.messageId, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
