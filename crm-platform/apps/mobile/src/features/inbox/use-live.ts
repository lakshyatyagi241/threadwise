import { REALTIME_EVENT, realtimeRoomKey } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeEvent, useRealtimeStatus, useResync, useRoom } from '@/lib/realtime';
import { detailKey, listKey, messagesKey } from './use-inbox';
import { eventsKey, notesKey } from './use-notes';

/**
 * The live side of the inbox. The server pushes hints (an id, a version, what changed), never the data: each hint makes the screen
 * read the row again through REST, where the person's scope applies. While the connection is up the timers that polled for news stop;
 * if it drops, or the person may not join the room, they start again by themselves (the screens poll while `live` is false).
 */

/** The conversation list: told about any change to a conversation the person may see, on their own room (no join needed). */
export function useInboxLive(): boolean {
  const queryClient = useQueryClient();
  const status = useRealtimeStatus();

  const readList = () => queryClient.invalidateQueries({ queryKey: listKey });
  const readOne = (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: listKey }),
      queryClient.invalidateQueries({ queryKey: detailKey(id) }),
      queryClient.invalidateQueries({ queryKey: notesKey(id) }),
      queryClient.invalidateQueries({ queryKey: eventsKey(id) }),
    ]);

  useRealtimeEvent(
    REALTIME_EVENT.conversationUpsert,
    (e) => void readOne(e.payload.conversationId),
  );
  useRealtimeEvent(REALTIME_EVENT.unread, (e) => void readOne(e.payload.conversationId));
  useRealtimeEvent(REALTIME_EVENT.assignment, (e) => void readOne(e.payload.conversationId));
  // The connection came up or back, or the server lost count: whatever is on screen may be older than that.
  useResync(() => {
    void readList();
    void queryClient.invalidateQueries({ queryKey: ['inbox', 'conversation'] });
  }, ['user', 'org']);

  return status === 'connected';
}

/**
 * One open thread: joins its room (the server answers whether the person may), reads the messages again when one arrives or its tick
 * changes, and again after every join or reconnect. `live` is true only while the socket is up and the room is joined, so a thread
 * the person may not join keeps polling.
 */
export function useThreadLive(id: string, enabled: boolean): boolean {
  const queryClient = useQueryClient();
  const status = useRealtimeStatus();
  const room = useRoom(enabled && id !== '' ? { kind: 'conv', id } : null);
  const key = realtimeRoomKey({ kind: 'conv', id: id || '00000000-0000-4000-8000-000000000000' });

  const readThread = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: messagesKey(id) }),
      queryClient.invalidateQueries({ queryKey: detailKey(id) }),
    ]);

  useRealtimeEvent(REALTIME_EVENT.messageNew, (e) => {
    if (e.payload.conversationId === id) void readThread();
  });
  useRealtimeEvent(REALTIME_EVENT.messageStatus, (e) => {
    if (e.payload.conversationId === id) {
      void queryClient.invalidateQueries({ queryKey: messagesKey(id) });
    }
  });
  useResync(() => {
    void readThread();
    void queryClient.invalidateQueries({ queryKey: notesKey(id) });
    void queryClient.invalidateQueries({ queryKey: eventsKey(id) });
  }, [key]);

  return enabled && status === 'connected' && room.state === 'joined';
}
