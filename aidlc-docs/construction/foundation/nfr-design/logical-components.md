# Logical Components — Unit 1: Foundation

## Overview
Complete inventory of AWS resources and logical components created by the FoundationStack.

---

## Component Inventory

### Data Store

| Component | AWS Resource | Key Config |
|-----------|-------------|------------|
| Main Table | DynamoDB Table | On-demand, PITR, PK/SK + GSI1, TTL enabled |

### Storage

| Component | AWS Resource | Key Config |
|-----------|-------------|------------|
| Document Bucket | S3 Bucket | SSE-S3, no versioning, 35-day lifecycle, public access blocked, enforceSSL |
| KB Data Source Bucket | S3 Bucket | SSE-S3, no versioning, public access blocked, enforceSSL |

### Authentication

| Component | AWS Resource | Key Config |
|-----------|-------------|------------|
| User Pool | Cognito User Pool | Email sign-in, password policy, MFA optional, TOTP, custom:tenantId |
| App Client | Cognito App Client | No secret, 1hr access / 30d refresh tokens |
| Clerk Group | Cognito User Pool Group | `clerk` |
| Admin Group | Cognito User Pool Group | `admin` |
| Super-Admin Group | Cognito User Pool Group | `super-admin` |

### AI

| Component | AWS Resource | Key Config |
|-----------|-------------|------------|
| Knowledge Base | Bedrock Knowledge Base | S3 data source (KB bucket), managed embeddings |

### Observability

| Component | AWS Resource | Key Config |
|-----------|-------------|------------|
| Alarm Topic | SNS Topic | Zero subscribers |
| DynamoDB Throttle Alarm | CloudWatch Alarm | ThrottledRequests > 0, 1 min |
| S3 Error Alarm | CloudWatch Alarm | 5xxErrors > 0, 5 min |
| Auth Failure Alarm | CloudWatch Alarm | Custom AuthFailure metric > 10, 1 min |

### Cross-Stack Outputs

| Component | AWS Resource | Count |
|-----------|-------------|-------|
| SSM Parameters | SSM Parameter Store | 9 parameters (see Pattern 6) |

---

## Component Dependency Graph

```
FoundationStack
+-- Main Table (DynamoDB)
|     +-- GSI1
|     +-- TTL configuration
|
+-- Document Bucket (S3)
|     +-- Lifecycle rule (35-day expiry)
|     +-- Bucket policy (enforceSSL)
|
+-- KB Data Source Bucket (S3)
|     +-- Bucket policy (enforceSSL)
|
+-- User Pool (Cognito)
|     +-- App Client
|     +-- Groups (clerk, admin, super-admin)
|
+-- Knowledge Base (Bedrock)
|     +-- depends on: KB Data Source Bucket
|
+-- Alarm Topic (SNS)
|
+-- DynamoDB Throttle Alarm (CloudWatch)
|     +-- depends on: Main Table, Alarm Topic
|
+-- S3 Error Alarm (CloudWatch)
|     +-- depends on: Document Bucket, Alarm Topic
|
+-- Auth Failure Alarm (CloudWatch)
|     +-- depends on: Alarm Topic
|
+-- SSM Parameters (x9)
      +-- depends on: Main Table, Document Bucket, KB Data Source Bucket,
                      User Pool, App Client, Knowledge Base
```

### Text Alternative
```
FoundationStack creates 16 resources:
  1. DynamoDB Table (with GSI1, TTL)
  2. S3 Document Bucket (with lifecycle, bucket policy)
  3. S3 KB Data Source Bucket (with bucket policy)
  4. Cognito User Pool (with App Client, 3 groups)
  5. Bedrock Knowledge Base (depends on KB bucket)
  6. SNS Topic (alarm notifications)
  7-9. CloudWatch Alarms x3 (depend on table, bucket, SNS topic)
  10-18. SSM Parameters x9 (depend on all resources above)

Dependencies flow downward: SSM Parameters → all resources.
Bedrock KB → KB bucket. Alarms → SNS topic + monitored resources.
No circular dependencies.
```

---

## Resource Naming Convention

Resources use CDK auto-generated physical names (no hardcoded names). Construct IDs are descriptive so CloudFormation-generated names remain readable.

| Resource | Construct ID | Example Physical Name |
|----------|-------------|----------------------|
| DynamoDB Table | `StLucieMain` | `FoundationStack-StLucieMain-A1B2C3D4` |
| Document Bucket | `StLucieDocuments` | `foundationstack-stluciedocuments-a1b2c3d4` |
| KB Bucket | `StLucieKbData` | `foundationstack-stluciekbdata-a1b2c3d4` |
| User Pool | `StLucieUsers` | (Cognito generates its own ID) |
| SNS Topic | `StLucieFoundationAlarms` | `FoundationStack-StLucieFoundationAlarms-A1B2C3D4` |
| SSM Params | N/A | `/{env}/foundation/*` (explicit paths — cross-stack contract) |

**Rules**:
- Do NOT set explicit `tableName`, `bucketName`, `topicName`, or `userPoolName` properties
- SSM parameter paths are the exception — they use explicit `/{env}/foundation/*` paths because they are cross-stack lookup contracts
- All cross-stack references go through SSM (by ARN/ID), never by physical resource name

---

## IAM Roles (Foundation-Scoped)

Foundation creates minimal IAM roles for its own resources:

| Role | Purpose | Permissions |
|------|---------|-------------|
| Bedrock KB Role | Bedrock KB reads S3 data source | `s3:GetObject` on KB bucket |

Lambda execution roles are created in Unit 2 (BackendStack) with least-privilege scoped to each service's needs. Foundation exports resource ARNs via SSM for BackendStack to reference in IAM policies.
