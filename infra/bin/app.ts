#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import * as path from "node:path";
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });
import * as cdk from "aws-cdk-lib";
import { OfficeInfraStack } from "../lib/office-infra-stack";
import { envConfig } from "../lib/env-config";

// Single CDK app → single stack. One VPC/RDS/Cognito/Lambdas/frontends.
const app = new cdk.App();

const config = envConfig();

new OfficeInfraStack(app, "OfficeInfra", {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: "St. Lucie office operations infrastructure",
  tags: {
    Project: "st-lucie-tax",
  },
});
