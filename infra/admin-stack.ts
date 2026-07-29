/**
 * Admin Dashboard Stack — read-only admin surface.
 *
 * Creates:
 *  - Admin Express Lambda (mirror of chatbot Lambda; CJS bundle for
 *    serverless-express + commandHook to copy pdfkit data + chatbot's data
 *    folder so the read-only admin can decode any session row that
 *    transitively references those files).
 *  - Admin API Gateway with its own apiKeyRequired methods + UsagePlan +
 *    ApiKey for cost protection.
 *  - Admin S3 bucket + CloudFront distribution for the React SPA.
 *
 * Reads /stlucie/dynamodb-table-name from SSM.
 *
 * Auth: HMAC bearer tokens issued by /admin/auth/login, gated by
 * ADMIN_PASSWORD + ADMIN_AUTH_SECRET env vars at deploy time. Defaults to
 * BETA_PASSWORD/BETA_AUTH_SECRET so a single set of creds protects both
 * the chatbot and the admin dashboard during the closed beta.
 *
 * NOTE: this stack is fully isolated from the existing four — it never
 * writes to SSM paths the others read, never imports them. Safe to deploy
 * alongside in-flight chatbot work.
 */

import * as cdk from "aws-cdk-lib";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { NodejsFunction, OutputFormat } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_SRC = join(__dirname, "..", "services", "admin", "src");

export class AdminStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const tableName = ssm.StringParameter.valueForStringParameter(
      this,
      "/stlucie/dynamodb-table-name",
    );
    const tableArn = ssm.StringParameter.valueForStringParameter(
      this,
      "/stlucie/dynamodb-table-arn",
    );

    // SEC-02: admin auth secrets (ADMIN_PASSWORD, ADMIN_AUTH_SECRET) live in
    // AWS Secrets Manager, fetched at cold start (services/admin/src/auth/
    // load-secrets.ts) via SECRETS_ARN below — never injected as plaintext env.
    //
    // Separate secret from the chatbot's so the admin role never gains read
    // access to the chatbot's AuthID keys. The historical "default to BETA
    // creds for the closed beta" behavior is resolved at POPULATE time: if there
    // are no dedicated admin creds, write the BETA values into this secret:
    //   aws secretsmanager put-secret-value --secret-id stlucie/admin/app-secrets \
    //     --secret-string '{"ADMIN_PASSWORD":"...","ADMIN_AUTH_SECRET":"..."}'
    // Created with a random placeholder so no real secret lands in cdk.out.
    const adminSecrets = new secretsmanager.Secret(this, "AdminAppSecrets", {
      secretName: "stlucie/admin/app-secrets",
      description:
        "SEC-02: ADMIN_PASSWORD + ADMIN_AUTH_SECRET, fetched at Lambda cold start. " +
        "Populate real values via put-secret-value; never set from CDK.",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ ADMIN_PASSWORD: "", ADMIN_AUTH_SECRET: "" }),
        generateStringKey: "placeholder",
      },
    });

    const lambdaEnv = {
      DYNAMODB_TABLE_NAME: tableName,
      TENANT_ID: "stlucie",
      NODE_OPTIONS: "--enable-source-maps",
      // SEC-02: secrets fetched at cold start from this ARN (not sensitive).
      SECRETS_ARN: adminSecrets.secretArn,
    };

    const adminRole = new iam.Role(this, "AdminLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    });

    // SEC-02: scoped GetSecretValue on ONLY the admin secret.
    adminSecrets.grantRead(adminRole);

    // Mostly read-only DynamoDB — defensive: a bug in the admin route
    // shouldn't be able to corrupt session data.
    adminRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
        resources: [tableArn, `${tableArn}/index/*`],
      }),
    );

    // The one write the admin makes: the "reviewed" triage flag. UpdateItem
    // only (no PutItem/DeleteItem), only on the base table (not indexes). The
    // application-layer write (set-reviewed.ts) is further constrained to a
    // single attribute on the METADATA row with an attribute_exists condition,
    // so it can't create rows or touch session content.
    adminRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["dynamodb:UpdateItem"],
        resources: [tableArn],
      }),
    );

    const adminLambda = new NodejsFunction(this, "AdminLambdaFn", {
      functionName: "st-lucie-admin-app",
      entry: join(ADMIN_SRC, "handlers", "express-app.handler.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
      role: adminRole,
      timeout: cdk.Duration.seconds(30),
      // 512MB is plenty — admin queries are I/O bound on Dynamo, no Bedrock.
      memorySize: 512,
      environment: lambdaEnv,
      // Same CJS bundling as the chatbot — serverless-express has CJS-only
      // internals that ESM bundling fails on.
      bundling: {
        format: OutputFormat.CJS,
        mainFields: ["main", "module"],
        sourceMap: true,
        externalModules: ["@aws-sdk/*"],
      },
    });

    const api = new apigateway.RestApi(this, "AdminApi", {
      restApiName: "St. Lucie Admin API",
      description: "Read-only admin dashboard API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization", "x-api-key", "X-Api-Key"],
      },
      deployOptions: {
        stageName: "admin",
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
    });

    const proxyIntegration = new apigateway.LambdaIntegration(adminLambda, {
      timeout: cdk.Duration.seconds(29),
    });
    const proxy = api.root.addResource("{proxy+}");
    proxy.addMethod("ANY", proxyIntegration, { apiKeyRequired: true });
    api.root.addMethod("ANY", proxyIntegration, { apiKeyRequired: true });

    // Independent API key (separate from beta key) so we can rotate or revoke
    // the admin surface without touching beta-tester traffic.
    const adminApiKey = new apigateway.ApiKey(this, "AdminApiKey", {
      apiKeyName: "stlucie-admin-key",
      description: "Admin dashboard API key",
    });

    new apigateway.UsagePlan(this, "AdminUsagePlan", {
      name: "stlucie-admin-usage",
      apiStages: [{ api, stage: api.deploymentStage }],
      throttle: { rateLimit: 50, burstLimit: 100 },
      quota: { limit: 10_000, period: apigateway.Period.DAY },
    }).addApiKey(adminApiKey);

    // --- Frontend hosting ---

    const adminBucket = new s3.Bucket(this, "AdminAppBucket", {
      bucketName: `st-lucie-admin-app-${this.account}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, "AdminOAI");
    adminBucket.grantRead(oai);

    const distribution = new cloudfront.Distribution(this, "AdminDistribution", {
      defaultBehavior: {
        origin: new origins.S3Origin(adminBucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: "index.html",
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: "/index.html",
          ttl: cdk.Duration.minutes(5),
        },
      ],
    });

    new s3deploy.BucketDeployment(this, "AdminAppDeployment", {
      sources: [s3deploy.Source.asset(join(__dirname, "..", "apps", "admin-app", "dist"))],
      destinationBucket: adminBucket,
      distribution,
      distributionPaths: ["/*"],
    });

    // --- Outputs ---

    new cdk.CfnOutput(this, "AdminApiUrl", {
      value: api.url,
      description: "Admin API Gateway URL",
    });

    new cdk.CfnOutput(this, "AdminAppUrl", {
      value: `https://${distribution.distributionDomainName}`,
      description: "Admin SPA URL",
    });

    new cdk.CfnOutput(this, "AdminApiKeyId", {
      value: adminApiKey.keyId,
      description:
        "Admin API key ID — fetch value with `aws apigateway get-api-key --include-value`",
    });

    new ssm.StringParameter(this, "AdminApiUrlParam", {
      parameterName: "/stlucie/admin-api-url",
      stringValue: api.url,
    });
    new ssm.StringParameter(this, "AdminAppUrlParam", {
      parameterName: "/stlucie/admin-app-url",
      stringValue: `https://${distribution.distributionDomainName}`,
    });
    new ssm.StringParameter(this, "AdminApiKeyIdParam", {
      parameterName: "/stlucie/admin-api-key-id",
      stringValue: adminApiKey.keyId,
    });
  }
}
