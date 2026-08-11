import * as path from "node:path";
import * as fs from "node:fs";
import { Construct } from "constructs";
import { Stack, StackProps, Duration, CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as cr from "aws-cdk-lib/custom-resources";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required for CDK synthesis`);
  }
  return value;
}

export interface ChatbotStackProps extends StackProps {
  vpc: ec2.Vpc;
  proxy: rds.DatabaseProxy;
  dbSecret: rds.DatabaseSecret;
  lambdaSg: ec2.SecurityGroup;
  officeApiUrl: string;
  /**
   * Physical name of the office-ops documents bucket (BackOffice
   * `DocumentsBucket`). Passed as a plain string — NOT a cross-stack Bucket
   * reference — so the chatbot's read/write grant stays inside ChatbotStack and
   * deploys with `cdk deploy Chatbot` alone (no BackOffice/Docker rebuild). The
   * chatbot doc-bridge copies validated uploads into this bucket via the
   * office-ops uploadDocument() writer. Safe because the bucket is S3_MANAGED
   * (AES256) — an identity grant suffices, no KMS key grant needed.
   */
  documentsBucketName: string;
  webAclArn: string;
  userPoolId: string;
  userPoolClientId: string;
  customDomainName?: string;
  customDomainCertificateArn?: string;
}

export class ChatbotStack extends Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: ChatbotStackProps) {
    super(scope, id, props);
    const { vpc, proxy, dbSecret, lambdaSg } = props;
    const repoRoot = path.join(__dirname, "..", "..");

    // The three SPA BucketDeployments below package each app's dist/ directory,
    // which is gitignored and built separately. On a fresh clone those dirs do
    // not exist and s3deploy.Source.asset throws a cryptic "Cannot find asset"
    // at synth. Fail early with the exact fix instead.
    const spaDists = [
      path.join(repoRoot, "frontend", "dist"),
      path.join(repoRoot, "apps", "chatbot-app", "dist"),
      path.join(repoRoot, "apps", "admin-app", "dist"),
    ];
    const missingDists = spaDists.filter((d) => !fs.existsSync(path.join(d, "index.html")));
    if (missingDists.length > 0) {
      throw new Error(
        `Frontend build output missing before synth:\n  ${missingDists.join("\n  ")}\n` +
          `Build the SPAs first: \`npm run build:frontends\` (from the repo root), then re-run cdk.`,
      );
    }

    // ── Frontend bucket (shared across all SPAs) ─────────────────────────────
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Data: S3 buckets ─────────────────────────────────────────────────────
    const docBucket = new s3.Bucket(this, "DocUploadBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      lifecycleRules: [{ prefix: "uploads/", expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const kbDataBucket = new s3.Bucket(this, "KbDataBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Knowledge Base: Bedrock KB with S3 Vectors ──────────────────────────
    // S3 Vectors is a separate service (namespace: s3vectors). No CFN resources
    // exist for vector buckets/indexes, so we create them via Custom Resources.
    // The KB itself is also created via SDK because CFN's S3VectorsConfiguration
    // schema is unreliable — the reference implementation uses the Bedrock SDK.
    const kbVectorBucketName = "st-lucie-tax-vectors";
    const kbIndexName = "st-lucie-tax-index";
    const indexArn = `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}/index/${kbIndexName}`;

    const vectorBucket = new cr.AwsCustomResource(this, "VectorBucket", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "S3Vectors",
        action: "createVectorBucket",
        parameters: { vectorBucketName: kbVectorBucketName },
        physicalResourceId: cr.PhysicalResourceId.of(kbVectorBucketName),
      },
      onDelete: {
        service: "S3Vectors",
        action: "deleteVectorBucket",
        parameters: { vectorBucketName: kbVectorBucketName },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["s3vectors:CreateVectorBucket", "s3vectors:DeleteVectorBucket"],
          resources: ["*"],
        }),
      ]),
    });

    // Titan Embed Text v2 produces 1024-dimension vectors.
    const vectorIndex = new cr.AwsCustomResource(this, "VectorIndex", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "S3Vectors",
        action: "createIndex",
        parameters: {
          vectorBucketName: kbVectorBucketName,
          indexName: kbIndexName,
          dataType: "float32",
          dimension: 1024,
          distanceMetric: "cosine",
          metadataConfiguration: {
            nonFilterableMetadataKeys: ["AMAZON_BEDROCK_TEXT", "AMAZON_BEDROCK_METADATA"],
          },
        },
        physicalResourceId: cr.PhysicalResourceId.of(kbIndexName),
      },
      onDelete: {
        service: "S3Vectors",
        action: "deleteIndex",
        parameters: {
          vectorBucketName: kbVectorBucketName,
          indexName: kbIndexName,
        },
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["s3vectors:CreateIndex", "s3vectors:DeleteIndex"],
          resources: ["*"],
        }),
      ]),
    });
    vectorIndex.node.addDependency(vectorBucket);

    const kbRole = new iam.Role(this, "KbRole", {
      assumedBy: new iam.ServicePrincipal("bedrock.amazonaws.com"),
      inlinePolicies: {
        BedrockKb: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: ["bedrock:InvokeModel"],
              resources: [
                `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
              ],
            }),
            new iam.PolicyStatement({
              actions: ["s3:GetObject", "s3:ListBucket"],
              resources: [kbDataBucket.bucketArn, `${kbDataBucket.bucketArn}/*`],
            }),
            new iam.PolicyStatement({
              actions: [
                "s3vectors:GetVectors",
                "s3vectors:PutVectors",
                "s3vectors:QueryVectors",
                "s3vectors:DeleteVectors",
                "s3vectors:ListVectors",
                "s3vectors:GetIndex",
              ],
              resources: [
                `arn:aws:s3vectors:${this.region}:${this.account}:bucket/${kbVectorBucketName}*`,
              ],
            }),
          ],
        }),
      },
    });

    const knowledgeBase = new bedrock.CfnKnowledgeBase(this, "KnowledgeBase", {
      name: "st-lucie-tax-kb",
      description: "St. Lucie County Tax Collector content from tcslc.com, FLHSMV, FDACS, and FWC",
      roleArn: kbRole.roleArn,
      knowledgeBaseConfiguration: {
        type: "VECTOR",
        vectorKnowledgeBaseConfiguration: {
          embeddingModelArn: `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-embed-text-v2:0`,
        },
      },
      storageConfiguration: {
        type: "S3_VECTORS",
        s3VectorsConfiguration: {
          indexArn,
        },
      },
    });
    knowledgeBase.node.addDependency(vectorIndex);

    new bedrock.CfnDataSource(this, "KbDataSource", {
      name: "tcslc-documents",
      knowledgeBaseId: knowledgeBase.attrKnowledgeBaseId,
      dataSourceConfiguration: {
        type: "S3",
        s3Configuration: {
          bucketArn: kbDataBucket.bucketArn,
        },
      },
    });

    // ── Compute: Chatbot Lambda ──────────────────────────────────────────────
    const vpcSubnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    const chatbotFn = new lambdaNode.NodejsFunction(this, "ChatbotFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(repoRoot, "services/chatbot/src/handlers/express-app.handler.ts"),
      handler: "handler",
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, "package-lock.json"),
      vpc,
      vpcSubnets,
      securityGroups: [lambdaSg],
      memorySize: 1536,
      timeout: Duration.seconds(120),
      logGroup: new logs.LogGroup(this, "ChatbotFnLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        PGHOST: proxy.endpoint,
        PGPORT: "5432",
        PGUSER: "stlucie",
        PGDATABASE: "stlucie",
        PGPASSWORD_SECRET_ARN: dbSecret.secretArn,
        PGSSL: "true",
        DOC_BUCKET: docBucket.bucketName,
        // Office-ops documents bucket — the doc-bridge (scheduling/
        // bridge-documents.ts) copies validated chatbot uploads here so the
        // clerk view can presign them. Plain string (see props doc).
        DOCUMENTS_BUCKET: props.documentsBucketName,
        // Sonnet 4.6 (cross-region inference profile). Chosen over Sonnet 4.0
        // for the 30× tokens-per-minute quota headroom (6M vs 200k) that ends
        // the throttle-driven 504s, and over Sonnet 5 to avoid a large
        // behavioral delta before the partner handoff (4.6 keeps the same
        // tokenizer and accepts `temperature`, so no inference-config change).
        // The 4.0 ARNs stay in the IAM grant below for instant rollback.
        BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-4-6",
        // Cheap vision model for the document-upload pass/reject screen
        // (upload/validate-document.ts). Runs in its OWN region: Haiku 4.5
        // model access is enabled in us-east-2, NOT us-east-1, in this account.
        BEDROCK_VISION_MODEL_ID:
          process.env.BEDROCK_VISION_MODEL_ID || "us.anthropic.claude-haiku-4-5-20251001-v1:0",
        BEDROCK_VISION_REGION: process.env.BEDROCK_VISION_REGION || "us-east-2",
        // Doc-screen tuning (upload/validate-document.ts). REJECT_THRESHOLD: min
        // model confidence for a plausibility reject to block. EXPIRY_ENABLED:
        // kill-switch for date-based (expiry/recency) rejection.
        DOC_VALIDATION_REJECT_THRESHOLD: "0.85",
        DOC_VALIDATION_EXPIRY_ENABLED: "true",
        BEDROCK_KB_ID: knowledgeBase.attrKnowledgeBaseId,
        AWS_ACCOUNT_ID: this.account,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        AUTHID_BASE_URL: process.env.AUTHID_BASE_URL || "https://id-uat.authid.ai",
        AUTHID_API_KEY_ID: process.env.AUTHID_API_KEY_ID || "",
        AUTHID_API_KEY_VALUE: process.env.AUTHID_API_KEY_VALUE || "",
        // AuthID doc-type code selects which credential the Proof portal scans;
        // per-tenant (verified against GET /v1/idDocumentTypes): 2 = "US Driver's
        // License", 5 = "Passport". Default to 2 so an unset env var fails toward
        // a DL scan, never passport — a "5" default previously left the portal
        // stuck in passport mode. Re-verify against the prod tenant's list if the
        // tenant changes.
        AUTHID_DL_DOC_TYPE_CODE: process.env.AUTHID_DL_DOC_TYPE_CODE || "2",
        // How the identity-proof classifier treats a REQUIRED signal that AuthID
        // did not return. Our tenant's verification policy doesn't emit the
        // tamper signals (SelfieInjection/Barcode/PAD/DocumentInjection) for any
        // scan, so "reject" (fail-closed) rejected 100% of honest users. "ignore"
        // judges the scan only on signals actually present (Matched, liveness,
        // expiry) — an EXPLICIT FAIL still rejects. Tighten to "reject" only
        // against a tenant that genuinely emits every tamper signal.
        AUTHID_MISSING_SIGNAL_OUTCOME: process.env.AUTHID_MISSING_SIGNAL_OUTCOME || "ignore",
        EMAIL: process.env.SENDER_EMAIL || "noreply@stlucie.local",
      },
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: "node22",
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
          beforeInstall(_inputDir: string, _outputDir: string): string[] {
            return [];
          },
          afterBundling(inputDir: string, outputDir: string): string[] {
            // No `|| true` here on purpose: if this copy ever fails (wrong
            // path, missing dir), bundling should fail loudly at synth/deploy
            // time rather than shipping a Lambda that 500s on every request
            // once `resolveDataDir()` throws at module init.
            return [
              `cp -r ${inputDir}/services/chatbot/src/data ${outputDir}/data`,
              // pdfkit reads AFM font metrics and the ICC profile via
              // `fs.readFileSync(__dirname + '/data/...')`. esbuild's CJS
              // output preserves __dirname as the bundle's directory, so these
              // files must live at ${outputDir}/data alongside the chatbot
              // data files copied above.
              `cp ${inputDir}/node_modules/pdfkit/js/data/*.afm ${outputDir}/data/`,
              `cp ${inputDir}/node_modules/pdfkit/js/data/*.icc ${outputDir}/data/`,
            ];
          },
        },
      },
    });

    // ── Compute: Admin Lambda ────────────────────────────────────────────────
    const adminFn = new lambdaNode.NodejsFunction(this, "AdminFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(repoRoot, "services/admin/src/handlers/express-app.handler.ts"),
      handler: "handler",
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, "package-lock.json"),
      vpc,
      vpcSubnets,
      securityGroups: [lambdaSg],
      memorySize: 512,
      timeout: Duration.seconds(30),
      logGroup: new logs.LogGroup(this, "AdminFnLogs", {
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      environment: {
        PGHOST: proxy.endpoint,
        PGPORT: "5432",
        PGUSER: "stlucie",
        PGDATABASE: "stlucie",
        PGPASSWORD_SECRET_ARN: dbSecret.secretArn,
        PGSSL: "true",
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
      },
      bundling: {
        format: lambdaNode.OutputFormat.CJS,
        target: "node22",
      },
    });

    // ── Grants ───────────────────────────────────────────────────────────────
    proxy.grantConnect(chatbotFn, "stlucie");
    proxy.grantConnect(adminFn, "stlucie");
    dbSecret.grantRead(chatbotFn);
    dbSecret.grantRead(adminFn);
    docBucket.grantReadWrite(chatbotFn);

    // Office-ops documents bucket — imported by NAME (not a cross-stack Bucket
    // ref) so this grant is a plain identity-policy statement on the ChatbotFn
    // role, entirely within ChatbotStack: deployable with `cdk deploy Chatbot`,
    // no BackOffice export/Docker rebuild. Read+Write because the doc-bridge
    // reads the chatbot upload and PUTs the copy into this bucket. Sufficient
    // without a KMS grant because the bucket is S3_MANAGED (AES256).
    const documentsBucket = s3.Bucket.fromBucketName(
      this,
      "OfficeDocumentsBucketImport",
      props.documentsBucketName,
    );
    documentsBucket.grantReadWrite(chatbotFn);

    chatbotFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          // Sonnet 4.6 — the active conversation + KB-RetrieveAndGenerate model
          // (BEDROCK_MODEL_ID). Cross-region profile fans out to us-east-1/2/
          // west-2, so the foundation-model ARN is region-wildcarded and the
          // inference-profile ARN is version-wildcarded.
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-6*`,
          // Sonnet 4.0 — retained for instant rollback (flip BEDROCK_MODEL_ID
          // back and redeploy without an IAM change).
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0`,
          // Haiku 4.5 vision model for the document-upload screen
          // (BEDROCK_VISION_MODEL_ID). It is invoked in us-east-2 via a
          // cross-region inference profile, so the foundation-model region is
          // wildcarded and the inference-profile ARN is version-wildcarded.
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*",
          `arn:aws:bedrock:*:${this.account}:inference-profile/us.anthropic.claude-haiku-4-5-*`,
        ],
      }),
    );
    chatbotFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
        resources: [knowledgeBase.attrKnowledgeBaseArn],
      }),
    );
    chatbotFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail", "ses:CreateEmailIdentity", "ses:GetEmailIdentity"],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
      }),
    );

    // ── Origin secret: CloudFront-only access ──────────────────────────────
    // A shared secret header injected by CloudFront and validated by the
    // Lambdas. Prevents direct API Gateway URL access (bypassing WAF).
    // Must be supplied explicitly — a hardcoded fallback here would let
    // anyone bypass CloudFront/WAF using a value visible in source control.
    const originSecret = requireEnv("ORIGIN_SECRET");

    chatbotFn.addEnvironment("ORIGIN_SECRET", originSecret);
    adminFn.addEnvironment("ORIGIN_SECRET", originSecret);

    // ── API: Chatbot REST API ────────────────────────────────────────────────
    const chatbotApi = new apigateway.RestApi(this, "ChatbotApi", {
      restApiName: "st-lucie-chatbot",
      binaryMediaTypes: ["application/pdf", "application/octet-stream"],
      deployOptions: {
        stageName: "api",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    chatbotApi.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(chatbotFn),
      anyMethod: true,
    });

    // ── API: Admin REST API ──────────────────────────────────────────────────
    const adminApi = new apigateway.RestApi(this, "AdminApi", {
      restApiName: "st-lucie-admin",
      deployOptions: {
        stageName: "admin",
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
    });

    adminApi.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(adminFn),
      anyMethod: true,
    });

    // ── CloudFront: single distribution for all SPAs + APIs ─────────────────
    const officeApiOrigin = new origins.HttpOrigin(props.officeApiUrl.replace("https://", ""));
    const chatbotApiOrigin = new origins.RestApiOrigin(chatbotApi, {
      customHeaders: { "x-origin-secret": originSecret },
    });
    const adminApiOrigin = new origins.RestApiOrigin(adminApi, {
      customHeaders: { "x-origin-secret": originSecret },
    });

    const spaRewrite = new cloudfront.Function(this, "SpaRewrite", {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var req = event.request;
  var uri = req.uri;
  if (uri.includes('.')) return req;
  if (uri.startsWith('/chat')) { req.uri = '/chat/index.html'; return req; }
  if (uri.startsWith('/admin')) { req.uri = '/admin/index.html'; return req; }
  if (uri !== '/') req.uri = '/index.html';
  return req;
}
`),
    });

    const certificate = props.customDomainCertificateArn
      ? acm.Certificate.fromCertificateArn(
          this,
          "FrontendCertificate",
          props.customDomainCertificateArn,
        )
      : undefined;

    const distribution = (this.distribution = new cloudfront.Distribution(this, "FrontendDist", {
      defaultRootObject: "index.html",
      ...(props.customDomainName
        ? {
            domainNames: [props.customDomainName],
            certificate,
          }
        : {}),
      webAclId: props.webAclArn,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: spaRewrite,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      additionalBehaviors: {
        "/api/chat/*": {
          origin: chatbotApiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/api/admin/*": {
          origin: adminApiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
        "/api/*": {
          origin: officeApiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        },
      },
    }));

    // CORS for chatbot doc upload bucket (presigned upload PUTs from the browser).
    // Use a wildcard for CloudFront to avoid a circular dependency
    // (DocBucket → Distribution → ChatbotApi → ChatbotFn → DocBucket).
    const cfnDocBucket = docBucket.node.defaultChild as s3.CfnBucket;

    // ── BASE_URL for email links (queue-status, manage/reschedule) ───────────
    // Must be set after the distribution is created. Uses custom domain if
    // provided, otherwise the CloudFront distribution domain.
    const baseUrl = props.customDomainName
      ? `https://${props.customDomainName}`
      : `https://${distribution.distributionDomainName}`;
    chatbotFn.addEnvironment("BASE_URL", baseUrl);

    cfnDocBucket.addPropertyOverride("CorsConfiguration", {
      CorsRules: [
        {
          AllowedMethods: ["PUT", "GET"],
          AllowedOrigins: [
            "https://*.cloudfront.net",
            ...(props.customDomainName ? [`https://${props.customDomainName}`] : []),
            "http://localhost:3000",
            "http://localhost:5173",
          ],
          AllowedHeaders: ["*"],
        },
      ],
    });

    // ── SPA Deployment: all three frontends ──────────────────────────────────
    // prune: false on OfficeFrontendDeploy is critical: it shares the bucket
    // root prefix ("") with RuntimeConfig below. With pruning enabled (the
    // default), whichever of the two BucketDeployment custom resources runs
    // last (CFN runs them concurrently, order is not guaranteed) deletes any
    // file at that prefix it doesn't recognize as its own source — including
    // config.json, since OfficeFrontendDeploy's source is only frontend/dist.
    new s3deploy.BucketDeployment(this, "OfficeFrontendDeploy", {
      sources: [s3deploy.Source.asset(path.join(repoRoot, "frontend", "dist"))],
      destinationBucket: frontendBucket,
      destinationKeyPrefix: "",
      distribution,
      distributionPaths: ["/*"],
      prune: false,
    });

    new s3deploy.BucketDeployment(this, "ChatbotFrontendDeploy", {
      sources: [s3deploy.Source.asset(path.join(repoRoot, "apps", "chatbot-app", "dist"))],
      destinationBucket: frontendBucket,
      destinationKeyPrefix: "chat",
      distribution,
      distributionPaths: ["/chat/*"],
    });

    new s3deploy.BucketDeployment(this, "AdminFrontendDeploy", {
      sources: [s3deploy.Source.asset(path.join(repoRoot, "apps", "admin-app", "dist"))],
      destinationBucket: frontendBucket,
      destinationKeyPrefix: "admin",
      distribution,
      distributionPaths: ["/admin/*"],
    });

    // Runtime config — frontends fetch this on load instead of baking values at build time.
    // prune: false here too, for the same reason as OfficeFrontendDeploy above.
    new s3deploy.BucketDeployment(this, "RuntimeConfig", {
      sources: [
        s3deploy.Source.jsonData("config.json", {
          userPoolId: props.userPoolId,
          userPoolClientId: props.userPoolClientId,
          apiUrl: "/api",
          chatbotApiUrl: "/api/chat",
          adminApiUrl: "/api/admin",
        }),
      ],
      destinationBucket: frontendBucket,
      distribution,
      distributionPaths: ["/config.json"],
      prune: false,
    });

    // ── Monitoring ───────────────────────────────────────────────────────────
    const alarmEmail = process.env.ALARM_EMAIL || "";
    const alarmTopic = new sns.Topic(this, "AlarmTopic", {
      displayName: "St. Lucie Chatbot Alarms",
    });
    if (alarmEmail) {
      alarmTopic.addSubscription(new sns_subscriptions.EmailSubscription(alarmEmail));
    }

    const bedrockSpendAlarm = new cloudwatch.Alarm(this, "BedrockSpendWarn", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/Bedrock",
        metricName: "InvocationCount",
        statistic: "Sum",
        period: Duration.hours(24),
      }),
      threshold: 500,
      evaluationPeriods: 1,
      alarmDescription: "Bedrock invocation count > 500/day (spending alarm proxy)",
    });
    bedrockSpendAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    const chatbotErrorAlarm = new cloudwatch.Alarm(this, "ChatbotErrorAlarm", {
      metric: chatbotFn.metricErrors({ period: Duration.minutes(30) }),
      threshold: 20,
      evaluationPeriods: 1,
      alarmDescription: "ChatbotFn >20 errors in 30min",
    });
    chatbotErrorAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    const bedrockThrottleAlarm = new cloudwatch.Alarm(this, "BedrockThrottleAlarm", {
      metric: new cloudwatch.Metric({
        namespace: "AWS/Bedrock",
        metricName: "ThrottledCount",
        statistic: "Sum",
        period: Duration.minutes(30),
      }),
      threshold: 100,
      evaluationPeriods: 1,
      alarmDescription: "Bedrock >100 throttles in 30min",
    });
    bedrockThrottleAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // ── Outputs ──────────────────────────────────────────────────────────────
    new CfnOutput(this, "FrontendUrl", {
      value: `https://${props.customDomainName ?? distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "DistributionId", {
      value: distribution.distributionId,
    });
    new CfnOutput(this, "FrontendBucketName", {
      value: frontendBucket.bucketName,
    });
    new CfnOutput(this, "ChatbotApiUrl", {
      value: chatbotApi.url,
    });
    new CfnOutput(this, "AdminApiUrl", {
      value: adminApi.url,
    });
    new CfnOutput(this, "DocBucketName", {
      value: docBucket.bucketName,
    });
    new CfnOutput(this, "KbDataBucketName", {
      value: kbDataBucket.bucketName,
    });
  }
}
