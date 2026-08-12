# Security Policy

This project is a proof-of-concept reference implementation published by the
Cal Poly DxHub. It is provided as-is (see [`LICENSE`](LICENSE)) and is not a
supported production service.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not open a public GitHub
issue.** Instead, report it privately using GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
for this repository (Security → Report a vulnerability), or contact the Cal Poly
DxHub through https://dxhub.calpoly.edu.

Please include:

- A description of the issue and its potential impact.
- Steps to reproduce (proof-of-concept, affected files/endpoints).
- Any suggested remediation.

We will acknowledge receipt as soon as practical for a research project of this
nature. Because this is a reference implementation rather than a hosted service,
there is no formal SLA.

## Scope Notes for Deployers

If you deploy this project, you are responsible for the security posture of your
own AWS account. Before any non-demo use, review at least:

- **IAM** — least-privilege on all roles; the S3 Vectors custom-resource policies
  and any `resources: ["*"]` grants.
- **Cognito** — enable MFA and advanced security; raise the password policy.
- **Encryption & logging** — S3/CloudFront access logging and SQS encryption.
- **Removal policies** — the demo defaults (`RemovalPolicy.DESTROY`,
  `autoDeleteObjects`, `deletionProtection: false`) are for throwaway
  environments; switch to `RETAIN` + deletion protection for anything you care
  about.
- **Secrets** — never commit real secrets. `.env`, `cdk.out/`, and
  `scripts/livetest/` are gitignored; keep them that way. Rotate any credential
  that has ever been committed.
- **Identity verification** — `AUTHID_MISSING_SIGNAL_OUTCOME` controls the
  fail-open/closed posture; understand it before deploying an identity flow.
