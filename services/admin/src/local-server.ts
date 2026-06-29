/**
 * Local Express launcher for the admin dashboard service. Lambda never runs
 * this file; the route surface lives in admin-app.ts.
 */

import "dotenv/config";
import { app } from "./admin-app.js";

const PORT = parseInt(process.env.ADMIN_PORT || "3100", 10);

app.listen(PORT, () => {
  console.log(`St. Lucie Admin Service running at http://localhost:${PORT}`);

  console.log(`DynamoDB table: ${process.env.DYNAMODB_TABLE_NAME || "st-lucie-platform"}`);

  console.log(`Tenant: ${process.env.TENANT_ID || "stlucie"}`);
});
