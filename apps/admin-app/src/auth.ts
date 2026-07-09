import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

interface RuntimeConfig {
  userPoolId: string;
  userPoolClientId: string;
  adminApiUrl: string;
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
}

export async function getIdToken(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.idToken ?? null;
}
