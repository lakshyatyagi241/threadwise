import { REALTIME_EVENT } from '@crm/contracts';
import { act, screen, waitFor } from '@testing-library/react-native';
import { Text } from '@/components/ui/text';
import { RealtimeProvider } from '@/lib/realtime';
import { fakeSocketFactory } from '@/test/fake-socket';
import { renderApp } from '@/test/render';
import { detailKey, listKey, messagesKey } from './use-inbox';
import { useInboxLive, useThreadLive } from './use-live';
import { eventsKey, notesKey } from './use-notes';

const CONV = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const mint = jest.fn(async () => 'rtk_ticket-1234567890');

function ListProbe() {
  return <Text>{`live:${useInboxLive()}`}</Text>;
}
function ThreadProbe({ enabled = true }: { enabled?: boolean }) {
  return <Text>{`live:${useThreadLive(CONV, enabled)}`}</Text>;
}

async function show(probe: 'list' | 'thread', enabled = true) {
  const { factory, sockets, last } = fakeSocketFactory();
  const view = await renderApp(
    <RealtimeProvider url="http://api.test/realtime" mintTicket={mint} createSocket={factory}>
      {probe === 'list' ? <ListProbe /> : <ThreadProbe enabled={enabled} />}
    </RealtimeProvider>,
  );
  const invalidated = jest.spyOn(view.queryClient, 'invalidateQueries');
  await waitFor(() => expect(sockets).toHaveLength(1));
  const keys = () => invalidated.mock.calls.map(([filters]) => filters?.queryKey);
  return { ...view, socket: last, keys, invalidated };
}

const upsert = (id: string, seq = 1) => ({
  type: REALTIME_EVENT.conversationUpsert,
  room: 'user',
  seq,
  payload: { conversationId: id, rowVersion: 2, changed: ['preview'] },
});

describe('the conversation list, live', () => {
  it('is live only while the socket is connected, so the timer polls the rest of the time', async () => {
    const { socket } = await show('list');
    expect(await screen.findByText('live:false')).toBeTruthy();
    await act(async () => socket().accept());
    expect(await screen.findByText('live:true')).toBeTruthy();
    await act(async () => socket().drop());
    expect(await screen.findByText('live:false')).toBeTruthy();
  });

  it('reads the list and that conversation again when one changed', async () => {
    const { socket, keys } = await show('list');
    await act(async () => socket().accept());
    await act(async () => socket().push(upsert(CONV)));
    expect(keys()).toEqual(
      expect.arrayContaining([listKey, detailKey(CONV), notesKey(CONV), eventsKey(CONV)]),
    );
  });

  it('does the same for a new unread count and for a new assignment', async () => {
    const { socket, keys } = await show('list');
    await act(async () => socket().accept());
    await act(async () =>
      socket().push({
        type: REALTIME_EVENT.unread,
        room: 'user',
        seq: 1,
        payload: { conversationId: OTHER, unread: 3 },
      }),
    );
    await act(async () =>
      socket().push({
        type: REALTIME_EVENT.assignment,
        room: 'user',
        seq: 2,
        payload: { conversationId: CONV, assigneeUserId: null, assigneeTeamId: null },
      }),
    );
    expect(keys()).toEqual(expect.arrayContaining([detailKey(OTHER), detailKey(CONV)]));
  });

  it('reads the list again after the connection comes up, because it may be older than that', async () => {
    const { socket, keys } = await show('list');
    await act(async () => socket().accept());
    await act(async () =>
      socket().serverEmit('rt.ready', {
        v: 1,
        rooms: [
          { room: 'org', seq: 0 },
          { room: 'user', seq: 0 },
        ],
        serverTime: new Date(0).toISOString(),
      }),
    );
    expect(keys()).toEqual(expect.arrayContaining([listKey, ['inbox', 'conversation']]));
  });
});

describe('one thread, live', () => {
  const messageNew = (id: string, seq = 1) => ({
    type: REALTIME_EVENT.messageNew,
    room: `conv:${CONV}`,
    seq,
    payload: { conversationId: id, message: { id: OTHER, seq: 9 } },
  });
  const joined = async (socket: () => ReturnType<typeof fakeSocketFactory>['sockets'][number]) => {
    await act(async () => socket().accept());
    await act(async () => socket().answer({ ok: true, room: `conv:${CONV}`, seq: 0 }));
  };

  it('is live only once the room is joined, not just when the socket is up', async () => {
    const { socket } = await show('thread');
    await act(async () => socket().accept());
    expect(socket().joins()).toEqual([{ kind: 'conv', id: CONV }]);
    expect(await screen.findByText('live:false')).toBeTruthy();
    await act(async () => socket().answer({ ok: true, room: `conv:${CONV}`, seq: 0 }));
    expect(await screen.findByText('live:true')).toBeTruthy();
  });

  it('keeps polling (not live) when the server will not let the person in', async () => {
    const { socket } = await show('thread');
    await act(async () => socket().accept());
    await act(async () => socket().answer({ ok: false, code: 'FORBIDDEN' }));
    expect(await screen.findByText('live:false')).toBeTruthy();
  });

  it('asks for no room, and is not live, when the person may not read the thread', async () => {
    const { socket } = await show('thread', false);
    await act(async () => socket().accept());
    expect(socket().joins()).toEqual([]);
    expect(await screen.findByText('live:false')).toBeTruthy();
  });

  it('reads the messages and the conversation again when a message arrives on this thread', async () => {
    const { socket, keys, invalidated } = await show('thread');
    await joined(socket);
    invalidated.mockClear();
    await act(async () => socket().push(messageNew(CONV)));
    expect(keys()).toEqual(expect.arrayContaining([messagesKey(CONV), detailKey(CONV)]));
  });

  it('ignores a message that is for another conversation', async () => {
    const { socket, invalidated } = await show('thread');
    await joined(socket);
    invalidated.mockClear();
    await act(async () => socket().push(messageNew(OTHER)));
    expect(invalidated).not.toHaveBeenCalled();
  });

  it('reads only the messages again when a tick changes', async () => {
    const { socket, keys, invalidated } = await show('thread');
    await joined(socket);
    invalidated.mockClear();
    await act(async () =>
      socket().push({
        type: REALTIME_EVENT.messageStatus,
        room: `conv:${CONV}`,
        seq: 1,
        payload: {
          conversationId: CONV,
          messageId: OTHER,
          clientMessageId: null,
          status: 'read',
          at: new Date(0).toISOString(),
        },
      }),
    );
    expect(keys()).toEqual([messagesKey(CONV)]);
  });

  it('reads everything of the thread again after the room is joined or the server asks', async () => {
    const { socket, keys, invalidated } = await show('thread');
    await joined(socket);
    expect(keys()).toEqual(
      expect.arrayContaining([messagesKey(CONV), detailKey(CONV), notesKey(CONV), eventsKey(CONV)]),
    );
    invalidated.mockClear();
    await act(async () =>
      socket().serverEmit('rt.resync', {
        v: 1,
        id: '55555555-5555-4555-8555-555555555555',
        type: 'rt.resync',
        room: `conv:${CONV}`,
        seq: 0,
        at: new Date(0).toISOString(),
        payload: { reason: 'permissions' },
      }),
    );
    expect(keys()).toEqual(expect.arrayContaining([messagesKey(CONV), notesKey(CONV)]));
  });
});
