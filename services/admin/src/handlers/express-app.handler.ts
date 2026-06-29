/**
 * Lambda entrypoint that wraps the admin Express app via
 * @codegenie/serverless-express. Mirrors the chatbot's handler exactly:
 * named `configure` import (NodeNext default-import shape isn't callable),
 * binarySettings populated for application/pdf in case we add transcript
 * downloads to the admin surface later.
 */

import { configure } from "@codegenie/serverless-express";
import { app } from "../admin-app.js";

export const handler = configure({
  app,
  binarySettings: {
    contentTypes: ["image/*", "application/pdf", "application/octet-stream"],
  },
});
