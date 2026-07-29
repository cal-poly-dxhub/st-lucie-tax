/**
 * SEC-02: cold-start secret bootstrap.
 *
 * In the deployed Lambda, fetch the app-secrets JSON from AWS Secrets Manager
 * and write its keys into process.env BEFORE the Express app module evaluates.
 * This lets the existing module-load-time reads in auth/beta-auth.ts and
 * authid/client.ts (e.g. `const PASSWORD = process.env.BETA_PASSWORD ?? ''`)
 * see real values without any change to those modules — which is what keeps the
 * token-expiry and authid-client unit tests passing unchanged.
 *
 * Gating: this is a NO-OP everywhere except the deployed Lambda. It fetches only
 * when BOTH `AWS_LAMBDA_FUNCTION_NAME` (the in-Lambda signal also used by
 * knowledge-base/query.ts) and `SECRETS_ARN` (injected by the CDK stack) are
 * present. Local dev (.env / dotenv) and unit tests (which set process.env
 * before import) fall straight through, untouched.
 *
 * Fail-closed: if we ARE in the Lambda with an ARN but the auth credentials come
 * back empty, throw rather than boot with auth silently disabled — refusing to
 * serve is the correct failure mode for a security gate.
 *
 * The SecretsManagerClient is created lazily and the load is memoized, mirroring
 * the cached-singleton pattern in packages/data-access/src/client.ts and the
 * cachedToken memoization in authid/client.ts.
 */
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// Keys we accept from the secret JSON; anything else is ignored.
const EXPECTED_KEYS = [
  'BETA_PASSWORD',
  'BETA_AUTH_SECRET',
  'AUTHID_API_KEY_ID',
  'AUTHID_API_KEY_VALUE',
] as const;

let loaded: Promise<void> | null = null;

/**
 * Idempotent per process. Resolves once the secrets are in process.env (or
 * immediately, as a no-op, outside the Lambda).
 */
export function loadSecretsIntoEnv(): Promise<void> {
  if (!loaded) {
    // Reset on failure so a transient Secrets Manager error doesn't permanently
    // wedge a warm container — the next call retries a fresh fetch.
    loaded = doLoad().catch((err) => {
      loaded = null;
      throw err;
    });
  }
  return loaded;
}

async function doLoad(): Promise<void> {
  const arn = process.env.SECRETS_ARN;
  // Only fetch inside the Lambda AND when an ARN was injected. Otherwise fall
  // through to the existing .env / process.env behavior unchanged.
  if (!process.env.AWS_LAMBDA_FUNCTION_NAME || !arn) return;

  const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const res = await client.send(new GetSecretValueCommand({ SecretId: arn }));
  if (!res.SecretString) {
    throw new Error('SEC-02: secret has no SecretString');
  }

  const parsed = JSON.parse(res.SecretString) as Record<string, unknown>;
  for (const key of EXPECTED_KEYS) {
    const v = parsed[key];
    // Don't clobber an explicitly-set env var (allows an emergency override),
    // but otherwise inject the secret value.
    if (typeof v === 'string' && v.length > 0 && !process.env[key]) {
      process.env[key] = v;
    }
  }

  // Fail closed: in-Lambda with an ARN but auth creds missing → refuse to start
  // rather than run with auth silently disabled.
  if (!process.env.BETA_PASSWORD || !process.env.BETA_AUTH_SECRET) {
    throw new Error(
      'SEC-02: BETA_PASSWORD/BETA_AUTH_SECRET missing after secret load — refusing to start with auth disabled',
    );
  }
}
