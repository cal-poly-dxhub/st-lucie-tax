import * as rds from "aws-cdk-lib/aws-rds";
import { RemovalPolicy } from "aws-cdk-lib";

// Single-environment sizing. Cheap, Single-AZ, data destroyed on teardown.
// Aurora Serverless v2 behind RDS Proxy.
export interface EnvConfig {
  // Sender + reply address used by SES. Must be a verified SES identity.
  senderEmail: string;
  // Base URL for email links (CloudFront distribution URL or custom domain).
  baseUrl: string;
  // Optional CloudFront alternate domain. Requires a matching ACM certificate
  // imported from us-east-1 because CloudFront certificates are region-bound.
  customDomainName?: string;
  customDomainCertificateArn?: string;
  // Aurora Serverless v2 capacity (ACUs)
  dbMinCapacity: number;
  dbMaxCapacity: number;
  dbDeletionProtection: boolean;
  dbRemovalPolicy: RemovalPolicy;
  maxAzs: number;
  natGateways: number;
  // Reserved concurrency keeps the two fault domains from starving each other.
  appointmentReservedConcurrency: number;
  queueReservedConcurrency: number;
  // API Gateway throttling protects downstream (DB + the separate chatbot
  // module that calls the appointment API).
  apiRateLimit: number;
  apiBurstLimit: number;
}

export function envConfig(): EnvConfig {
  if (!process.env.SENDER_EMAIL) {
    throw new Error("SENDER_EMAIL environment variable is required for CDK synthesis");
  }

  const customDomainName = process.env.CUSTOM_DOMAIN_NAME?.trim() || undefined;
  const customDomainCertificateArn = process.env.CUSTOM_DOMAIN_CERTIFICATE_ARN?.trim() || undefined;

  if (Boolean(customDomainName) !== Boolean(customDomainCertificateArn)) {
    throw new Error(
      "CUSTOM_DOMAIN_NAME and CUSTOM_DOMAIN_CERTIFICATE_ARN must either both be set or both be omitted",
    );
  }
  if (
    customDomainName &&
    (customDomainName.includes("://") ||
      customDomainName.includes("/") ||
      customDomainName.includes("?"))
  ) {
    throw new Error("CUSTOM_DOMAIN_NAME must be a hostname only, without a protocol or path");
  }
  if (customDomainCertificateArn && customDomainCertificateArn.split(":")[3] !== "us-east-1") {
    throw new Error("CUSTOM_DOMAIN_CERTIFICATE_ARN must reference an ACM certificate in us-east-1");
  }

  return {
    senderEmail: process.env.SENDER_EMAIL,
    baseUrl:
      process.env.BASE_URL ??
      (customDomainName ? `https://${customDomainName}` : "https://d3a20qrc894vkj.cloudfront.net"),
    customDomainName,
    customDomainCertificateArn,
    dbMinCapacity: 0.5,
    dbMaxCapacity: 2,
    dbDeletionProtection: false,
    dbRemovalPolicy: RemovalPolicy.DESTROY,
    maxAzs: 2,
    natGateways: 1,
    appointmentReservedConcurrency: 5,
    queueReservedConcurrency: 5,
    apiRateLimit: 20,
    apiBurstLimit: 40,
  };
}

export const PG_ENGINE = rds.DatabaseClusterEngine.auroraPostgres({
  version: rds.AuroraPostgresEngineVersion.VER_17_4,
});
