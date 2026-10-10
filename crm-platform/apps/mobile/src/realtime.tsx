import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { API_BASE, getSession } from './api';
import { useAuth } from './auth';

/** Events are hints, not data: the REST read is the truth, so each one just refreshes the affected queries. */
const EVENTS = ['inbox.conversation.upsert', 'inbox.message.new', 'inbox.message.status', 'inbox.unread', 'inbox.assignment'] as const;

const Ctx = createContext<{ joinConversation: (id: string) => () => void }>({ joinConversation: () => () => {} });
export const useRealtime = () => useContext(Ctx);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const socket = useRef<Socket | null>(null);
  const joined = useRef(new Map<string, number>());

  useEffect(() => {
    if (!session) return;
    // Token comes from the session store on every (re)connect, so a refreshed token is used.
    const s = io(`${API_BASE}/realtime`, {
      transports: ['websocket'],
      auth: (cb) => cb({ token: getSession()?.accessToken }),
      reconnectionDelayMax: 10000,
    });
    socket.current = s;
    const rejoin = () => {
      s.emit('room:join', { kind: 'inbox', scope: 'all' });
      for (const id of joined.current.keys()) s.emit('room:join', { kind: 'conv', id });
      // Catch up on anything missed while offline.
      qc.invalidateQueries();
    };
    s.on('connect', rejoin);
    for (const e of EVENTS)
      s.on(e, (p: { conversationId?: string }) => {
        qc.invalidateQueries({ queryKey: ['inbox'] });
        if (p?.conversationId) {
          qc.invalidateQueries({ queryKey: ['thread', p.conversationId] });
          qc.invalidateQueries({ queryKey: ['conv', p.conversationId] });
        }
      });
    return () => {
      s.disconnect();
      socket.current = null;
    };
  }, [!!session]);

  const joinConversation = (id: string) => {
    joined.current.set(id, (joined.current.get(id) ?? 0) + 1);
    socket.current?.emit('room:join', { kind: 'conv', id });
    return () => {
      const n = (joined.current.get(id) ?? 1) - 1;
      if (n <= 0) {
        joined.current.delete(id);
        socket.current?.emit('room:leave', { kind: 'conv', id });
      } else joined.current.set(id, n);
    };
  };

  return <Ctx.Provider value={{ joinConversation }}>{children}</Ctx.Provider>;
}
