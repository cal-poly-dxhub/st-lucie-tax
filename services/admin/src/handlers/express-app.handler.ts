/**
 * Lambda entrypoint that wraps the admin Express app via
 * @codegenie/serverless-express. Mirrors the chatbot's handler exactly:
 * named `configure` import (NodeNext default-import shape isn't callable),
 * binarySettings populated for application/pdf in case we add transcript
 * downloads to the admin surface later.
 *
 * SEC-02 cold-start bootstrap: fetch the admin secrets from Secrets Manager
 * into process.env before importing the app, so admin-auth.ts's module-const
 * reads of ADMIN_PASSWORD/ADMIN_AUTH_SECRET see real values. CJS bundle → no
 * top-level await → defer the app import into the async handler via dynamic
 * import(), memoized per cold start.
 */
import { configure } from "@codegenie/serverless-express";
import type { Handler } from "aws-lambda";
import { loadSecretsIntoEnv } from "../auth/load-secrets.js";

let handlerPromise: Promise<Handler> | null = null;

async function buildHandler(): Promise<Handler> {
  await loadSecretsIntoEnv();
  const { app } = await import("../admin-app.js");
  return configure({
    app,
    binarySettings: {
      contentTypes: ["image/*", "application/pdf", "application/octet-stream"],
    },
  });
}

export const handler: Handler = async (event, context, callback) => {
  if (!handlerPromise) {
    handlerPromise = buildHandler().catch((err) => {
      handlerPromise = null;
      throw err;
    });
  }
  const inner = await handlerPromise;
  return inner(event, context, callback);
};
