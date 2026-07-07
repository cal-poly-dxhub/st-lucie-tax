import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";
import { getRuntimeConfig } from "./runtime-config";

let pool: CognitoUserPool | null = null;
let _configured: boolean | null = null;

async function getPool(): Promise<CognitoUserPool | null> {
  if (_configured !== null) return pool;
  const config = await getRuntimeConfig();
  if (config.userPoolId && config.userPoolClientId) {
    pool = new CognitoUserPool({
      UserPoolId: config.userPoolId,
      ClientId: config.userPoolClientId,
    });
    _configured = true;
  } else {
    _configured = false;
  }
  return pool;
}

export async function authConfigured(): Promise<boolean> {
  await getPool();
  return _configured!;
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
  if (!p) return null;
  const cognitoUser = p.getCurrentUser();
  if (!cognitoUser) return null;
  return new Promise((resolve) => {
    cognitoUser.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) {
        resolve(null);
      } else {
        resolve(parseIdToken(session));
      }
    });
  });
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const p = await getPool();
  if (!p) throw new Error("Cognito not configured");
  const user = new CognitoUser({ Username: email, Pool: p });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(parseIdToken(session)),
      onFailure: (err) => reject(err),
      newPasswordRequired: () => {
        reject(new Error("NEW_PASSWORD_REQUIRED"));
      },
    });
  });
}

export async function signOut(): Promise<void> {
  const p = await getPool();
  if (!p) return;
  const user = p.getCurrentUser();
  if (user) user.signOut();
}

export async function getIdToken(): Promise<string | null> {
  const u = await getCurrentUser();
  return u?.idToken ?? null;
}
