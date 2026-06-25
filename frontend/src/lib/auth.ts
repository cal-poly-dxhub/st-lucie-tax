import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from "amazon-cognito-identity-js";

const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID ?? "";
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID ?? "";

export const authConfigured = !!(USER_POOL_ID && CLIENT_ID);

const pool = authConfigured
  ? new CognitoUserPool({ UserPoolId: USER_POOL_ID, ClientId: CLIENT_ID })
  : null;

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

export function getCurrentUser(): Promise<AuthUser | null> {
  if (!pool) return Promise.resolve(null);
  const cognitoUser = pool.getCurrentUser();
  if (!cognitoUser) return Promise.resolve(null);
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

export function signIn(email: string, password: string): Promise<AuthUser> {
  if (!pool) return Promise.reject(new Error("Cognito not configured"));
  const user = new CognitoUser({ Username: email, Pool: pool });
  const authDetails = new AuthenticationDetails({ Username: email, Password: password });
  return new Promise((resolve, reject) => {
    user.authenticateUser(authDetails, {
      onSuccess: (session) => resolve(parseIdToken(session)),
      onFailure: (err) => reject(err),
      newPasswordRequired: (_userAttributes) => {
        reject(new Error("NEW_PASSWORD_REQUIRED"));
      },
    });
  });
}

export function signOut(): void {
  if (!pool) return;
  const user = pool.getCurrentUser();
  if (user) user.signOut();
}

export function getIdToken(): Promise<string | null> {
  return getCurrentUser().then((u) => u?.idToken ?? null);
}
