import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from "aws-cdk-lib/aws-rds";
import { RemovalPolicy } from "aws-cdk-lib";

// Per-environment sizing. dev/test stay cheap and Single-AZ; prod is Multi-AZ
// with deletion protection and retained data. The shape mirrors the
// architecture doc: small RDS for PostgreSQL behind RDS Proxy, serverless-first.
export interface EnvConfig {
  envName: string;
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

export function envConfig(envName: string): EnvConfig {
  const base = {
    envName,
    senderEmail: process.env.SENDER_EMAIL!,
  };

  switch (envName) {
    case "prod":
      return {
        ...base,
        dbInstanceSize: ec2.InstanceSize.SMALL,
        dbMultiAz: false,
        dbDeletionProtection: true,
        dbRemovalPolicy: RemovalPolicy.RETAIN,
        maxAzs: 1,
        natGateways: 1,
        appointmentReservedConcurrency: 20,
        queueReservedConcurrency: 20,
        apiRateLimit: 50,
        apiBurstLimit: 100,
      };
    case "test":
      return {
        ...base,
        dbInstanceSize: ec2.InstanceSize.MICRO,
        dbMultiAz: false,
        dbDeletionProtection: false,
        dbRemovalPolicy: RemovalPolicy.DESTROY,
        maxAzs: 1,
        natGateways: 1,
        appointmentReservedConcurrency: 10,
        queueReservedConcurrency: 10,
        apiRateLimit: 25,
        apiBurstLimit: 50,
      };
    default: // dev
      return {
        ...base,
        dbInstanceSize: ec2.InstanceSize.MICRO,
        dbMultiAz: false,
        dbDeletionProtection: false,
        dbRemovalPolicy: RemovalPolicy.DESTROY,
        maxAzs: 1,
        natGateways: 1,
        appointmentReservedConcurrency: 5,
        queueReservedConcurrency: 5,
        apiRateLimit: 20,
        apiBurstLimit: 40,
      };
  }
}

// PostgreSQL engine version pinned to match local docker (postgres:16).
export const PG_ENGINE = rds.DatabaseInstanceEngine.postgres({
  version: rds.PostgresEngineVersion.VER_16_4,
});
