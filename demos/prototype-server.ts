import express from "express";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import QRCode from "qrcode";
import { pool } from "./db.js";
import { lookupByQrCode, getAppointmentInfo } from "../src/check-in.js";
import { getRequiredDocsStatus } from "../src/documents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const ses = new SESv2Client({ region: "us-west-2" });

const EMAIL = "njriley@calpoly.edu";
const BASE_URL = "http://localhost:3000";

async function sendEmail(input: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}) {
  await ses.send(
    new SendEmailCommand({
      FromEmailAddress: input.from,
      Destination: { ToAddresses: [input.to] },
      Content: {
        Simple: {
          Subject: { Data: input.subject },
          Body: {
            Html: { Data: input.html },
            Text: { Data: input.text },
          },
        },
      },
    }),
  );
}

// ─── Lookup by QR code (backed entirely by src/) ─────────────────────────────
// Wires lookupByQrCode → getAppointmentInfo → getRequiredDocsStatus.
app.post("/api/lookup", async (req, res) => {
  try {
    const qrCode = String(req.body?.qrCode ?? "").trim();
    if (!qrCode) return res.status(400).json({ error: "qrCode required" });

    const match = await lookupByQrCode(pool, qrCode);
    if (!match) return res.json({ found: false });

    const [info, docs] = await Promise.all([
      getAppointmentInfo(pool, match.appointmentId),
      getRequiredDocsStatus(pool, match.appointmentId),
    ]);

    res.json({
      found: true,
      appointmentId: match.appointmentId,
      officeId: match.officeId,
      status: match.status,
      firstName: info.firstName,
      lastName: info.lastName,
      identityVerified: info.identityVerified,
      prescreenCompleted: info.prescreenCompleted,
      requiredDocIds: info.requiredDocIds,
      docs,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("lookup error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ─── Search by last name ─────────────────────────────────────────────────────
// NOT IMPLEMENTED: there is no last-name search function in src/. Returning 501
// rather than running an ad-hoc query so the prototype only exercises real src code.
app.post("/api/search-name", (_req, res) => {
  res.status(501).json({
    error:
      "Last-name search is not implemented in src/. Add e.g. lookupByLastName(db, officeId, lastName) to src/check-in.ts to enable this.",
  });
});

app.post("/api/send-confirmation", async (_req, res) => {
  const qrCode = randomUUID();
  console.log("send-confirmation: qrCode=", qrCode);

  try {
    const { rows } = await pool.query(
      `INSERT INTO appointments (
        office_id, first_name, last_name, contact_email, contact_phone,
        txn_type_ids, required_doc_ids, appointment_date, appointment_time,
        qr_code, status, is_walk_in
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id`,
      [
        1,
        "Jane",
        "Smith",
        EMAIL,
        "772-555-0001",
        [1],
        ["photo_id", "insurance_card"],
        "2026-06-24",
        "09:30",
        qrCode,
        "scheduled",
        false,
      ],
    );
    const appointmentId = rows[0].id;
    console.log("send-confirmation: appointmentId=", appointmentId);

    const qrDataUrl = await QRCode.toDataURL(qrCode, {
      errorCorrectionLevel: "M",
      width: 200,
    });

    const html = `<p>Hi Jane,</p>
<p>Your appointment is confirmed:</p>
<ul>
  <li><strong>Appointment ID:</strong> ${appointmentId}</li>
  <li><strong>QR Code:</strong> ${qrCode}</li>
  <li><strong>Date:</strong> Tuesday, June 24, 2026</li>
  <li><strong>Time:</strong> 9:30 AM</li>
  <li><strong>Location:</strong> Port St. Lucie (Crosstown Pkwy)</li>
</ul>
<p>Present this QR code at check-in:</p>
<img src="${qrDataUrl}" alt="QR Code" width="200" height="200" />
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

    const text = `Hi Jane,

Your appointment is confirmed:
- Appointment ID: ${appointmentId}
- QR Code: ${qrCode}
- Date: Tuesday, June 24, 2026
- Time: 9:30 AM
- Location: Port St. Lucie (Crosstown Pkwy)

Please present your QR code at check-in.

Thank you,
St. Lucie County Tax Collector`;

    try {
      await sendEmail({
        to: EMAIL,
        from: EMAIL,
        subject: "Appointment Confirmed",
        html,
        text,
      });
    } catch (emailErr: unknown) {
      console.error("Email send failed:", emailErr);
    }

    res.json({ ok: true, qrCode, appointmentId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-confirmation error:", msg);
    res.status(500).json({ error: msg });
  }
});

app.post("/api/send-prescreen", async (_req, res) => {
  try {
    const qrCode = randomUUID();
    const prescreenUrl = `${BASE_URL}/prescreen/${qrCode}`;

    const html = `<p>Hi Jane,</p>
<p>Please complete your pre-screen questions before your appointment:</p>
<p><a href="${prescreenUrl}">${prescreenUrl}</a></p>
<p>Thank you,<br>St. Lucie County Tax Collector</p>`;

    const text = `Hi Jane,

Please complete your pre-screen questions before your appointment:
${prescreenUrl}

Thank you,
St. Lucie County Tax Collector`;

    await sendEmail({
      to: EMAIL,
      from: EMAIL,
      subject: "Complete Your Pre-Screen Questions",
      html,
      text,
    });

    res.json({ ok: true, prescreenUrl });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("send-prescreen error:", msg);
    res.status(500).json({ error: msg });
  }
});

const server = app.listen(3000, () => {
  console.log("Prototype server running at http://localhost:3000/prototype.html");
});

server.on("error", (err) => {
  console.error("Server failed to start:", err.message);
  process.exit(1);
});
