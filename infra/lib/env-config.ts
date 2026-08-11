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
  // Physical name of the BackOffice DocumentsBucket. Passed to ChatbotStack as
  // a plain string (not a cross-stack Bucket ref) so the chatbot doc-bridge's
  // read/write grant stays inside ChatbotStack and deploys without a BackOffice
  // (Docker) rebuild. Defaults to the deployed name; override via env if the
  // bucket is ever recreated.
  documentsBucketName: string;
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

// Placeholder values shipped in .env.example. A partner who copies the template
// and forgets to replace these would otherwise synth a stack that either bypasses
// its own origin protection (ORIGIN_SECRET) or rolls back on a foreign ACM cert
// (custom domain). Fail loudly at synth instead.
const PLACEHOLDER_ORIGIN_SECRET = "generate-a-long-random-secret";
const PLACEHOLDER_DOMAIN = "your-domain.example.com";
const PLACEHOLDER_CERT_ACCOUNT = "123456789012";

export function envConfig(): EnvConfig {
  if (!process.env.SENDER_EMAIL) {
    throw new Error("SENDER_EMAIL environment variable is required for CDK synthesis");
  }

  // CloudFront-scoped WAF (BackOffice) + CloudFront ACM certs are us-east-1-only.
  // A deploy to any other region fails deep inside CloudFormation with a cryptic
  // error; assert here so the failure is immediate and actionable. CDK resolves
  // the region from CDK_DEFAULT_REGION / AWS_REGION at synth.
  const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION;
  if (region && region !== "us-east-1") {
    throw new Error(
      `This stack must deploy to us-east-1 (CloudFront-scoped WAF + ACM), but the region is "${region}". ` +
        `Set CDK_DEFAULT_REGION=us-east-1.`,
    );
  }

  // ORIGIN_SECRET is requireEnv'd in ChatbotStack, but a non-empty placeholder
  // passes that check — reject the literal template value explicitly.
  if (process.env.ORIGIN_SECRET?.trim() === PLACEHOLDER_ORIGIN_SECRET) {
    throw new Error(
      "ORIGIN_SECRET is still the .env.example placeholder. Generate a real secret " +
        "(e.g. `openssl rand -base64 32`) — a source-visible value defeats CloudFront/WAF origin protection.",
    );
  }

  const customDomainName = process.env.CUSTOM_DOMAIN_NAME?.trim() || undefined;
  const customDomainCertificateArn = process.env.CUSTOM_DOMAIN_CERTIFICATE_ARN?.trim() || undefined;

  if (Boolean(customDomainName) !== Boolean(customDomainCertificateArn)) {
    throw new Error(
      "CUSTOM_DOMAIN_NAME and CUSTOM_DOMAIN_CERTIFICATE_ARN must either both be set or both be omitted",
    );
  }
  // Reject the .env.example placeholders — they pass every structural check
  // below (both set, host has no protocol, ARN region field == us-east-1) yet
  // reference a domain/cert the deployer does not own, causing a CloudFront
  // CREATE_FAILED rollback on a fresh account.
  if (customDomainName === PLACEHOLDER_DOMAIN) {
    throw new Error(
      `CUSTOM_DOMAIN_NAME is still the .env.example placeholder ("${PLACEHOLDER_DOMAIN}"). ` +
        "Set it to a domain you own, or comment out both CUSTOM_DOMAIN_* vars to use the CloudFront default domain.",
    );
  }
  if (customDomainCertificateArn?.split(":")[4] === PLACEHOLDER_CERT_ACCOUNT) {
    throw new Error(
      `CUSTOM_DOMAIN_CERTIFICATE_ARN is still the .env.example placeholder (account ${PLACEHOLDER_CERT_ACCOUNT}). ` +
        "Set it to an ACM certificate ARN in your own account (us-east-1), or comment out both CUSTOM_DOMAIN_* vars.",
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
    // BASE_URL feeds customer email links from the BackOffice functions. When a
    // custom domain is set we derive it; otherwise leave it EMPTY so the caller
    // (ChatbotStack) can substitute the live CloudFront distribution domain at
    // deploy time — never a hardcoded foreign-account fallback.
    baseUrl:
      process.env.BASE_URL?.trim() || (customDomainName ? `https://${customDomainName}` : ""),
    customDomainName,
    customDomainCertificateArn,
    // Physical name of the BackOffice DocumentsBucket. Empty means "resolve it
    // at deploy time from the BackOffice stack" (see infra/bin/app.ts). Only set
    // via env when pointing the chatbot at a pre-existing bucket. No hardcoded
    // account-specific fallback — a stale literal silently misroutes uploads.
    documentsBucketName: process.env.DOCUMENTS_BUCKET_NAME?.trim() || "",
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
