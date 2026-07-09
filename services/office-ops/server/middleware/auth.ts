import type { Request, Response, NextFunction } from "express";

export interface CognitoClaims {
  sub: string;
  "cognito:groups"?: string[];
  email?: string;
}

declare module "express-serve-static-core" {
  interface Request {
    user?: CognitoClaims;
  }
}

const isDev = process.env.DEV_AUTH_BYPASS === "true";
if (isDev && process.env.NODE_ENV === "production") {
  throw new Error("DEV_AUTH_BYPASS must not be set in production");
}

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;

let verifier: { verify: (token: string) => Promise<CognitoClaims> } | null = null;

async function getVerifier() {
  if (verifier) return verifier;
  const { CognitoJwtVerifier } = await import("aws-jwt-verify");
  verifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID!,
    tokenUse: "id",
    clientId: CLIENT_ID!,
  });
  return verifier;
}

function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  return authHeader.slice(7);
}

export function requireAuth(...allowedGroups: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (isDev) {
      req.user = { sub: "dev-user", "cognito:groups": ["admin", "checkin_clerk", "service_clerk"] };
      return next();
    }

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!USER_POOL_ID || !CLIENT_ID) {
      console.error("COGNITO_USER_POOL_ID or COGNITO_CLIENT_ID not configured");
      return res.status(500).json({ error: "Internal server error" });
    }

    try {
      const v = await getVerifier();
      const claims = (await v.verify(token)) as CognitoClaims;
      req.user = claims;

      if (allowedGroups.length > 0) {
        const userGroups = claims["cognito:groups"] ?? [];
        const hasGroup = allowedGroups.some((g) => userGroups.includes(g));
        if (!hasGroup) {
          return res.status(403).json({ error: "Insufficient permissions" });
        }
      }

      next();
    } catch {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
  };
}
