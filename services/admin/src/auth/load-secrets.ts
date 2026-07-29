/**
 * SEC-02: cold-start secret bootstrap (admin service).
 *
 * In the deployed Lambda, fetch the admin app-secrets JSON from AWS Secrets
 * Manager and write its keys into process.env BEFORE the Express app module
 * evaluates, so the module-load-time reads in auth/admin-auth.ts
 * (`const PASSWORD = process.env.ADMIN_PASSWORD ?? ''`) see real values without
 * any change to that module.
 *
 * Gating: NO-OP everywhere except the deployed Lambda — fetches only when BOTH
 * `AWS_LAMBDA_FUNCTION_NAME` and `SECRETS_ARN` are present. Local dev and unit
 * tests fall straight through.
 *
 * Fail-closed: in-Lambda with an ARN but admin credentials empty → throw rather
 * than boot with auth silently disabled.
 *
 * The admin service has its OWN secret (stlucie/admin/app-secrets), separate
 * from the chatbot's, so the admin role never gains read access to the
 * chatbot's AuthID keys. The historical "admin falls back to BETA creds"
 * behavior is resolved at populate time (BETA values written into this secret
 * when there are no dedicated admin credentials).
 */
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const EXPECTED_KEYS = ["ADMIN_PASSWORD", "ADMIN_AUTH_SECRET"] as const;

let loaded: Promise<void> | null = null;

export function loadSecretsIntoEnv(): Promise<void> {
  if (!loaded) {
    loaded = doLoad().catch((err) => {
      loaded = null;
      throw err;
    });
  }
  return loaded;
}

async function doLoad(): Promise<void> {
  const arn = process.env.SECRETS_ARN;
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !arn) return;

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) {
    throw new Error("SEC-02: admin secret has no SecretString");
  }

  const parsed = JSON.parse(res.SecretString) as Record<string, unknown>;
  for (const key of EXPECTED_KEYS) {
    const v = parsed[key];
    if (typeof v === "string" && v.length > 0 && !process.env[key]) {
      process.env[key] = v;
    }
  }

  if (!process.env.ADMIN_PASSWORD || !process.env.ADMIN_AUTH_SECRET) {
    throw new Error(
      "SEC-02: ADMIN_PASSWORD/ADMIN_AUTH_SECRET missing after secret load — refusing to start with auth disabled",
    );
  }
}
