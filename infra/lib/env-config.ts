import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { RemovalPolicy } from "aws-cdk-lib";

// Single-environment sizing. Cheap, Single-AZ, data destroyed on teardown.
// The shape mirrors the architecture doc: small RDS for PostgreSQL behind
// RDS Proxy, serverless-first.
export interface EnvConfig {
  // Sender + reply address used by SES. Must be a verified SES identity.
  senderEmail: string;
  // RDS
  dbInstanceSize: ec2.InstanceSize;
  dbMultiAz: boolean;
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
  return {
    senderEmail: process.env.SENDER_EMAIL!,
    dbInstanceSize: ec2.InstanceSize.MICRO,
    dbMultiAz: false,
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

// PostgreSQL engine version pinned to match local docker (postgres:17).
export const PG_ENGINE = rds.DatabaseInstanceEngine.postgres({
  version: rds.PostgresEngineVersion.VER_17_9,
});
