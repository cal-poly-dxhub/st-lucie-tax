/**
 * Single Lambda entrypoint that wraps the entire Express app from
 * local-server.ts via @codegenie/serverless-express. Deploys all 25 routes
 * as one Lambda behind an API Gateway {proxy+} integration. This is the
 * deployment shape used for the beta — granular per-route Lambdas
 * are a future optimization.
 *
 * SEC-02 cold-start bootstrap: before the Express app is imported, fetch the
 * app secrets from Secrets Manager into process.env. The app's transitive
 * module-load reads (auth/beta-auth.ts, authid/client.ts) read
 * `process.env.BETA_PASSWORD` etc. at evaluation time, so the secrets MUST be
 * present first. This bundle is CJS (no top-level await), so we defer the app
 * import into the async handler via dynamic `import()` (legal in CJS) and
 * memoize the built handler per cold start.
 */
// Use the named `configure` export rather than the default export. The
// package ships CJS with a TS declaration that exposes both, but under
// NodeNext module resolution the default-import shape is the module
// namespace object — not callable. `configure` is the callable entrypoint.
import { configure } from "@codegenie/serverless-express";
import type { Handler } from "aws-lambda";
import { loadSecretsIntoEnv } from "../auth/load-secrets.js";

let handlerPromise: Promise<Handler> | null = null;

async function buildHandler(): Promise<Handler> {
  // 1. Populate process.env from Secrets Manager (no-op outside the Lambda).
  await loadSecretsIntoEnv();
  // 2. NOW import the app — its module-const secret reads see the loaded values.
  const { app } = await import("../local-server-app.js");
  // 3. Build the serverless-express handler.
  //
  // `binarySettings.contentTypes` tells serverless-express to base64-encode
  // these response bodies before handing them to API Gateway. Without
  // `application/pdf` here, the transcript-PDF endpoint returns the raw
  // Buffer as a UTF-8 string and every non-UTF-8 byte arrives as the
  // replacement char — pages render blank in the downloaded file.
  //
  // API Gateway must ALSO list `application/pdf` in its `binaryMediaTypes`
  // for the proxy integration to decode the base64 back to bytes — see
  // infra/backend-stack.ts.
  return configure({
    app,
    binarySettings: {
      contentTypes: ["image/*", "application/pdf", "application/octet-stream"],
    },
  });
}

export const handler: Handler = async (event, context, callback) => {
  // Memoize: secret fetch + app eval run once per container. On failure the
  // promise is reset (inside loadSecretsIntoEnv) so the next invocation retries
  // a fresh cold bootstrap rather than serving a permanently-wedged container.
  if (!handlerPromise) {
    handlerPromise = buildHandler().catch((err) => {
      handlerPromise = null;
      throw err;
    });
  }
  const inner = await handlerPromise;
  return inner(event, context, callback);
};
