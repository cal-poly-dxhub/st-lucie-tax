import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  authConfigured,
  getCurrentUser,
  signIn as doSignIn,
  signOut as doSignOut,
  type AuthUser,
} from "./auth";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const DEV_USER: AuthUser = {
  email: "dev@localhost",
  groups: ["admin", "checkin_clerk", "service_clerk"],
  idToken: "",
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const configured = await authConfigured();
      if (!configured) {
        setUser(DEV_USER);
        setLoading(false);
        return;
      }
      const current = await getCurrentUser();
      setUser(current);
      setLoading(false);
    })();
  }, []);

  async function signIn(email: string, password: string) {
    const u = await doSignIn(email, password);
    setUser(u);
  }

  function signOut() {
    doSignOut();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
}
