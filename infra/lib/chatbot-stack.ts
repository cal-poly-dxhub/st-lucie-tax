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

export interface ChatbotStackProps extends StackProps {
  vpc: ec2.Vpc;
  proxy: rds.DatabaseProxy;
  dbSecret: rds.DatabaseSecret;
  lambdaSg: ec2.SecurityGroup;
  officeApiUrl: string;
  webAclArn: string;
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
        BEDROCK_KB_ID: process.env.BEDROCK_KB_ID || "",
        AWS_ACCOUNT_ID: this.account,
        BETA_PASSWORD: process.env.BETA_PASSWORD || "",
        BETA_AUTH_SECRET: process.env.BETA_AUTH_SECRET || "",
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
            return [
              `cp -r ${inputDir}/services/chatbot/data ${outputDir}/data 2>/dev/null || true`,
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
          `arn:aws:bedrock:${this.region}::foundation-model/us.anthropic.claude-sonnet-4-*`,
        ],
      }),
    );
    chatbotFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock:Retrieve", "bedrock:RetrieveAndGenerate"],
        resources: ["*"],
      }),
    );
    chatbotFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["ses:SendEmail"],
        resources: [`arn:aws:ses:${this.region}:${this.account}:identity/*`],
      }),
    );

    // ── API: Chatbot REST API ────────────────────────────────────────────────
    const chatbotApi = new apigateway.RestApi(this, "ChatbotApi", {
      restApiName: "st-lucie-chatbot",
      binaryMediaTypes: ["application/pdf", "application/octet-stream"],
      deployOptions: {
        stageName: "api",
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    chatbotApi.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(chatbotFn),
      anyMethod: true,
      defaultMethodOptions: { apiKeyRequired: true },
    });

    const chatbotApiKey = chatbotApi.addApiKey("ChatbotApiKey");
    const chatbotUsagePlan = chatbotApi.addUsagePlan("ChatbotUsagePlan", {
      throttle: { rateLimit: 50, burstLimit: 100 },
      quota: { limit: 10000, period: apigateway.Period.DAY },
    });
    chatbotUsagePlan.addApiKey(chatbotApiKey);
    chatbotUsagePlan.addApiStage({ stage: chatbotApi.deploymentStage });

    // ── API: Admin REST API ──────────────────────────────────────────────────
    const adminApi = new apigateway.RestApi(this, "AdminApi", {
      restApiName: "st-lucie-admin",
      deployOptions: {
        stageName: "admin",
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    adminApi.root.addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(adminFn),
      anyMethod: true,
      defaultMethodOptions: { apiKeyRequired: true },
    });

    const adminApiKey = adminApi.addApiKey("AdminApiKey");
    const adminUsagePlan = adminApi.addUsagePlan("AdminUsagePlan", {
      throttle: { rateLimit: 50, burstLimit: 100 },
      quota: { limit: 10000, period: apigateway.Period.DAY },
    });
    adminUsagePlan.addApiKey(adminApiKey);
    adminUsagePlan.addApiStage({ stage: adminApi.deploymentStage });

    // ── CloudFront: single distribution for all SPAs + APIs ─────────────────
    const officeApiOrigin = new origins.HttpOrigin(props.officeApiUrl.replace("https://", ""));
    const chatbotApiOrigin = new origins.RestApiOrigin(chatbotApi);
    const adminApiOrigin = new origins.RestApiOrigin(adminApi);

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

    // CORS for chatbot doc upload bucket (presigned upload PUTs from the browser)
    const cfnDocBucket = docBucket.node.defaultChild as s3.CfnBucket;
    cfnDocBucket.addPropertyOverride("CorsConfiguration", {
      CorsRules: [
        {
          AllowedMethods: ["PUT", "GET"],
          AllowedOrigins: [
            `https://${distribution.distributionDomainName}`,
            "http://localhost:3000",
            "http://localhost:5173",
          ],
          AllowedHeaders: ["*"],
        },
      ],
    });

    // ── SPA Deployment: all three frontends ──────────────────────────────────
    new s3deploy.BucketDeployment(this, "OfficeFrontendDeploy", {
      sources: [s3deploy.Source.asset(path.join(repoRoot, "frontend", "dist"))],
      destinationBucket: frontendBucket,
      destinationKeyPrefix: "",
      distribution,
      distributionPaths: ["/*"],
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
    new CfnOutput(this, "ChatbotApiUrl", {
      value: chatbotApi.url,
    });
    new CfnOutput(this, "ChatbotApiKeyId", {
      value: chatbotApiKey.keyId,
    });
    new CfnOutput(this, "AdminApiUrl", {
      value: adminApi.url,
    });
    new CfnOutput(this, "AdminApiKeyId", {
      value: adminApiKey.keyId,
    });
    new CfnOutput(this, "DocBucketName", {
      value: docBucket.bucketName,
    });
    new CfnOutput(this, "KbDataBucketName", {
      value: kbDataBucket.bucketName,
    });
  }
}
