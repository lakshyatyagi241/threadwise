import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, loadSession, saveSession, setOnSessionExpired, getSession, type Session } from './api';

type Ctx = { ready: boolean; session: Session | null; signedIn: (s: Session) => Promise<void>; signOut: () => Promise<void> };
const AuthCtx = createContext<Ctx>(null!);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setOnSessionExpired(() => setSession(null));
    loadSession().then((s) => {
      setSession(s);
      setReady(true);
    });
  }, []);

  const signedIn = async (s: Session) => {
    await saveSession(s);
    setSession(s);
  };
  const signOut = async () => {
    const s = getSession();
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken: s?.refreshToken } });
    } catch {}
    await saveSession(null);
    setSession(null);
  };

  return <AuthCtx.Provider value={{ ready, session, signedIn, signOut }}>{children}</AuthCtx.Provider>;
}
