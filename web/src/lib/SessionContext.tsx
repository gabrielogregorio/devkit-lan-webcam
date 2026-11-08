import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SessionStore, type SessionSnapshot } from '@/lib/sessionStore';

const SessionContext = createContext<SessionStore | null>(null);

interface SessionProviderProps {
  store?: SessionStore;
  children: ReactNode;
}

// One encrypted session per tab, shared by every page.
export function SessionProvider({ store, children }: Readonly<SessionProviderProps>): ReactNode {
  const [sessionStore] = useState(() => store ?? new SessionStore());

  useEffect(() => {
    sessionStore.start();

    return () => sessionStore.stop();
  }, [sessionStore]);

  return <SessionContext.Provider value={sessionStore}>{children}</SessionContext.Provider>;
}

export function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (!store) {
    throw new Error('useSessionStore outside SessionProvider');
  }

  return store;
}

export function useSession(): SessionSnapshot {
  const store = useSessionStore();

  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
