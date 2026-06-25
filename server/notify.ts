import { pool } from "./db.js";
import { ses, EMAIL } from "./config.js";
import { buildQueueSummonEmail, sendEmail } from "../src/email.js";

// Sends the "it's your turn" email for a queued customer who has just been
// assigned a desk. Failures are swallowed: a transient SES error must never
// fail the clerk's summon/complete action. In the deployed architecture this
// is the seam to move behind SQS (producer here, worker consumes).
export async function sendSummonEmail(queueId: number): Promise<void> {
  try {
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

    const emailInput = buildQueueSummonEmail({
      recipientEmail: row.contact_email,
      firstName: row.first_name,
      confirmationCode: row.confirmation_code,
      deskNumber: row.assigned_desk,
      officeName: row.office_name,
      fromEmail: EMAIL,
    });
    await sendEmail(ses, emailInput);
  } catch (err) {
    console.error("summon email failed:", err);
  }
}
