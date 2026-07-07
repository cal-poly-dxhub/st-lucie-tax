import * as path from "node:path";
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
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as iam from "aws-cdk-lib/aws-iam";
import * as sns from "aws-cdk-lib/aws-sns";
import * as sns_subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cw_actions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as bedrock from "aws-cdk-lib/aws-bedrock";
import * as cr from "aws-cdk-lib/custom-resources";

export interface ChatbotStackProps extends StackProps {
  vpc: ec2.Vpc;
  proxy: rds.DatabaseProxy;
  dbSecret: rds.DatabaseSecret;
  lambdaSg: ec2.SecurityGroup;
  officeApiUrl: string;
  webAclArn: string;
  userPoolId: string;
  userPoolClientId: string;
}

export class ChatbotStack extends Stack {
  public readonly distribution: cloudfront.Distribution;

  constructor(scope: Construct, id: string, props: ChatbotStackProps) {
    super(scope, id, props);
    const { vpc, proxy, dbSecret, lambdaSg } = props;
    const repoRoot = path.join(__dirname, "..", "..");

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
              actions: ["s3vectors:*"],
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
        BEDROCK_MODEL_ID: "us.anthropic.claude-sonnet-4-20250514-v1:0",
        BEDROCK_KB_ID: knowledgeBase.attrKnowledgeBaseId,
        AWS_ACCOUNT_ID: this.account,
        COGNITO_USER_POOL_ID: props.userPoolId,
        COGNITO_CLIENT_ID: props.userPoolClientId,
        AUTHID_BASE_URL: process.env.AUTHID_BASE_URL || "https://id-uat.authid.ai",
        AUTHID_API_KEY_ID: process.env.AUTHID_API_KEY_ID || "",
        AUTHID_API_KEY_VALUE: process.env.AUTHID_API_KEY_VALUE || "",
        AUTHID_DL_DOC_TYPE_CODE: process.env.AUTHID_DL_DOC_TYPE_CODE || "5",
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
            return [`cp -r ${inputDir}/services/chatbot/src/data ${outputDir}/data`];
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
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "",
        ADMIN_AUTH_SECRET: process.env.ADMIN_AUTH_SECRET || "",
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

    chatbotFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        resources: [
          "arn:aws:bedrock:*::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0`,
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
        actions: ["ses:SendEmail"],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
      }),
    );

    // ── Origin secret: CloudFront-only access ──────────────────────────────
    // A shared secret header injected by CloudFront and validated by the
    // Lambdas. Prevents direct API Gateway URL access (bypassing WAF).
    const originSecret = process.env.ORIGIN_SECRET || "stlucie-cf-origin-2026";

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

    const distribution = (this.distribution = new cloudfront.Distribution(this, "FrontendDist", {
      defaultRootObject: "index.html",
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
    cfnDocBucket.addPropertyOverride("CorsConfiguration", {
      CorsRules: [
        {
          AllowedMethods: ["PUT", "GET"],
          AllowedOrigins: [
            "https://*.cloudfront.net",
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
      value: `https://${distribution.distributionDomainName}`,
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
