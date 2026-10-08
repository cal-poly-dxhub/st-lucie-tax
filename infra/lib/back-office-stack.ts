import * as path from "node:path";
import { Construct } from "constructs";
import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
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
import * as wafv2 from "aws-cdk-lib/aws-wafv2";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigwv2_integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as iam from "aws-cdk-lib/aws-iam";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { EnvConfig, PG_ENGINE } from "./env-config";

export interface BackOfficeStackProps extends StackProps {
  config: EnvConfig;
}

// One stack, two Lambdas. Holds the whole environment: network, data
// (RDS + Proxy + Secrets), auth (Cognito), compute (AppointmentFn + QueueFn
// behind separate HTTP APIs), async (SQS email worker + nightly
// duration-recommendation schedule), and the static frontends (S3 + CloudFront
// + WAF). The appointment and queue domains are deployed as independent
// functions with their own reserved concurrency so a failure in one cannot
// take down the other.
export class BackOfficeStack extends Stack {
  public readonly vpc: ec2.Vpc;
  public readonly proxy: rds.DatabaseProxy;
  public readonly dbSecret: rds.DatabaseSecret;
  public readonly lambdaSg: ec2.SecurityGroup;
  public readonly httpApiUrl: string;
  public readonly webAclArn: string;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;
  // Physical name of the DocumentsBucket, exposed so ChatbotStack wires the
  // doc-bridge to the REAL bucket for this account instead of a hardcoded name.
  public readonly documentsBucketName: string;

  constructor(scope: Construct, id: string, props: BackOfficeStackProps) {
    super(scope, id, props);
    const { config } = props;
    const repoRoot = path.join(__dirname, "..", "..");

    // ── Network ──────────────────────────────────────────────────────────────
    const vpc = (this.vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: config.maxAzs,
      natGateways: config.natGateways,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    }));

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

    // ── Data: Aurora Serverless v2 + RDS Proxy + Secrets ────────────────────────
    const dbSecret = (this.dbSecret = new rds.DatabaseSecret(this, "DbSecret", {
      username: "stlucie",
    }));

    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "Aurora Serverless v2 - only reachable from the proxy",
      allowAllOutbound: false,
    });
    const proxySg = new ec2.SecurityGroup(this, "ProxySg", {
      vpc,
      description: "RDS Proxy - reachable from Lambdas",
      allowAllOutbound: true,
    });
    const lambdaSg = (this.lambdaSg = new ec2.SecurityGroup(this, "LambdaSg", {
      vpc,
      description: "Lambda functions",
      allowAllOutbound: true,
    }));
    proxySg.addIngressRule(lambdaSg, ec2.Port.tcp(5432), "Lambda to Proxy");
    dbSg.addIngressRule(proxySg, ec2.Port.tcp(5432), "Proxy to RDS");

    const dbCluster = new rds.DatabaseCluster(this, "Db", {
      engine: PG_ENGINE,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      credentials: rds.Credentials.fromSecret(dbSecret),
      defaultDatabaseName: "stlucie",
      securityGroups: [dbSg],
      deletionProtection: config.dbDeletionProtection,
      removalPolicy: config.dbRemovalPolicy,
      storageEncrypted: true,
      backup: { retention: Duration.days(1) },
      serverlessV2MinCapacity: config.dbMinCapacity,
      serverlessV2MaxCapacity: config.dbMaxCapacity,
      writer: rds.ClusterInstance.serverlessV2("writer"),
    });

    const proxy = (this.proxy = new rds.DatabaseProxy(this, "DbProxy", {
      proxyTarget: rds.ProxyTarget.fromCluster(dbCluster),
      secrets: [dbSecret],
      vpc,
      securityGroups: [proxySg],
      requireTLS: true,
      iamAuth: false,
    }));

    // ── Schema init: apply db/schema.sql on first deploy via custom resource ─
    const schemaAsset = new s3assets.Asset(this, "SchemaAsset", {
      path: path.join(repoRoot, "db", "schema.sql"),
    });

    // Operational seed data, applied by DbInitFn ONLY on a fresh (empty) DB,
    // right after the schema, in this order (flows/docs reference seed.sql rows).
    // Without these a fresh deploy comes up with zero offices/transactions/
    // clerks and is unusable. Uploaded as individual assets sharing one bucket;
    // SEED_KEYS is the ordered comma-separated list of object keys.
    const seedFiles = ["seed.sql", "seed-docs.sql", "seed-flows.sql"];
    const seedAssets = seedFiles.map(
      (f) =>
        new s3assets.Asset(this, `SeedAsset-${f.replace(/\W/g, "-")}`, {
          path: path.join(repoRoot, "db", f),
        }),
    );

    const dbInitFn = new lambdaNode.NodejsFunction(this, "DbInitFn", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      entry: path.join(repoRoot, "services/office-ops/server/workers/db-init-worker.ts"),
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
        // Seed assets share the CDK asset bucket; SEED_KEYS is the ORDERED list.
        SEED_BUCKET: seedAssets[0].s3BucketName,
        SEED_KEYS: seedAssets.map((a) => a.s3ObjectKey).join(","),
      },
      bundling: {
        format: lambdaNode.OutputFormat.ESM,
        target: "node22",
        banner: 'import{createRequire}from"module";const require=createRequire(import.meta.url);',
      },
    });
    proxy.grantConnect(dbInitFn, "stlucie");
    dbSecret.grantRead(dbInitFn);
    schemaAsset.grantRead(dbInitFn);
    for (const a of seedAssets) a.grantRead(dbInitFn);

    // DbInitFn is deployed but NOT run at deploy time. Apply the schema by
    // invoking it manually once the DB/proxy are up:
    //   aws lambda invoke --function-name <name> /dev/stdout
    new CfnOutput(this, "DbInitFnName", { value: dbInitFn.functionName });

    // ── SSM Bastion: tiny instance for local port-forward to Aurora ────────────
    const bastionSg = new ec2.SecurityGroup(this, "BastionSg", {
      vpc,
      description: "SSM bastion - outbound to Aurora only",
      allowAllOutbound: true,
    });
    dbSg.addIngressRule(bastionSg, ec2.Port.tcp(5432), "Bastion to RDS");

    const bastion = new ec2.Instance(this, "SsmBastion", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.NANO),
      machineImage: ec2.MachineImage.latestAmazonLinux2023({
        cpuType: ec2.AmazonLinuxCpuType.ARM_64,
      }),
      securityGroup: bastionSg,
      ssmSessionPermissions: true,
    });

    new CfnOutput(this, "BastionInstanceId", { value: bastion.instanceId });

    // ── Auth: Cognito user pool + persona groups ──────────────────────────────
    const userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: false, // staff accounts are admin-created
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: config.dbRemovalPolicy,
    });
    const userPoolClient = userPool.addClient("WebClient", {
      authFlows: { userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL],
      },
    });
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = userPoolClient.userPoolClientId;

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
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: [
            "https://*.cloudfront.net",
            "http://localhost:3000",
            "http://localhost:5173",
          ],
          allowedHeaders: ["*"],
        },
      ],
      lifecycleRules: [{ expiration: Duration.days(30) }],
      removalPolicy: config.dbRemovalPolicy,
      autoDeleteObjects: true,
    });
    this.documentsBucketName = documentsBucket.bucketName;

    // ── Async: SQS email queue + worker ───────────────────────────────────────
    const emailDlq = new sqs.Queue(this, "EmailDlq", { retentionPeriod: Duration.days(14) });
    const emailQueue = new sqs.Queue(this, "EmailQueue", {
      visibilityTimeout: Duration.seconds(60),
      deadLetterQueue: { queue: emailDlq, maxReceiveCount: 3 },
    });

    // ── Compute: shared container image, two functions ────────────────────────
    const dockerCode = lambda.DockerImageCode.fromImageAsset(repoRoot, {
      file: "services/office-ops/Dockerfile",
    });

    const commonEnv: Record<string, string> = {
      PGHOST: proxy.endpoint,
      PGPORT: "5432",
      PGUSER: "stlucie",
      PGDATABASE: "stlucie",
      PGSSL: "true",
      NODE_ENV: "production",
      EMAIL: config.senderEmail,
      // BASE_URL is OMITTED (not set to "") when config.baseUrl is blank, as in
      // ChatbotStack. services/office-ops/server/config.ts reads it with `??`, so
      // an explicit "" is not nullish and would suppress the app's own defaults —
      // FRONTEND_URL would resolve to "" and email links to bare paths
      // ("/prescreen/<code>"), which no mail client can follow. Set BASE_URL in
      // .env and redeploy both stacks (infra/DEPLOY.md §7).
      ...(config.baseUrl ? { BASE_URL: config.baseUrl } : {}),
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
    documentsBucket.grantRead(queueFn); // presign for document preview/download
    emailQueue.grantSendMessages(queueFn); // summon emails
    const sesIdentityArn = `arn:aws:ses:${this.region}:${this.account}:identity/*`;
    for (const fn of [appointmentFn, queueFn]) {
      fn.addToRolePolicy(
        new iam.PolicyStatement({
          actions: ["ses:SendEmail", "ses:CreateEmailIdentity", "ses:GetEmailIdentity"],
          resources: [sesIdentityArn],
        }),
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
        bundling: {
          format: lambdaNode.OutputFormat.ESM,
          target: "node22",
          banner: 'import{createRequire}from"module";const require=createRequire(import.meta.url);',
        },
      });

    // Email worker drains the SQS queue (decouples SES latency from summons).
    const emailWorker = makeWorker(
      "EmailWorker",
      "services/office-ops/server/workers/email-worker.ts",
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
      "services/office-ops/server/workers/duration-rec-worker.ts",
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
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      createDefaultStage: false,
    });
    const apiStage = new apigwv2.HttpStage(this, "ApiStage", {
      httpApi,
      stageName: "$default",
      autoDeploy: true,
    });

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
    const cfnStage = apiStage.node.defaultChild as apigwv2.CfnStage;
    cfnStage.defaultRouteSettings = {
      throttlingRateLimit: config.apiRateLimit,
      throttlingBurstLimit: config.apiBurstLimit,
    };

    // ── WAF: CLOUDFRONT scope. It only ever sees traffic that arrives THROUGH
    // the distribution — the S3 frontend and the /api/* behaviors. It does NOT
    // protect any origin reached directly. The two REST origins (ChatbotApi,
    // AdminApi) are covered in practice because chatbot-stack.ts gives them an
    // x-origin-secret custom header and they 403 without it. The office-ops
    // HTTP API origin has no such header, so its execute-api URL is reachable
    // from the internet and this WAF (including the rate-based rule below)
    // never applies to it. Cognito and the stage throttle above are what guard
    // that path. See infra/DEPLOY.md → Secrets. ──────────────────────────────
    const webAcl = new wafv2.CfnWebACL(this, "WebAcl", {
      defaultAction: { allow: {} },
      scope: "CLOUDFRONT",
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
    this.webAclArn = webAcl.attrArn;

    this.httpApiUrl = `https://${httpApi.httpApiId}.execute-api.${this.region}.amazonaws.com`;

    // ── Outputs ───────────────────────────────────────────────────────────────
    new CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: userPoolClient.userPoolClientId });
    new CfnOutput(this, "DocumentsBucketName", { value: documentsBucket.bucketName });
  }
}
