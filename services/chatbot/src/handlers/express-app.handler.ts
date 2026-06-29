/**
 * Single Lambda entrypoint that wraps the entire Express app from
 * local-server.ts via @codegenie/serverless-express. Deploys all 25 routes
 * as one Lambda behind an API Gateway {proxy+} integration. This is the
 * deployment shape used for the beta — granular per-route Lambdas
 * are a future optimization.
 */
// Use the named `configure` export rather than the default export. The
// package ships CJS with a TS declaration that exposes both, but under
// NodeNext module resolution the default-import shape is the module
// namespace object — not callable. `configure` is the callable entrypoint.
import { configure } from "@codegenie/serverless-express";
import { app } from "../local-server-app.js";

// `binarySettings.contentTypes` tells serverless-express to base64-encode
// these response bodies before handing them to API Gateway. Without
// `application/pdf` here, the transcript-PDF endpoint returns the raw
// Buffer as a UTF-8 string and every non-UTF-8 byte arrives as the
// replacement char — pages render blank in the downloaded file.
//
// API Gateway must ALSO list `application/pdf` in its `binaryMediaTypes`
// for the proxy integration to decode the base64 back to bytes — see
// infra/backend-stack.ts.
export const handler = configure({
  app,
  binarySettings: {
    contentTypes: ["image/*", "application/pdf", "application/octet-stream"],
  },
});
