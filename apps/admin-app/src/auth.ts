import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

interface RuntimeConfig {
  userPoolId: string;
  userPoolClientId: string;
  /** Chatbot-stack AdminFn — session review. */
  adminApiUrl: string;
  /** Office-ops API — the /ops-admin/* configuration routes live here. */
  apiUrl: string;
}

let configCache: RuntimeConfig | null = null;

export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  if (configCache) return configCache;
  try {
    const res = await fetch("/config.json");
    if (res.ok) {
      configCache = await res.json();
      return configCache!;
    }
  } catch {
    // Local dev fallback
  }
  configCache = {
    userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "",
    userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? "",
    adminApiUrl: import.meta.env.VITE_API_URL ?? "",
    // Vite proxies /api to the office-ops backend in dev.
    apiUrl: import.meta.env.VITE_OPS_API_URL ?? "/api",
  };
  return configCache;
}

let pool: CognitoUserPool | null = null;

async function getPool(): Promise<CognitoUserPool> {
  if (pool) return pool;
  const config = await getRuntimeConfig();
  pool = new CognitoUserPool({
    UserPoolId: config.userPoolId,
    ClientId: config.userPoolClientId,
  });
  return pool;
}

export interface AuthUser {
  email: string;
  groups: string[];
  idToken: string;
}

function parseIdToken(session: CognitoUserSession): AuthUser {
  const payload = session.getIdToken().decodePayload();
  return {
    email: (payload.email as string) ?? "",
    groups: (payload["cognito:groups"] as string[]) ?? [],
    idToken: session.getIdToken().getJwtToken(),
  };
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const p = await getPool();
  const cognitoUser = p.getCurrentUser();
  if (!cognitoUser) return null;
  return new Promise((resolve) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
      } else {
        const user = parseIdToken(session);
        if (!user.groups.includes("admin")) {
          resolve(null);
        } else {
          resolve(user);
        }
      }
    });
  });
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const p = await getPool();
  const user = new CognitoUser({ Username: email, Pool: p });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => {
        const authUser = parseIdToken(session);
        if (!authUser.groups.includes("admin")) {
          reject(new Error("NOT_ADMIN"));
        } else {
          resolve(authUser);
        }
      },
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(new Error("NEW_PASSWORD_REQUIRED"));
      },
    });
  });
}

export async function signOut(): Promise<void> {
  const p = await getPool();
  const user = p.getCurrentUser();
  if (user) user.signOut();
  clearTokenCache();
}

// A dashboard tab can fire a dozen requests at once, and each one needs a
// bearer token. Cache the JWT and reuse it until it is close to expiring, so a
// burst of requests costs one session read instead of one per request. In-flight
// refreshes are shared so a burst on a cold cache also collapses to one read.
let tokenCache: { token: string; expiresAtMs: number } | null = null;
let tokenInFlight: Promise<string | null> | null = null;
const TOKEN_SKEW_MS = 60_000;

function readExp(jwt: string): number {
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1] ?? ""));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

export async function getIdToken(): Promise<string | null> {
  if (tokenCache && Date.now() < tokenCache.expiresAtMs - TOKEN_SKEW_MS) {
    return tokenCache.token;
  }
  if (tokenInFlight) return tokenInFlight;

  tokenInFlight = getCurrentUser()
    .then((u) => {
      if (!u) {
        tokenCache = null;
        return null;
      }
      tokenCache = { token: u.idToken, expiresAtMs: readExp(u.idToken) };
      return u.idToken;
    })
    .finally(() => {
      tokenInFlight = null;
    });

  return tokenInFlight;
}

/** Drop the cached token — call on sign-out so the next read re-authenticates. */
export function clearTokenCache(): void {
  tokenCache = null;
  tokenInFlight = null;
}
