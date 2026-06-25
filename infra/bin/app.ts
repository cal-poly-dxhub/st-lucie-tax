#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { OfficeInfraStack } from "../lib/office-infra-stack";
import { envConfig } from "../lib/env-config";

// Single CDK app → single stack per environment. Select with `-c env=dev`.
// Each environment gets its own VPC/RDS/Cognito/Lambdas/frontends so dev,
// test, and prod are fully isolated.
const app = new cdk.App();

const envName = (app.node.tryGetContext("env") as string) ?? "dev";
const config = envConfig(envName);

new OfficeInfraStack(app, `OfficeInfra-${envName}`, {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-west-2",
  },
  description: `St. Lucie office operations infrastructure (${envName})`,
  tags: {
    Project: "st-lucie-tax",
    Environment: envName,
  },
});
