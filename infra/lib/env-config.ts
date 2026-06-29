import * as rds from "aws-cdk-lib/aws-rds";
import { RemovalPolicy } from "aws-cdk-lib";

// Single-environment sizing. Cheap, Single-AZ, data destroyed on teardown.
// Aurora Serverless v2 behind RDS Proxy.
export interface EnvConfig {
  // Sender + reply address used by SES. Must be a verified SES identity.
  senderEmail: string;
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
  return {
    senderEmail: process.env.SENDER_EMAIL,
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
