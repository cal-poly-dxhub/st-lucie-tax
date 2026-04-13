# Functional Design Plan — Unit 1: Foundation

## Unit Scope
Unit 1 covers shared infrastructure, data layer, auth, and dev tooling:
- SI-02 — Auth & Tenant Context (Cognito User Pool + API Gateway Authorizer)
- SI-03 — Data Access Layer (shared TypeScript module)
- DynamoDB single table + GSI1
- Cognito User Pool + App Client
- S3 buckets (document upload, data source for Bedrock KB)
- Bedrock Knowledge Base
- SSM Parameters for cross-stack outputs
- Dev tooling (TypeScript project refs, ESLint, Prettier, Husky, cdk-nag, deploy script)

## Plan Steps

### Domain Entities & Data Model
- [x] Step 1: Define all DynamoDB entity schemas with full attribute lists, types, and constraints
- [x] Step 2: Define GSI projected attributes and access pattern catalog
- [x] Step 3: Define TTL policies and data lifecycle rules per entity type
- [x] Step 4: Define global vs. tenant config resolution rules and seed data structure

### SI-03 — Data Access Layer Business Logic
- [x] Step 5: Define tenant-prefixed key construction rules and validation
- [x] Step 6: Define optimistic concurrency control patterns (condition expressions, retry logic)
- [x] Step 7: Define config resolution algorithm (tenant override → global fallback)
- [x] Step 8: Define error handling taxonomy for data access failures

### SI-02 — Auth & Tenant Context Business Logic
- [x] Step 9: Define Cognito user pool attributes, groups, and password policy
- [x] Step 10: Define JWT claims structure and tenant extraction logic
- [x] Step 11: Define role-based access control rules (clerk, admin, super-admin)
- [x] Step 12: Define public vs. protected endpoint classification rules

### Cross-Cutting Business Rules
- [x] Step 13: Define input validation rules for all Foundation-layer operations
- [x] Step 14: Define structured logging standards and correlation ID propagation
- [x] Step 15: Define error response format and fail-safe defaults

## Questions
See `aidlc-docs/construction/foundation-functional-design-questions.md`
