'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { RealtimeClient, type SocketFactory } from './realtime-client';
import { createIoSocket } from './socket-factory';
import { mintRealtimeTicket } from './ticket';

/**
 * Holds the connection outside React state: the client is created in an effect (never on the server), and everything under the
 * provider reads it through `useSyncExternalStore`, so there is no state update inside the effect and no hydration difference.
 */
class ClientHolder {
  private client: RealtimeClient | null = null;
  private readonly listeners = new Set<() => void>();

  readonly get = () => this.client;

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(client: RealtimeClient | null) {
    this.client = client;
    for (const l of [...this.listeners]) l();
  }
}

const NO_HOLDER = new ClientHolder();
const RealtimeContext = createContext<ClientHolder>(NO_HOLDER);

/** How long a tab must have been hidden before coming back counts as "might have missed something". */
const FOREGROUND_AFTER_MS = 30_000;

export interface RealtimeProviderProps {
  /** The socket address (`.../realtime`). Without one the provider is inert: nothing connects and every hook reports `idle`. */
  url?: string;
  children: ReactNode;
  /** Replaceable in tests. */
  mintTicket?: () => Promise<string>;
  createSocket?: SocketFactory;
}

/**
 * One realtime connection for the signed-in session, shared by everything under it.
 *
 * Nothing happens during server rendering or the first client render: the client is created in an effect, so there is no
 * `window` access and no hydration difference. Mount it once, inside the session provider; give it a `key` that changes with the
 * session (user, workspace) so a switch starts a fresh connection with the new person's ticket.
 */
export function RealtimeProvider({
  url,
  children,
  mintTicket = mintRealtimeTicket,
  createSocket = createIoSocket,
}: RealtimeProviderProps) {
  const [holder] = useState(() => new ClientHolder());

  useEffect(() => {
    if (!url) return;
    const next = new RealtimeClient({ url, mintTicket, createSocket });
    holder.set(next);
    // Started on the next tick, not now: in development React mounts, unmounts and mounts again at once, and a connection begun
    // in the first pass would spend a ticket (and a rate-limit hit) on a client that is thrown away a moment later.
    const starting = setTimeout(() => next.start(), 0);

    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (hiddenAt !== null && Date.now() - hiddenAt >= FOREGROUND_AFTER_MS) {
        hiddenAt = null;
        next.notifyForeground();
      }
    };
    const onOnline = () => next.notifyForeground();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
      clearTimeout(starting);
      next.stop();
      holder.set(null);
    };
    // The connection belongs to the url; the factories are fixed for the life of the provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, holder]);

  return <RealtimeContext.Provider value={holder}>{children}</RealtimeContext.Provider>;
}

/** The connection, or null on the server, before it is created, or without a provider. */
export function useRealtimeClient(): RealtimeClient | null {
  const holder = useContext(RealtimeContext);
  return useSyncExternalStore(holder.subscribe, holder.get, () => null);
}
