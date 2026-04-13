# NFR Requirements — Unit 1: Foundation

## Overview
Non-functional requirements for the Foundation unit covering DynamoDB, S3, Cognito, observability, deployment, and cross-cutting infrastructure concerns.

---

## NFR-F-01: DynamoDB Capacity

**Requirement**: On-demand billing mode (`PAY_PER_REQUEST`).

**Rationale**: MVP traffic (~50 concurrent users, ~72 clerks, single county) is low and unpredictable. On-demand eliminates capacity planning, scales from zero, and has negligible cost at this volume. Switch to provisioned with auto-scaling if multi-county scale demands it.

**Configuration**:
| Setting | Value |
|---------|-------|
| Billing mode | `PAY_PER_REQUEST` |
| Auto-scaling | N/A (on-demand) |
| Throttling mitigation | None needed — on-demand scales automatically |

---

## NFR-F-02: DynamoDB Backup & Recovery

**Requirement**: Point-in-time recovery (PITR) enabled on the single table.

**Rationale**: Single table contains all tenant data, customer records, and appointments. PITR provides continuous backups with restore-to-any-second for 35 days at ~$0.20/GB/month. Essential for a government system handling PII.

**Configuration**:
| Setting | Value |
|---------|-------|
| PITR | Enabled |
| Retention | 35 days (AWS default, not configurable) |
| On-demand backups | Not configured (PITR sufficient for MVP) |

---

## NFR-F-03: S3 Document Bucket Encryption

**Requirement**: SSE-S3 (AES-256, AWS-managed keys) on the document upload bucket.

**Rationale**: Meets SECURITY-01 encryption-at-rest requirement. SSE-KMS adds CloudTrail key usage logging but is unnecessary for MVP — S3 access logging and CloudTrail data events provide sufficient access visibility. Upgrade to SSE-KMS if compliance audit requires key-level auditing.

**Configuration**:
| Setting | Value |
|---------|-------|
| Encryption | SSE-S3 (AES-256) |
| Bucket policy | Enforce `aws:SecureTransport` (TLS in transit) |
| Key management | None (AWS-managed) |

---

## NFR-F-04: S3 Document Bucket Versioning

**Requirement**: Versioning disabled on the document upload bucket.

**Rationale**: Documents are write-once (uploaded → OCR processed → deleted by 30-day lifecycle). No update-in-place scenario exists. Versioning would accumulate delete markers with no benefit.

**Configuration**:
| Setting | Value |
|---------|-------|
| Versioning | Disabled |
| Lifecycle | 35-day expiration (backstop for TTL cleanup) |

---

## NFR-F-05: S3 Bedrock KB Bucket

**Requirement**: SSE-S3 encryption, versioning disabled. This bucket holds tcslc.com content for the Bedrock Knowledge Base.

**Rationale**: Non-PII content (public website data). SSE-S3 meets encryption-at-rest. No versioning needed — content is replaced on sync.

**Configuration**:
| Setting | Value |
|---------|-------|
| Encryption | SSE-S3 (AES-256) |
| Versioning | Disabled |
| Public access | Blocked |

---

## NFR-F-06: Cognito Security

**Requirement**: Standard Cognito security features only. Advanced security (adaptive auth, compromised credential detection) disabled for MVP.

**Rationale**: Standard Cognito provides password policy enforcement (8+ chars, uppercase + lowercase + number + special), account lockout after repeated failures, and MFA support — satisfying SECURITY-12. Advanced security adds risk-based adaptive challenges at $0.050/MAU but is unnecessary at MVP scale (~72 users). Backlog for pre-launch hardening.

**Configuration**:
| Setting | Value |
|---------|-------|
| Advanced security | Disabled |
| Password policy | 8+ chars, upper + lower + number + special |
| MFA | Optional for clerks, required for admins |
| Account lockout | Cognito built-in (5 failed attempts) |
| Brute-force protection | Cognito built-in |

**Backlog**: Enable advanced security in audit-only mode before go-live.

---

## NFR-F-07: CloudWatch Alarms

**Requirement**: Basic alarms with SNS topic (zero subscribers initially).

**Rationale**: Satisfies SECURITY-14 (alerts configured for security events) without generating inbox noise during development. SNS topic exists as the notification hub — add email subscribers pre-launch.

**Alarms**:
| Alarm | Metric | Threshold | Period |
|-------|--------|-----------|--------|
| DynamoDB Throttles | `ThrottledRequests` | > 0 | 1 minute |
| S3 5xx Errors | `5xxErrors` | > 0 | 5 minutes |
| Cognito Auth Failures | `SignInFailures` | > 10 | 1 minute |

**Configuration**:
| Setting | Value |
|---------|-------|
| SNS topic | Created, zero subscribers |
| Alarm actions | SNS topic ARN |
| OK actions | SNS topic ARN |

**Backlog**: Add email subscription(s) to SNS topic before go-live.

---

## NFR-F-08: CloudWatch Log Retention

**Requirement**: 90-day retention on all Foundation log groups.

**Rationale**: Meets SECURITY-14 minimum (90 days). Logs serve operational debugging and security investigation — long-term compliance is handled by DynamoDB data retention (3 years). Longer retention is cost-prohibitive with minimal benefit.

**Configuration**:
| Setting | Value |
|---------|-------|
| Retention | 90 days |
| Applies to | All Lambda log groups, API Gateway access logs |

---

## NFR-F-09: Deployment Strategy

**Requirement**: Direct `cdk deploy` for MVP. CDK Pipelines backlogged for production.

**Rationale**: CDK Pipelines (CodePipeline + approval gates) is the production-grade answer but requires meaningful setup time. Direct `cdk deploy` gets the team moving immediately. Backlog CI/CD for the pre-launch hardening sprint.

**Configuration**:
| Setting | Value |
|---------|-------|
| Deploy method | `cdk deploy` (manual) |
| Rollback | Manual (`cdk deploy` with previous version) |
| Environments | Single (dev/staging combined for MVP) |

**Backlog**: CDK Pipelines with approval gates before go-live.

---

## NFR-F-10: Encryption in Transit

**Requirement**: TLS 1.2+ enforced on all data movement (SECURITY-01).

**Configuration**:
| Resource | Enforcement |
|----------|-------------|
| API Gateway | TLS 1.2 (default, AWS-managed) |
| DynamoDB | TLS 1.2 (AWS SDK default) |
| S3 | Bucket policy denying `aws:SecureTransport = false` |
| Cognito | TLS 1.2 (default, AWS-managed) |
| Bedrock | TLS 1.2 (AWS SDK default) |

---

## NFR-F-11: S3 Public Access

**Requirement**: Block all public access on both S3 buckets (SECURITY-09).

**Configuration**:
| Setting | Value |
|---------|-------|
| BlockPublicAcls | true |
| BlockPublicPolicy | true |
| IgnorePublicAcls | true |
| RestrictPublicBuckets | true |

---

## Pre-Launch Backlog

Items deferred from MVP that must be addressed before production go-live:

| Item | NFR Reference | Priority |
|------|---------------|----------|
| Cognito advanced security (audit-only mode) | NFR-F-06 | High |
| SNS alarm subscribers (email) | NFR-F-07 | High |
| CDK Pipelines CI/CD | NFR-F-09 | High |
| Evaluate SSE-KMS upgrade for document bucket | NFR-F-03 | Medium |
