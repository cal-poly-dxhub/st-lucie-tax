/**
 * Local Express launcher for the admin dashboard service. Lambda never runs
 * this file; the route surface lives in admin-app.ts.
 */

import "dotenv/config";
import { app } from "./admin-app.js";

const PORT = parseInt(process.env.ADMIN_PORT || "3100", 10);

app.listen(PORT, () => {
  console.log(`St. Lucie Admin Service running at http://localhost:${PORT}`);

  console.log(
    `PostgreSQL: ${process.env.PGHOST || "127.0.0.1"}:${process.env.PGPORT || "5432"}/${process.env.PGDATABASE || "stlucie"}`,
  );
  console.log(`Tenant: ${process.env.TENANT_ID || "stlucie"}`);
});
