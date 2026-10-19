import { REALTIME_EVENT } from '@crm/contracts';
import { act, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { fakeSocketFactory } from '@/test/fake-socket';
import { renderApp } from '@/test/render';
import { useRealtimeEvent, useRealtimeStatus, useResync, useRoom } from './hooks';
import type { ResyncRequest } from './realtime-client';
import { RealtimeProvider } from './realtime-provider';

const CONV = '33333333-3333-4333-8333-333333333333';

let change: (state: string) => void = () => undefined;
const remove = jest.fn();
const mint = jest.fn(async () => 'rtk_ticket-1234567890');

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (state: string) => void,
  ) => {
    change = listener;
    return { remove };
  }) as never);
});
afterEach(() => jest.restoreAllMocks());

const resyncs: ResyncRequest[] = [];
const events: string[] = [];

/** Shows what the hooks report, so a test can read it off the screen. */
function Probe({ conv }: { conv: string | null }) {
  const status = useRealtimeStatus();
  const room = useRoom(conv ? { kind: 'conv', id: conv } : null);
  useRealtimeEvent(REALTIME_EVENT.unread, (e) => events.push(e.payload.conversationId));
  useResync((r) => resyncs.push(r), [`conv:${CONV}`]);
  return (
    <>
      <Text>{`status:${status}`}</Text>
      <Text>{`room:${room.state}`}</Text>
    </>
  );
}

async function show(conv: string | null = null) {
  const { factory, sockets, last } = fakeSocketFactory();
  const view = await renderApp(
    <RealtimeProvider url="http://api.test/realtime" mintTicket={mint} createSocket={factory}>
      <Probe conv={conv} />
    </RealtimeProvider>,
  );
  return { ...view, sockets, socket: last };
}

beforeEach(() => {
  resyncs.length = 0;
  events.length = 0;
});

describe('RealtimeProvider', () => {
  it('connects with a fresh ticket once it is mounted, and reports the status', async () => {
    const { sockets, socket } = await show();
    expect(await screen.findByText('status:connecting')).toBeTruthy();
    await waitFor(() => expect(sockets).toHaveLength(1));
    expect(socket().url).toBe('http://api.test/realtime');
    await waitFor(() => expect(socket().handshakes).toEqual([{ ticket: 'rtk_ticket-1234567890' }]));
    await act(async () => socket().accept());
    expect(await screen.findByText('status:connected')).toBeTruthy();
  });

  it('is `idle` for a hook used outside the provider', async () => {
    await renderApp(<Probe conv={null} />);
    expect(await screen.findByText('status:idle')).toBeTruthy();
    expect(screen.getByText('room:idle')).toBeTruthy();
  });

  it('closes the socket when the signed-in app goes away (signing out)', async () => {
    const { sockets, socket, unmount } = await show();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => socket().accept());
    await unmount();
    expect(socket().connected).toBe(false);
    expect(remove).toHaveBeenCalled();
  });

  it('joins the room a screen asks for, and says when the server let it in', async () => {
    const { sockets, socket } = await show(CONV);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => socket().accept());
    expect(await screen.findByText('room:joining')).toBeTruthy();
    expect(socket().joins()).toEqual([{ kind: 'conv', id: CONV }]);
    await act(async () => socket().answer({ ok: true, room: `conv:${CONV}`, seq: 0 }));
    expect(await screen.findByText('room:joined')).toBeTruthy();
  });

  it('says `denied` when the server refuses the room', async () => {
    const { sockets, socket } = await show(CONV);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => socket().accept());
    await act(async () => socket().answer({ ok: false, code: 'FORBIDDEN' }));
    expect(await screen.findByText('room:denied')).toBeTruthy();
  });

  it('hands an event to the screen that subscribed to its type', async () => {
    const { sockets, socket } = await show();
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => socket().accept());
    await act(async () =>
      socket().push({
        type: REALTIME_EVENT.unread,
        room: 'user',
        seq: 1,
        payload: { conversationId: CONV, unread: 2 },
      }),
    );
    expect(events).toEqual([CONV]);
  });

  it('tells a screen to read again after its room is joined, but not for another room', async () => {
    const { sockets, socket } = await show(CONV);
    await waitFor(() => expect(sockets).toHaveLength(1));
    await act(async () => socket().accept());
    await act(async () => socket().answer({ ok: true, room: `conv:${CONV}`, seq: 0 }));
    expect(resyncs).toEqual([{ reason: 'join', room: `conv:${CONV}` }]);
    await act(async () => socket().serverEmit('rt.resync', undefined));
    expect(resyncs).toHaveLength(1);
  });

  describe('coming back from the background', () => {
    it('reconnects at once when the connection dropped while the phone was away', async () => {
      const { sockets, socket } = await show();
      await waitFor(() => expect(sockets).toHaveLength(1));
      await act(async () => socket().accept());
      await act(async () => socket().drop(true));
      const calls = socket().connectCalls;
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      await act(async () => change('background'));
      clock.mockReturnValue(now + 60_000);
      await act(async () => change('active'));
      expect(socket().connectCalls).toBe(calls + 1);
    });

    it('asks the screens to read again when the connection held', async () => {
      const { sockets, socket } = await show(CONV);
      await waitFor(() => expect(sockets).toHaveLength(1));
      await act(async () => socket().accept());
      await act(async () => socket().answer({ ok: true, room: `conv:${CONV}`, seq: 0 }));
      resyncs.length = 0;
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
      await act(async () => change('background'));
      clock.mockReturnValue(now + 60_000);
      await act(async () => change('active'));
      expect(resyncs).toEqual([{ reason: 'foreground', room: `conv:${CONV}` }]);
    });

    it('does nothing for a short look away', async () => {
      const { sockets, socket } = await show(CONV);
      await waitFor(() => expect(sockets).toHaveLength(1));
      await act(async () => socket().accept());
      await act(async () => socket().answer({ ok: true, room: `conv:${CONV}`, seq: 0 }));
      resyncs.length = 0;
      await act(async () => change('background'));
      await act(async () => change('active'));
      expect(resyncs).toEqual([]);
    });
  });
});
