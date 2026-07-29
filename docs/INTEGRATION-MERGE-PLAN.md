
## INFRA — critical deploy-phase findings (2026-07-29, during port)

Integration's CDK app is DIFFERENT from our fork's and must be patched, not file-ported:
- Stacks: `infra/lib/chatbot-stack.ts` (ChatbotStack "Chatbot") + `infra/lib/back-office-stack.ts`
  (BackOfficeStack "BackOffice"), wired in `infra/bin/app.ts`. Deploy = `cdk deploy Chatbot`/`BackOffice`
  (+ `scripts/build-frontends.sh` predeploy targeting stack "Chatbot"). Backend = Postgres (PG*) + Cognito.
- Our fork's `infra/backend-stack.ts` + `infra/admin-stack.ts` (BackendStack/AdminStack, DynamoDB + SEC-02
  Secrets Manager) are ORPHANS here — bin/app.ts never imports them. REMOVED from the port (were wrongly
  added by Phase-A). Our `infra/DEPLOY.md` describes OUR stacks (StLucieFoundation/Backend/Frontend/Security)
  and is INACCURATE for integration — do NOT follow it; replace or delete before ship.

TARGETED PATCH required to `infra/lib/chatbot-stack.ts` for our doc-upload feature to work at runtime:
1. Add to the Lambda `environment:` block (~line 227):
   BEDROCK_VISION_MODEL_ID: "us.anthropic.claude-haiku-4-5-20251001-v1:0"
   BEDROCK_VISION_REGION: "us-east-2"        # Haiku access not enabled in us-east-1 in this acct
   DOC_VALIDATION_REJECT_THRESHOLD: "0.85"
   DOC_VALIDATION_EXPIRY_ENABLED: "true"
2. Add to the Bedrock IAM policy (~line 318, currently only Sonnet-4 inference-profile) the Haiku vision ARNs:
   arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-*
   arn:aws:bedrock:*:<account>:inference-profile/us.anthropic.claude-haiku-4-5-*
   (else validate-document.ts 403s at runtime)
NOTE: integration passes AUTHID_API_KEY_VALUE as a plaintext env var (NOT our SEC-02 Secrets Manager). Our
ported authid CODE reads config the same way regardless; do not force SEC-02 here — keep integration's model.
