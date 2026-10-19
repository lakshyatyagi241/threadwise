import { REALTIME_NAMESPACE } from '@crm/contracts';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { env } from '@/config/env';
import { RealtimeClient, type SocketFactory } from './realtime-client';
import { createIoSocket } from './socket-factory';
import { mintRealtimeTicket } from './ticket';

/**
 * Holds the connection outside React state: the client is made in an effect, and everything under the provider reads it through
 * `useSyncExternalStore` (see `hooks.ts`), so there is no state update inside the effect.
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

/** How long the app must have been in the background before coming back counts as "might have missed something". */
const FOREGROUND_AFTER_MS = 20_000;

/** The socket address: the API's origin and the realtime namespace. */
export const realtimeUrl = (): string => `${env.apiUrl}${REALTIME_NAMESPACE}`;

export interface RealtimeProviderProps {
  children: ReactNode;
  /** Replaceable in tests. */
  url?: string;
  mintTicket?: () => Promise<string>;
  createSocket?: SocketFactory;
}

/**
 * One realtime connection for the signed-in session, shared by everything under it. Mount it once, inside the signed-in layout, so
 * signing out (which unmounts that layout) closes the socket and a different person starts a new one with their own ticket.
 *
 * A phone suspends sockets in the background, so coming back after a while reconnects at once (if it dropped) and asks the screens to
 * read again (if it did not).
 */
export function RealtimeProvider({
  children,
  url = realtimeUrl(),
  mintTicket = mintRealtimeTicket,
  createSocket = createIoSocket,
}: RealtimeProviderProps) {
  const [holder] = useState(() => new ClientHolder());

  useEffect(() => {
    const next = new RealtimeClient({ url, mintTicket, createSocket });
    holder.set(next);
    // Started on the next tick: in development React mounts, unmounts and mounts again at once, and a connection begun in the first
    // pass would spend a ticket on a client that is thrown away a moment later.
    const starting = setTimeout(() => next.start(), 0);

    let leftAt: number | null = null;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        const away = leftAt === null ? 0 : Date.now() - leftAt;
        leftAt = null;
        if (away >= FOREGROUND_AFTER_MS) next.notifyForeground();
      } else if (leftAt === null) {
        leftAt = Date.now();
      }
    });

    return () => {
      clearTimeout(starting);
      subscription.remove();
      next.stop();
      holder.set(null);
    };
  }, [holder, url, mintTicket, createSocket]);

  return <RealtimeContext.Provider value={holder}>{children}</RealtimeContext.Provider>;
}

/** The holder of the connection, for the hooks. */
export const useRealtimeHolder = (): ClientHolder => useContext(RealtimeContext);
