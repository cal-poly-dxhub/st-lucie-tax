# NFR Design Patterns — Unit 1: Foundation

## Overview
Concrete design patterns translating NFR requirements into implementation specifications for the FoundationStack.

---

## Pattern 1: DynamoDB Single Table (NFR-F-01, NFR-F-02)

**Pattern**: On-demand single table with PITR.

**CDK Design**:
- `Table` construct with `billingMode: BillingMode.PAY_PER_REQUEST`
- `pointInTimeRecovery: true`
- Partition key: `PK` (String), Sort key: `SK` (String)
- GSI1: `GSI1PK` (String) / `GSI1SK` (String) — appointments by location+date
- `removalPolicy: RemovalPolicy.RETAIN` — prevent accidental table deletion
- DynamoDB default encryption (AWS-owned key) — meets SECURITY-01

**TTL Configuration**:
- TTL attribute: `ttl` (Number, epoch seconds)
- Applied to document metadata records (30-day expiration)
- Non-TTL entities (locations, clerks, config, appointments, customers) have no `ttl` attribute

**Access Pattern**:
- All access goes through `packages/data-access/` (SI-03)
- No direct DynamoDB calls from Lambda handlers
- Tenant isolation enforced at the key construction level (BR-DA-01)

---

## Pattern 2: S3 Document Bucket (NFR-F-03, NFR-F-04, NFR-F-11)

**Pattern**: Encrypted, locked-down PII bucket with lifecycle cleanup.

**CDK Design**:
- `Bucket` construct with:
  - `encryption: BucketEncryption.S3_MANAGED` (SSE-S3)
  - `versioned: false`
  - `blockPublicAccess: BlockPublicAccess.BLOCK_ALL`
  - `enforceSSL: true` (adds bucket policy denying non-TLS requests)
  - `removalPolicy: RemovalPolicy.RETAIN`
  - `autoDeleteObjects: false`
- Lifecycle rule: expire objects after 35 days (backstop for DynamoDB TTL cleanup)
- CORS: restricted to frontend origins (configured per environment)
- Event notification: wired to BC-02 Lambda in Unit 2 (BackendStack adds the notification)

**Presigned URL Pattern**:
- Upload: Lambda generates presigned PUT URL (5-minute expiry, content-type restricted)
- Download: Lambda generates presigned GET URL (15-minute expiry) — only for clerk document review
- No direct bucket access from frontends

---

## Pattern 3: S3 Bedrock KB Bucket (NFR-F-05, NFR-F-11)

**Pattern**: Non-PII content bucket for Knowledge Base data source.

**CDK Design**:
- `Bucket` construct with:
  - `encryption: BucketEncryption.S3_MANAGED`
  - `versioned: false`
  - `blockPublicAccess: BlockPublicAccess.BLOCK_ALL`
  - `enforceSSL: true`
  - `removalPolicy: RemovalPolicy.RETAIN`
- No lifecycle rules (content is manually managed)
- Bedrock Knowledge Base reads from this bucket via IAM role

---

## Pattern 4: Cognito User Pool (NFR-F-06)

**Pattern**: Standard security user pool with role-based groups.

**CDK Design**:
- `UserPool` construct with:
  - `selfSignUpEnabled: false` (admin-created accounts only)
  - `signInAliases: { email: true }`
  - `passwordPolicy`: minLength 8, requireUppercase, requireLowercase, requireDigits, requireSymbols
  - `mfa: Mfa.OPTIONAL` (enforced per-group via custom logic — required for admin at application level)
  - `mfaSecondFactor: { sms: false, otp: true }` (TOTP only — no SMS MFA cost)
  - `accountRecovery: AccountRecovery.EMAIL_ONLY`
  - `removalPolicy: RemovalPolicy.RETAIN`
- Custom attributes: `custom:tenantId` (String, immutable)
- User pool groups: `clerk`, `admin`, `super-admin`
- App client: `generateSecret: false` (SPA client), token validity (access: 1hr, refresh: 30d)
- No advanced security features (backlogged)

**Token Flow**:
- Frontend authenticates via Cognito Hosted UI or Amplify Auth
- Access token passed as `Authorization: Bearer <token>` header
- API Gateway Lambda authorizer validates JWT (signature, expiry, issuer, audience)
- Tenant context extracted from `custom:tenantId` claim

---

## Pattern 5: CloudWatch Observability (NFR-F-07, NFR-F-08)

**Pattern**: Basic alarms with unsubscribed SNS topic + 90-day log retention.

**CDK Design — SNS Topic**:
- `Topic` construct: `foundation-alarms`
- Zero subscriptions (add email pre-launch)
- Used as alarm action target

**CDK Design — Alarms**:
| Alarm | Metric Source | Statistic | Period | Threshold | Comparison |
|-------|--------------|-----------|--------|-----------|------------|
| DynamoDB Throttles | Table `ThrottledRequests` | Sum | 1 min | 0 | GreaterThanThreshold |
| S3 5xx Errors | Document bucket `5xxErrors` | Sum | 5 min | 0 | GreaterThanThreshold |
| Cognito Auth Failures | Custom metric via CloudWatch Logs metric filter on Cognito sign-in failures | Sum | 1 min | 10 | GreaterThanThreshold |

**CDK Design — Log Retention**:
- All Lambda log groups: `RetentionDays.THREE_MONTHS` (90 days)
- Set via `logRetention` property on `NodejsFunction` construct
- API Gateway access log group: 90-day retention (set explicitly on `LogGroup`)

**Cognito Auth Failure Metric**:
- Cognito doesn't natively publish a `SignInFailures` CloudWatch metric
- Implementation: CloudWatch Logs metric filter on Cognito user pool advanced security logs — but advanced security is disabled
- Alternative: Custom metric published by the Lambda authorizer on JWT validation failure (`AuthFailure` metric in custom namespace)
- The Lambda authorizer increments a CloudWatch custom metric on each 401 response → alarm watches this metric

---

## Pattern 6: SSM Cross-Stack Parameters (NFR-F-10)

**Pattern**: SSM Parameter Store for cross-stack output sharing.

**CDK Design**:
- `StringParameter` constructs for each output:

| Parameter Path | Value | Consumer |
|---------------|-------|----------|
| `/{env}/foundation/table-name` | DynamoDB table name | BackendStack |
| `/{env}/foundation/table-arn` | DynamoDB table ARN | BackendStack (IAM) |
| `/{env}/foundation/cognito-pool-id` | Cognito User Pool ID | BackendStack, FrontendStack |
| `/{env}/foundation/cognito-client-id` | Cognito App Client ID | FrontendStack |
| `/{env}/foundation/cognito-pool-arn` | Cognito User Pool ARN | BackendStack (IAM) |
| `/{env}/foundation/document-bucket-name` | Document S3 bucket name | BackendStack |
| `/{env}/foundation/document-bucket-arn` | Document S3 bucket ARN | BackendStack (IAM) |
| `/{env}/foundation/kb-bucket-name` | KB data source bucket name | BackendStack |
| `/{env}/foundation/kb-id` | Bedrock Knowledge Base ID | BackendStack |

- `{env}` prefix allows multiple environments in the same account (e.g., `dev`, `staging`)
- BackendStack and FrontendStack read these via `StringParameter.valueFromLookup()` at synth time

---

## Pattern 7: Encryption in Transit (NFR-F-10)

**Pattern**: TLS 1.2+ enforced on all data paths.

**Implementation**:
| Data Path | Enforcement |
|-----------|-------------|
| Client → API Gateway | API Gateway enforces TLS 1.2 by default |
| Lambda → DynamoDB | AWS SDK uses HTTPS by default |
| Lambda → S3 | AWS SDK uses HTTPS by default; bucket policy denies non-SSL |
| Lambda → Cognito | AWS SDK uses HTTPS by default |
| Lambda → Bedrock | AWS SDK uses HTTPS by default |
| Client → Cognito (auth) | Cognito hosted UI/endpoints are HTTPS-only |
| Client → S3 (presigned) | Presigned URLs use HTTPS |

No additional configuration needed — AWS SDK and managed services default to TLS 1.2+. The S3 bucket policy (`enforceSSL: true`) is the only explicit enforcement required.

---

## Pattern 8: Deployment (NFR-F-09)

**Pattern**: Manual CDK deploy with environment config.

**Implementation**:
- `deploy.sh` script: builds all packages, runs `cdk deploy --all` with environment context
- Environment config loaded from `.env` file (or environment variables)
- CDK context values: `env` (dev/staging/prod), `tenantId` (stlucie), `region`
- Resource names: CDK auto-generated (no hardcoded names); SSM paths use `/{env}/` prefix
- Stack ordering enforced by CDK dependencies (Foundation → Backend → Frontend)
- Rollback: `cdk deploy` with previous git commit

**cdk-nag Integration**:
- `Aspects.of(app).add(new AwsSolutionsChecks())` at app level
- `Aspects.of(app).add(new HIPAASecurityChecks())` at app level
- Suppressions documented inline with justification for each
- Runs at `cdk synth` — blocks deploy if non-suppressed findings exist
