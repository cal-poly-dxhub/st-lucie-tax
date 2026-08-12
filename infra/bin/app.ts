#!/usr/bin/env node
import { config as loadEnv } from "dotenv";
import * as path from "node:path";
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });
import * as cdk from "aws-cdk-lib";
import { BackOfficeStack } from "../lib/back-office-stack";
import { ChatbotStack } from "../lib/chatbot-stack";
import { envConfig } from "../lib/env-config";

const app = new cdk.App();

const config = envConfig();

const backOfficeStack = new BackOfficeStack(app, "BackOffice", {
  config,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  description: "St. Lucie back-office infrastructure",
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
  vpc: backOfficeStack.vpc,
  proxy: backOfficeStack.proxy,
  dbSecret: backOfficeStack.dbSecret,
  lambdaSg: backOfficeStack.lambdaSg,
  officeApiUrl: backOfficeStack.httpApiUrl,
  // Wire the doc-bridge to the REAL DocumentsBucket for THIS account. An
  // explicit env override (DOCUMENTS_BUCKET_NAME) wins for pointing at a
  // pre-existing bucket; otherwise use the live cross-stack reference so a
  // fresh deploy self-heals in one pass (BackOffice → Chatbot, no cycle).
  documentsBucketName: config.documentsBucketName || backOfficeStack.documentsBucketName,
  webAclArn: backOfficeStack.webAclArn,
  userPoolId: backOfficeStack.userPoolId,
  userPoolClientId: backOfficeStack.userPoolClientId,
  customDomainName: config.customDomainName,
  customDomainCertificateArn: config.customDomainCertificateArn,
  baseUrl: config.baseUrl,
});
