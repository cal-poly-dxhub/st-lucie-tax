/**
 * Local Express dev server for Chatbot Service.
 *
 * The full route surface lives in `local-server-app.ts` so the same Express
 * app can also be wrapped by the Lambda handler at
 * `handlers/express-app.handler.ts`. This file exists only to bind the app
 * to a TCP port for `npm run dev` — Lambda never executes it.
 */

import "dotenv/config";
import { app } from "./local-server-app.js";

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`St. Lucie Chatbot Service running at http://localhost:${PORT}`);
  console.log(
    `Using Bedrock model: ${process.env.BEDROCK_MODEL_ID || "us.anthropic.claude-sonnet-4-20250514-v1:0"}`,
  );
  console.log(
    `PostgreSQL: ${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "stlucie"}`,
  );
  console.log(`Tenant: ${process.env.TENANT_ID || "stlucie"}`);
});
