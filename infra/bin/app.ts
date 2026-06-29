#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import * as path from "node:path";
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });
import * as cdk from "aws-cdk-lib";
import { OfficeInfraStack } from "../lib/office-infra-stack";
import { ChatbotStack } from "../lib/chatbot-stack";
import { envConfig } from "../lib/env-config";

const app = new cdk.App();

const config = envConfig();

const officeStack = new OfficeInfraStack(app, "OfficeInfra", {
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

new ChatbotStack(app, "Chatbot", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: "St. Lucie AI chatbot infrastructure",
  tags: {
    Project: "st-lucie-tax",
  },
  vpc: officeStack.vpc,
  proxy: officeStack.proxy,
  dbSecret: officeStack.dbSecret,
  lambdaSg: officeStack.lambdaSg,
  officeApiUrl: officeStack.httpApiUrl,
  webAclArn: officeStack.webAclArn,
});
