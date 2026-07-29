/**
 * Backend Stack — Unit 2 (Chatbot portion)
 * Per spec: unit-of-work.md Unit 2
 *
 * Creates:
 * - API Gateway REST API with /chatbot/* routes
 * - Lambda functions for each handler
 * - IAM roles (DynamoDB, Bedrock, S3)
 */

import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHATBOT_SRC = join(__dirname, "..", "services", "chatbot", "src");

export class BackendStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Import foundation stack outputs via SSM
    const tableName = ssm.StringParameter.valueForStringParameter(
      this,
      "/stlucie/dynamodb-table-name",
    );
    const tableArn = ssm.StringParameter.valueForStringParameter(
      this,
      "/stlucie/dynamodb-table-arn",
    );
    const docBucketName = ssm.StringParameter.valueForStringParameter(
      this,
      "/stlucie/doc-bucket-name",
    );
    const docBucketArn = ssm.StringParameter.valueForStringParameter(
      this,
      "/stlucie/doc-bucket-arn",
    );

    // SEC-02: the four runtime SECRETS (BETA_PASSWORD, BETA_AUTH_SECRET,
    // AUTHID_API_KEY_ID, AUTHID_API_KEY_VALUE) live in AWS Secrets Manager, NOT
    // in the Lambda env. The Lambda fetches them at cold start (see
    // services/chatbot/src/auth/load-secrets.ts) using the SECRETS_ARN below.
    //
    // The secret is created with a random PLACEHOLDER value so no real secret is
    // ever baked into the CloudFormation template / cdk.out. Populate the real
    // values out-of-band after deploy:
    //   aws secretsmanager put-secret-value --secret-id stlucie/chatbot/app-secrets \
    //     --secret-string '{"BETA_PASSWORD":"...","BETA_AUTH_SECRET":"...","AUTHID_API_KEY_ID":"...","AUTHID_API_KEY_VALUE":"..."}'
    // then force a cold start. See infra/DEPLOY.md.
    const appSecrets = new secretsmanager.Secret(this, "ChatbotAppSecrets", {
      secretName: "stlucie/chatbot/app-secrets",
      description:
        "SEC-02: BETA_* and AUTHID_* runtime secrets, fetched at Lambda cold start. " +
        "Populate real values via put-secret-value; never set from CDK.",
      generateSecretString: {
        // Random throwaway so the secret has a version on create. The real
        // values are written post-deploy and ignored keys are harmless.
        secretStringTemplate: JSON.stringify({
          BETA_PASSWORD: "",
          BETA_AUTH_SECRET: "",
          AUTHID_API_KEY_ID: "",
          AUTHID_API_KEY_VALUE: "",
        }),
        generateStringKey: "placeholder",
      },
    });

    // AuthID NON-secret config stays as plaintext env vars (base URL + the DL
    // document-type code are not credentials).
    const authIdBaseUrl = process.env.AUTHID_BASE_URL ?? "https://id-uat.authid.ai";
    const authIdDlDocTypeCode = process.env.AUTHID_DL_DOC_TYPE_CODE ?? "5";

    // Shared Lambda environment
    const lambdaEnv = {
      DYNAMODB_TABLE_NAME: tableName,
      DOC_BUCKET_NAME: docBucketName,
      TENANT_ID: "stlucie",
      NODE_OPTIONS: "--enable-source-maps",
      BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-4-20250514-v1:0",
      // Cheap vision model for the document-upload pass/reject screen
      // (upload/validate-document.ts). The exact Haiku 4.5 inference-profile id
      // is tenant-specific — VERIFY with `aws bedrock list-inference-profiles`
      // in the prod account before deploy (treat like AUTHID_DL_DOC_TYPE_CODE).
      BEDROCK_VISION_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
      // The vision call runs in its OWN region: Haiku 4.5 model access is
      // enabled in us-east-2 / us-west-2 but NOT us-east-1 in this account
      // (invoke there 403s on the Marketplace subscription). The main chatbot
      // (Sonnet), KB, DynamoDB and S3 all stay in us-east-1.
      BEDROCK_VISION_REGION: "us-east-2",
      // Doc-screen tuning (upload/validate-document.ts), promoted to env so ops
      // can adjust without a redeploy. REJECT_THRESHOLD: min model confidence
      // for a plausibility reject to block. EXPIRY_ENABLED: kill-switch for
      // date-based (expiry/recency) rejection — set 'false' to disable if a
      // validity rule misfires in prod (plausibility + date observation stay on).
      DOC_VALIDATION_REJECT_THRESHOLD: "0.85",
      DOC_VALIDATION_EXPIRY_ENABLED: "true",
      BEDROCK_KB_ID: "DREJTMKWRM",
      // SEC-12: inject the deploying account at synth time so application code
      // (knowledge-base/query.ts builds the inference-profile ARN from it)
      // never falls back to its hardcoded literal in the deployed Lambda.
      AWS_ACCOUNT_ID: this.account,
      // SEC-02: secrets are fetched at cold start from this ARN, not injected
      // as plaintext env vars. An ARN is not sensitive.
      SECRETS_ARN: appSecrets.secretArn,
      AUTHID_BASE_URL: authIdBaseUrl,
      AUTHID_DL_DOC_TYPE_CODE: authIdDlDocTypeCode,
      // Scheduling service (devs' schedule-poc-v2). Empty URL = scheduling
      // unavailable — the deployed Lambda can't reach the localhost demo
      // service, so it degrades to "call the office" rather than erroring.
      SCHEDULING_API_URL: process.env.SCHEDULING_API_URL ?? "",
      SCHEDULING_COUNTY_ID: process.env.SCHEDULING_COUNTY_ID ?? "stlucie",
    };

    // Shared Lambda role for chatbot service
    const chatbotRole = new iam.Role(this, "ChatbotLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    // SEC-02: scoped GetSecretValue on ONLY this service's secret (grantRead
    // emits secretsmanager:GetSecretValue + DescribeSecret on the secret ARN).
    appSecrets.grantRead(chatbotRole);

    // DynamoDB permissions
    chatbotRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:DeleteItem",
          "dynamodb:BatchWriteItem",
        ],
        resources: [tableArn, `${tableArn}/index/*`],
      }),
    );

    // Bedrock permissions. GetInferenceProfile + GetFoundationModel +
    // InvokeModelWithResponseStream are now required by the Bedrock Agent
    // Runtime SDK when using cross-region inference-profile model IDs
    // (the `us.anthropic...` prefix). Without GetInferenceProfile, the
    // KB Retrieve-and-Generate path fails with 403 even though the
    // standard InvokeModel call succeeds.
    //
    // SEC-01: scoped away from the previous `resources: ['*']` to bound the
    // blast radius — a compromised Lambda can now only touch our Sonnet-4
    // family and our one Knowledge Base, not arbitrary models/KBs in the
    // account. Three ARN shapes are in play and ALL are required:
    //   - foundation-model ARNs are region-qualified but ACCOUNT-LESS; the
    //     `us.` cross-region profile fans out to us-east-1/us-east-2/us-west-2,
    //     so the region segment is wildcarded.
    //   - inference-profile ARNs ARE account-qualified and live per-region.
    //   - the KB ARN is account- and region-qualified.
    // We wildcard the sonnet-4 family (…sonnet-4-*) so a model minor-version
    // bump doesn't require an IAM change + redeploy.
    const sonnet4FoundationModels = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-*",
    ];
    const sonnet4InferenceProfiles = [
      `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-*`,
    ];
    // Haiku 4.5 — the cheap vision model that screens document uploads
    // (upload/validate-document.ts via BEDROCK_VISION_MODEL_ID). Same two ARN
    // shapes as sonnet-4, version-wildcarded so a minor bump needs no IAM change.
    const haikuVisionFoundationModels = [
      "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*",
    ];
    const haikuVisionInferenceProfiles = [
      `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-*`,
    ];
    const knowledgeBaseArn = `arn:aws:bedrock:*:${this.account}:knowledge-base/DREJTMKWRM`;

    // Invoke + profile/model metadata reads — model & inference-profile ARNs.
    // These actions DO support resource-level scoping.
    chatbotRole.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
          "bedrock:GetInferenceProfile",
          "bedrock:GetFoundationModel",
        ],
        resources: [
          ...sonnet4FoundationModels,
          ...sonnet4InferenceProfiles,
          ...haikuVisionFoundationModels,
          ...haikuVisionInferenceProfiles,
        ],
      }),
    );

    // bedrock:Retrieve IS scopeable to the knowledge-base ARN.
    chatbotRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:Retrieve"],
        resources: [knowledgeBaseArn],
      }),
    );

    // bedrock:RetrieveAndGenerate (the actual KB call path in
    // knowledge-base/query.ts) is a RESOURCE-INDEPENDENT action — IAM denies
    // it whenever a specific resource ARN is attached, so it MUST be granted
    // on Resource:'*'. This was verified with `aws iam simulate-custom-policy`:
    // scoping it to the KB ARN returned implicitDeny, which would have 403'd
    // every RAG call in production. The model/data-source access RAG performs
    // internally is authorized by this action itself, not by the caller's
    // other statements. This is the one Bedrock action we cannot blast-radius
    // scope; the InvokeModel + Retrieve scoping above still bounds the rest.
    chatbotRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:RetrieveAndGenerate"],
        resources: ["*"],
      }),
    );

    // S3 permissions
    chatbotRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
        resources: [docBucketArn, `${docBucketArn}/*`],
      }),
    );

    // Shared bundling config — only externalize @aws-sdk/* (provided by the
    // Lambda runtime). Everything else (Express, serverless-express, pdfkit,
    // etc.) must be bundled into the deployment artifact.
    //
    // commandHooks copies the `data/` directory (decision trees + fact
    // definitions) next to the bundled handler so the runtime path
    // `__dirname/../data/...` used by data-loaders/* resolves at runtime.
    // esbuild collapses src/handlers/foo.ts -> outputDir/index.mjs, so the
    // data dir lands at outputDir/../data — exactly what the loader expects.
    const bundlingDefaults = {
      format: OutputFormat.ESM,
      mainFields: ["module", "main"],
      sourceMap: true,
      externalModules: ["@aws-sdk/*"],
      commandHooks: {
        beforeBundling(_inputDir: string, _outputDir: string): string[] {
          return [];
        },
        beforeInstall(_inputDir: string, _outputDir: string): string[] {
          return [];
        },
        afterBundling(inputDir: string, outputDir: string): string[] {
          // Copy services/chatbot/src/data alongside the bundled index.mjs.
          // The data-loaders look for `data/` next to the handler when the
          // tsx-dev `../data` layout isn't found (see resolveDataFile in
          // services/chatbot/src/data-loaders/*.ts).
          //
          // ALSO copy pdfkit's built-in font metric (.afm) files into the
          // same data/ directory. Bundled pdfkit reads them via
          // `fs.readFileSync(__dirname + '/data/<font>.afm')`; in Lambda
          // __dirname is /var/task, so the files must land at
          // /var/task/data/*.afm. Without this the transcript-pdf endpoint
          // throws ENOENT on Helvetica.afm.
          //
          // inputDir is the depsLockFile dir — for our infra/cdk.json that
          // resolves to `infra/`, so step up one level to the chatbot root.
          const src = join(inputDir, "..", "services", "chatbot", "src", "data");
          const pdfkitData = join(inputDir, "..", "node_modules", "pdfkit", "js", "data");
          const dest = join(outputDir, "data");
          return [
            `mkdir -p "${dest}" && cp -r "${src}/." "${dest}/" && cp "${pdfkitData}"/*.afm "${dest}/" && cp "${pdfkitData}"/*.icc "${dest}/" 2>/dev/null || true`,
          ];
        },
      },
    };

    // --- Single Express-in-Lambda function (catch-all for /chatbot/* + /api/*) ---
    // Wraps services/chatbot/src/local-server-app.ts via @codegenie/serverless-express.
    // All 25 routes deploy as ONE Lambda fronted by a single API Gateway
    // {proxy+} ANY integration. Per-route Lambdas are a future optimization.

    const expressLambda = new NodejsFunction(this, "ExpressLambdaFn", {
      functionName: "st-lucie-chatbot-express-app",
      entry: join(CHATBOT_SRC, "handlers", "express-app.handler.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      role: chatbotRole,
      // process-message.ts runs Bedrock tool-use loops that can take >60s.
      timeout: cdk.Duration.seconds(120),
      // 1.5GB makes cold-starts ~30% faster. Cold-start is the difference
      // between a 25s and a 32s turn under burst load — directly tied to
      // the 504-cascade we saw in the deployed-suite test.
      memorySize: 1536,
      environment: lambdaEnv,
      // CJS format — @codegenie/serverless-express has CJS-only internals
      // (require('util')). The local-server-app + data-loaders were patched
      // to use a runtime-safe __dirname helper that works in both bundling
      // formats (services/chatbot/src/util/dirname.ts). Net: bundle as CJS,
      // get a working Express-in-Lambda.
      bundling: {
        ...bundlingDefaults,
        format: OutputFormat.CJS,
        mainFields: ["main", "module"],
      },
    });

    // --- API Gateway ---

    const api = new apigateway.RestApi(this, "ChatbotApi", {
      restApiName: "St. Lucie Chatbot API",
      description: "Chatbot Service API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        // x-api-key is required because every method has apiKeyRequired:true.
        // Without it in the CORS preflight, browsers block the actual request.
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "x-api-key",
          "X-Api-Key",
          "x-test-session",
          "X-Test-Session",
        ],
      },
      // Pass these content types through as raw bytes (base64 over the
      // Lambda integration boundary, then decoded by API Gateway). Without
      // this, application/pdf bodies get UTF-8-decoded and the file is
      // corrupted — every non-UTF-8 byte becomes the replacement char (EF
      // BF BD), so the transcript download arrived as blank pages.
      binaryMediaTypes: ["application/pdf", "application/octet-stream"],
      deployOptions: {
        stageName: "api",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // Catch-all {proxy+} integration — every request is forwarded to the
    // Express-in-Lambda function which dispatches via its own router. This is
    // intentionally simple; the previous per-route wiring is preserved in
    // git history if we want to split routes back out later.
    //
    // apiKeyRequired:true gates every request behind the beta API key
    // provisioned by SecurityStack via UsagePlan + ApiKey. Local dev (Express
    // directly on :3000) is unaffected because that path doesn't touch API
    // Gateway. CORS preflight (OPTIONS) is auto-exempted by API Gateway and
    // does not require the key.
    //
    // Account-level API Gateway integration timeout cap is 29s without a
    // service-quota increase. Most bot turns finish in 2-15s; the rare
    // 25s+ tool-loop is what hits this ceiling. The Express Lambda has
    // a 120s timeout so it can finish processing even after API GW gives
    // up — that completed work shows up on the next session-state poll.
    // For real fix: request quota increase to 60s OR convert long turns
    // to async via SQS + WebSocket.
    const proxyIntegration = new apigateway.LambdaIntegration(expressLambda, {
      timeout: cdk.Duration.seconds(29),
    });
    const proxy = api.root.addResource("{proxy+}");
    proxy.addMethod("ANY", proxyIntegration, { apiKeyRequired: true });
    api.root.addMethod("ANY", proxyIntegration, { apiKeyRequired: true });

    // --- Outputs ---

    new cdk.CfnOutput(this, "ApiUrl", {
      value: api.url,
      description: "API Gateway URL",
    });

    new ssm.StringParameter(this, "ApiUrlParam", {
      parameterName: "/stlucie/api-gateway-url",
      stringValue: api.url,
    });

    // SSM params for cross-stack reference by SecurityStack — the
    // UsagePlan needs the api stage and the api id to attach itself.
    new ssm.StringParameter(this, "RestApiIdParam", {
      parameterName: "/stlucie/api-gateway-rest-api-id",
      stringValue: api.restApiId,
    });
    new ssm.StringParameter(this, "RootResourceIdParam", {
      parameterName: "/stlucie/api-gateway-root-resource-id",
      stringValue: api.restApiRootResourceId,
    });
  }
}
