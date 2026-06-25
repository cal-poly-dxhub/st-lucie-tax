import * as path from "node:path";
import { Construct } from "constructs";
import { Stack, StackProps, Duration, CfnOutput, CustomResource } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNode from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3assets from "aws-cdk-lib/aws-s3-assets";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2_integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cr from "aws-cdk-lib/custom-resources";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { EnvConfig, PG_ENGINE } from "./env-config";

export interface OfficeInfraStackProps extends StackProps {
  config: EnvConfig;
}

// One stack, two Lambdas. Holds the whole environment: network, data
// (RDS + Proxy + Secrets), auth (Cognito), compute (AppointmentFn + QueueFn
// behind separate HTTP APIs), async (SQS email worker + nightly
// duration-recommendation schedule), and the static frontends (S3 + CloudFront
// + WAF). The appointment and queue domains are deployed as independent
// functions with their own reserved concurrency so a failure in one cannot
// take down the other.
export class OfficeInfraStack extends Stack {
  constructor(scope: Construct, id: string, props: OfficeInfraStackProps) {
    super(scope, id, props);
    const { config } = props;
    const repoRoot = path.join(__dirname, "..", "..");

    // ── Network ──────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: config.maxAzs,
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    // Gateway endpoint for S3 keeps doc traffic off NAT.
    vpc.addGatewayEndpoint("S3Endpoint", { service: ec2.GatewayVpcEndpointAwsService.S3 });
    // Interface endpoints for the AWS APIs Lambdas call, avoiding NAT egress.
    // SES v2 SDK calls egress through NAT (no VPC endpoint available for the
    // SES API; the CDK SES constant is SMTP-only and not used by the SDK).
    for (const [name, svc] of [
      ["Secrets", ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ["Sqs", ec2.InterfaceVpcEndpointAwsService.SQS],
    ] as const) {
      vpc.addInterfaceEndpoint(`${name}Endpoint`, { service: svc });
    }

    // ── Data: RDS Postgres + RDS Proxy + Secrets ──────────────────────────────
    const dbSecret = new rds.DatabaseSecret(this, "DbSecret", { username: "stlucie" });

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "RDS Postgres - only reachable from the proxy",
      allowAllOutbound: false,
    });
    const proxySg = new ec2.SecurityGroup(this, "ProxySg", {
      vpc,
      description: "RDS Proxy - reachable from Lambdas",
      allowAllOutbound: true,
    });
    const lambdaSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc,
      description: "Lambda functions",
      allowAllOutbound: true,
    });
    proxySg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), "Lambda to Proxy");
    dbSg.addIngressRule(proxySg, ec2.Port.tcp(5432), "Proxy to RDS");

    const db = new rds.DatabaseInstance(this, "Db", {
      engine: PG_ENGINE,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        config.dbInstanceSize,
      ),
      credentials: rds.Credentials.fromSecret(dbSecret),
      databaseName: "stlucie",
      securityGroups: [dbSg],
      multiAz: config.dbMultiAz,
      deletionProtection: config.dbDeletionProtection,
      removalPolicy: config.dbRemovalPolicy,
      storageEncrypted: true,
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      backupRetention: Duration.days(config.envName === "prod" ? 7 : 1),
    });

    const proxy = new rds.DatabaseProxy(this, "DbProxy", {
      proxyTarget: rds.ProxyTarget.fromInstance(db),
      secrets: [dbSecret],
      vpc,
      securityGroups: [proxySg],
      requireTLS: true,
      iamAuth: false,
    });

    // ── Schema init: apply db/schema.sql on first deploy via custom resource ─
    const schemaAsset = new s3assets.Asset(this, "SchemaAsset", {
      path: path.join(repoRoot, "db", "schema.sql"),
    });

    const dbInitFn = new lambdaNode.NodejsFunction(this, "DbInitFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(repoRoot, "server/workers/db-init-worker.ts"),
      handler: "handler",
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, "package-lock.json"),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [lambdaSg],
      memorySize: 256,
      timeout: Duration.minutes(5),
      logGroup: new logs.LogGroup(this, "DbInitFnLogs", {
        retention: logs.RetentionDays.ONE_WEEK,
        removalPolicy: config.dbRemovalPolicy,
      }),
      environment: {
        PGHOST: proxy.endpoint,
        PGPORT: "5432",
        PGUSER: "stlucie",
        PGDATABASE: "stlucie",
        PGPASSWORD_SECRET_ARN: dbSecret.secretArn,
        SCHEMA_BUCKET: schemaAsset.s3BucketName,
        SCHEMA_KEY: schemaAsset.s3ObjectKey,
      },
      bundling: { format: lambdaNode.OutputFormat.ESM, target: "node22" },
    });
    proxy.grantConnect(dbInitFn, "stlucie");
    dbSecret.grantRead(dbInitFn);
    schemaAsset.grantRead(dbInitFn);

    const dbInitProvider = new cr.Provider(this, "DbInitProvider", {
      onEventHandler: dbInitFn,
    });
    new CustomResource(this, "DbInit", {
      serviceToken: dbInitProvider.serviceToken,
    });

    // ── Auth: Cognito user pool + persona groups ──────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false, // staff accounts are admin-created
      signInAliases: { email: true },
      removalPolicy: config.dbRemovalPolicy,
    });
    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
      },
    });
    for (const group of ["admin", "checkin_clerk", "service_clerk"]) {
      new cognito.CfnUserPoolGroup(this, `Group-${group}`, {
        userPoolId: userPool.userPoolId,
        groupName: group,
      });
    }

    // ── Storage: documents + per-surface frontend buckets ─────────────────────
    const documentsBucket = new s3.Bucket(this, "DocumentsBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      enforceSSL: true,
      cors: [], // populated after CloudFront distributions are created
      lifecycleRules: [{ expiration: Duration.days(config.envName === "prod" ? 365 : 30) }],
      removalPolicy: config.dbRemovalPolicy,
      autoDeleteObjects: config.envName !== "prod",
    });

    // ── Async: SQS email queue + worker ───────────────────────────────────────
    const emailDlq = new sqs.Queue(this, "EmailDlq", { retentionPeriod: Duration.days(14) });
    const emailQueue = new sqs.Queue(this, "EmailQueue", {
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: emailDlq, maxReceiveCount: 3 },
    });

    // ── Compute: shared container image, two functions ────────────────────────
    const dockerCode = lambda.DockerImageCode.fromImageAsset(repoRoot, {
      file: "Dockerfile",
    });

    const commonEnv: Record<string, string> = {
      PGHOST: proxy.endpoint,
      PGPORT: "5432",
      PGUSER: "stlucie",
      PGDATABASE: "stlucie",
      PGSSL: "true",
      NODE_ENV: "production",
      EMAIL: config.senderEmail,
      DOCUMENTS_BUCKET: documentsBucket.bucketName,
      EMAIL_QUEUE_URL: emailQueue.queueUrl,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
    };

    const vpcSubnets: ec2.SubnetSelection = { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS };

    const makeFn = (id: string, service: "appointment" | "queue", reserved: number) =>
      new lambda.DockerImageFunction(this, id, {
        code: dockerCode,
        architecture: lambda.Architecture.ARM_64,
        vpc,
        vpcSubnets,
        securityGroups: [lambdaSg],
        memorySize: 512,
        timeout: Duration.seconds(29), // under API Gateway's 30s integration cap
        reservedConcurrentExecutions: reserved,
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: config.dbRemovalPolicy,
        }),
        environment: {
          ...commonEnv,
          SERVICE: service,
          // Resolve the DB password from Secrets Manager at init.
          PGPASSWORD_SECRET_ARN: dbSecret.secretArn,
        },
      });

    const appointmentFn = makeFn(
      "AppointmentFn",
      "appointment",
      config.appointmentReservedConcurrency,
    );
    const queueFn = makeFn("QueueFn", "queue", config.queueReservedConcurrency);

    // Grants — least privilege per function.
    for (const fn of [appointmentFn, queueFn]) {
      proxy.grantConnect(fn, "stlucie");
      dbSecret.grantRead(fn);
    }
    documentsBucket.grantReadWrite(appointmentFn); // presign + inline upload
    emailQueue.grantSendMessages(queueFn); // summon emails
    const sesIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/${config.senderEmail}`;
    for (const fn of [appointmentFn, queueFn]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: [sesIdentityArn] }),
      );
    }

    // Workers are small event-driven handlers (not the HTTP server), so they
    // use esbuild-bundled NodejsFunctions instead of the LWA container image.
    const workerEnv = { ...commonEnv, PGPASSWORD_SECRET_ARN: dbSecret.secretArn };
    const makeWorker = (id: string, entry: string, timeout: Duration) =>
      new lambdaNode.NodejsFunction(this, id, {
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        entry: path.join(repoRoot, entry),
        handler: "handler",
        projectRoot: repoRoot,
        depsLockFilePath: path.join(repoRoot, "package-lock.json"),
        vpc,
        vpcSubnets,
        securityGroups: [lambdaSg],
        memorySize: 256,
        timeout,
        logGroup: new logs.LogGroup(this, `${id}Logs`, {
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: config.dbRemovalPolicy,
        }),
        environment: workerEnv,
        bundling: { format: lambdaNode.OutputFormat.ESM, target: "node22" },
      });

    // Email worker drains the SQS queue (decouples SES latency from summons).
    const emailWorker = makeWorker(
      "EmailWorker",
      "server/workers/email-worker.ts",
      Duration.seconds(30),
    );
    proxy.grantConnect(emailWorker, "stlucie");
    dbSecret.grantRead(emailWorker);
    emailWorker.addToRolePolicy(
      new iam.PolicyStatement({ actions: ["ses:SendEmail"], resources: [sesIdentityArn] }),
    );
    emailWorker.addEventSource(new SqsEventSource(emailQueue, { batchSize: 5 }));

    // Nightly duration-recommendation batch.
    const durationRecFn = makeWorker(
      "DurationRecFn",
      "server/workers/duration-rec-worker.ts",
      Duration.minutes(2),
    );
    proxy.grantConnect(durationRecFn, "stlucie");
    dbSecret.grantRead(durationRecFn);
    new events.Rule(this, "NightlyDurationRec", {
      schedule: events.Schedule.cron({ hour: "7", minute: "0" }), // ~3am ET
      targets: [new targets.LambdaFunction(durationRecFn)],
    });

    // ── API Gateway: single HTTP API, path-based routing to two Lambdas ────────
    // Auth is enforced at the application layer (server/middleware/auth.ts) so
    // public routes (prescreen, config, lobby) work without API-level authorizers.
    const httpApi = new apigwv2.HttpApi(this, "HttpApi");

    const queueIntegration = new apigwv2_integrations.HttpLambdaIntegration("QueueInt", queueFn);
    const appointmentIntegration = new apigwv2_integrations.HttpLambdaIntegration(
      "AppointmentInt",
      appointmentFn,
    );

    // Queue-domain routes → QueueFn
    for (const path of [
      "/api/clerk/{proxy+}",
      "/api/clerks",
      "/api/live-queue",
      "/api/seed-queue",
    ]) {
      httpApi.addRoutes({
        path,
        methods: [apigwv2.HttpMethod.ANY],
        integration: queueIntegration,
      });
    }

    // Everything else → AppointmentFn (catch-all must come last)
    httpApi.addRoutes({
      path: "/{proxy+}",
      methods: [apigwv2.HttpMethod.ANY],
      integration: appointmentIntegration,
    });

    // Stage-level throttling protects the DB and the downstream chatbot module.
    const apiStage = httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
    apiStage.defaultRouteSettings = {
      throttlingRateLimit: config.apiRateLimit,
      throttlingBurstLimit: config.apiBurstLimit,
    };

    // ── WAF: REGIONAL scope protects API Gateway ─────────────────────────────
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      defaultAction: { allow: {} },
      scope: "REGIONAL",
      visibilityConfig: {
        cloudWatchMetricsEnabled: true,
        metricName: "office-web-acl",
        sampledRequestsEnabled: true,
      },
      rules: [
        {
          name: "RateLimit",
          priority: 0,
          action: { block: {} },
          statement: { rateBasedStatement: { limit: 2000, aggregateKeyType: "IP" } },
          visibilityConfig: {
            cloudWatchMetricsEnabled: true,
            metricName: "rate-limit",
            sampledRequestsEnabled: true,
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, "ApiWafAssoc", {
      webAclArn: webAcl.attrArn,
      resourceArn: `arn:aws:apigateway:${this.region}::/apis/${httpApi.httpApiId}/stages/${httpApi.defaultStage!.stageName}`,
    });

    // ── Frontend: single S3 + CloudFront distribution ──────────────────────────
    const frontendBucket = new s3.Bucket(this, "FrontendBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.dbRemovalPolicy,
      autoDeleteObjects: config.envName !== "prod",
    });

    const distribution = new cloudfront.Distribution(this, "FrontendDist", {
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    // ── CORS: restrict to CloudFront origin (+localhost for dev) ─────────────
    const allowedOrigins = [`https://${distribution.distributionDomainName}`];
    if (config.envName !== "prod") {
      allowedOrigins.push("http://localhost:3000", "http://localhost:5173");
    }

    // S3 documents bucket CORS
    const cfnBucket = documentsBucket.node.defaultChild as s3.CfnBucket;
    cfnBucket.addPropertyOverride("CorsConfiguration", {
      CorsRules: [
        {
          AllowedMethods: ["PUT", "GET"],
          AllowedOrigins: allowedOrigins,
          AllowedHeaders: ["*"],
        },
      ],
    });

    // API Gateway CORS
    const cfnApi = httpApi.node.defaultChild as apigwv2.CfnApi;
    cfnApi.corsConfiguration = {
      allowOrigins: allowedOrigins,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Authorization", "Content-Type"],
    };

    // ── Outputs ───────────────────────────────────────────────────────────────
    new CfnOutput(this, "ApiUrl", { value: httpApi.apiEndpoint });
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "DocumentsBucketName", { value: documentsBucket.bucketName });
    new CfnOutput(this, "FrontendBucketName", { value: frontendBucket.bucketName });
    new CfnOutput(this, "FrontendUrl", {
      value: `https://${distribution.distributionDomainName}`,
    });
    new CfnOutput(this, "DistributionId", { value: distribution.distributionId });
  }
}
