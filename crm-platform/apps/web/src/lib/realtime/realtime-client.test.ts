import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REALTIME_EVENT, type RealtimeRoomKey } from '@crm/contracts';
import { fakeSocketFactory, type FakeSocket } from './fake-socket';
import { RealtimeClient, type RealtimeStatus, type ResyncRequest } from './realtime-client';

const CONV = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const conv = (id = CONV) => ({ kind: 'conv' as const, id });

let tickets = 0;
const mint = vi.fn(async () => `rtk_ticket-${++tickets}`);

function setup(options: { mintTicket?: () => Promise<string> } = {}) {
  const { factory, sockets, last } = fakeSocketFactory();
  const client = new RealtimeClient({
    url: 'http://api.test/realtime',
    mintTicket: options.mintTicket ?? mint,
    createSocket: factory,
  });
  const statuses: RealtimeStatus[] = [];
  client.onStatus(() => statuses.push(client.getStatus()));
  const resyncs: ResyncRequest[] = [];
  client.onResync((r) => resyncs.push(r));
  return { client, sockets, socket: last, statuses, resyncs };
}

/** Lets the ticket promise and its callbacks run. */
const flush = () => vi.advanceTimersByTimeAsync(0);

/** Starts, hands over a ticket and has the server accept, as a signed-in page does. */
async function connected() {
  const t = setup();
  t.client.start();
  await flush();
  t.socket().accept();
  return t;
}
const ready = (socket: FakeSocket, user = 0, org = 0) =>
  socket.serverEmit('rt.ready', {
    v: 1,
    rooms: [
      { room: 'org', seq: org },
      { room: 'user', seq: user },
    ],
    serverTime: new Date(0).toISOString(),
  });
const ok = (room: string, seq = 0) => ({ ok: true, room, seq });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(1); // no jitter: delays are exact
  tickets = 0;
  mint.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('connecting', () => {
  it('connects with a ticket in the handshake, and reports each step', async () => {
    const { client, socket, statuses } = setup();
    expect(client.getStatus()).toBe('idle');
    client.start();
    expect(client.getStatus()).toBe('connecting');
    await flush();
    expect(socket().url).toBe('http://api.test/realtime');
    expect(socket().handshakes).toEqual([{ ticket: 'rtk_ticket-1' }]);
    socket().accept();
    expect(client.getStatus()).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('starting twice makes one socket', async () => {
    const { client, sockets } = setup();
    client.start();
    client.start();
    await flush();
    expect(sockets).toHaveLength(1);
    expect(mint).toHaveBeenCalledOnce();
  });

  it('asks for a NEW ticket on every attempt: after a transport drop and after a refused handshake', async () => {
    const { socket, client } = await connected();
    socket().drop(); // socket.io retries by itself and calls `auth` again
    socket().connect();
    await flush();
    socket().refuse();
    await vi.advanceTimersByTimeAsync(1000); // our retry for a refused handshake
    await flush();
    expect(socket().handshakes.map((h) => h.ticket)).toEqual([
      'rtk_ticket-1',
      'rtk_ticket-2',
      'rtk_ticket-3',
    ]);
    expect(client.getStatus()).toBe('reconnecting');
  });

  it('shows reconnecting while the connection is down and connected when it is back', async () => {
    const { socket, client, statuses } = await connected();
    socket().drop();
    expect(client.getStatus()).toBe('reconnecting');
    socket().connect();
    await flush();
    socket().accept();
    expect(statuses).toEqual(['connecting', 'connected', 'reconnecting', 'connected']);
  });

  it('retries a refused handshake with a doubling delay, capped, and starts over after a success', async () => {
    const { socket, client } = setup();
    client.start();
    await flush();
    const attemptsAfter = async (ms: number) => {
      socket().refuse();
      await vi.advanceTimersByTimeAsync(ms - 1);
      const before = socket().connectCalls;
      await vi.advanceTimersByTimeAsync(1);
      return socket().connectCalls - before;
    };
    expect(await attemptsAfter(1000)).toBe(1);
    expect(await attemptsAfter(2000)).toBe(1);
    expect(await attemptsAfter(4000)).toBe(1);
    expect(await attemptsAfter(8000)).toBe(1);
    expect(await attemptsAfter(16_000)).toBe(1);
    expect(await attemptsAfter(30_000)).toBe(1); // capped
    expect(await attemptsAfter(30_000)).toBe(1);

    await flush();
    socket().accept();
    socket().drop(true); // the server dropped us: the delay starts from 1 s again
    const calls = socket().connectCalls;
    await vi.advanceTimersByTimeAsync(999);
    expect(socket().connectCalls).toBe(calls);
    await vi.advanceTimersByTimeAsync(1);
    expect(socket().connectCalls).toBe(calls + 1);
  });

  it('retries after the server disconnects it (a revoked room, a restart), which socket.io does not do by itself', async () => {
    const { socket } = await connected();
    socket().drop(true);
    const calls = socket().connectCalls;
    await vi.advanceTimersByTimeAsync(1000);
    expect(socket().connectCalls).toBe(calls + 1);
  });

  it('leaves a transport drop to socket.io, which is already retrying', async () => {
    const { socket } = await connected();
    socket().drop();
    const calls = socket().connectCalls;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket().connectCalls).toBe(calls);
  });

  it('keeps trying when the ticket request fails for a reason that can pass (network, server restart)', async () => {
    const failing = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('rtk_ok');
    const { client, socket } = setup({ mintTicket: failing });
    client.start();
    await flush();
    expect(socket().handshakes).toEqual([{}]); // an empty handshake, which the server refuses
    socket().refuse();
    expect(client.getStatus()).toBe('connecting');
    await vi.advanceTimersByTimeAsync(1000);
    await flush();
    expect(socket().handshakes).toEqual([{}, { ticket: 'rtk_ok' }]);
  });

  it.each([401, 403])(
    'stops for good when the session is refused a ticket (%i): signed out, not a network blip',
    async (status) => {
      const refused = vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { status }));
      const { client, socket } = setup({ mintTicket: refused });
      client.start();
      await flush();
      socket().refuse();
      expect(client.getStatus()).toBe('unauthorized');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(refused).toHaveBeenCalledOnce();
      expect(socket().connectCalls).toBe(1);
    },
  );

  it('stop() disconnects, cancels the retry and goes quiet', async () => {
    const { client, socket } = await connected();
    socket().drop(true);
    client.stop();
    expect(client.getStatus()).toBe('stopped');
    const calls = socket().connectCalls;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket().connectCalls).toBe(calls);
  });
});

describe('rooms', () => {
  it('joins an open room once connected, and answers with its state', async () => {
    const { client, socket } = setup();
    client.start();
    const release = client.join(conv());
    expect(client.getRoomState(`conv:${CONV}`)).toBe('joining');
    expect(socket().joins()).toEqual([]); // nothing to send to yet
    await flush();
    socket().accept();
    expect(socket().joins()).toEqual([conv()]);
    socket().answer(ok(`conv:${CONV}`, 4));
    expect(client.getRoomState(`conv:${CONV}`)).toBe('joined');
    release();
    expect(client.getRoomState(`conv:${CONV}`)).toBe('idle');
  });

  it('shares one join between holders and leaves when the last lets go', async () => {
    const { client, socket } = await connected();
    const a = client.join(conv());
    const b = client.join(conv());
    expect(socket().joins()).toHaveLength(1);
    a();
    a(); // releasing twice is harmless
    expect(socket().leaves()).toEqual([]);
    b();
    expect(socket().leaves()).toEqual([conv()]);
  });

  it('re-joins every held room after a reconnect (the server forgets them with the socket)', async () => {
    const { client, socket } = await connected();
    client.join(conv(CONV));
    client.join(conv(OTHER));
    expect(socket().joins()).toHaveLength(2);
    socket().drop();
    expect(client.getRoomState(`conv:${CONV}`)).toBe('joining');
    socket().connect();
    await flush();
    socket().accept();
    expect(socket().joins()).toEqual([conv(CONV), conv(OTHER), conv(CONV), conv(OTHER)]);
  });

  it('a refusal is final for that room (denied), and the client does not ask again until it reconnects', async () => {
    const { client, socket } = await connected();
    client.join(conv());
    socket().answer({ ok: false, code: 'FORBIDDEN' });
    expect(client.getRoomState(`conv:${CONV}`)).toBe('denied');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket().joins()).toHaveLength(1);
  });

  it('asks again after a few seconds when the server could not decide (UNAVAILABLE) or the answer is garbage', async () => {
    const { client, socket } = await connected();
    client.join(conv());
    socket().answer({ ok: false, code: 'UNAVAILABLE' });
    expect(client.getRoomState(`conv:${CONV}`)).toBe('joining');
    await vi.advanceTimersByTimeAsync(3000);
    expect(socket().joins()).toHaveLength(2);
    socket().answer('what');
    await vi.advanceTimersByTimeAsync(3000);
    expect(socket().joins()).toHaveLength(3);
    socket().answer(ok(`conv:${CONV}`));
    expect(client.getRoomState(`conv:${CONV}`)).toBe('joined');
  });

  it('ignores an answer that arrives after the room was released', async () => {
    const { client, socket } = await connected();
    const release = client.join(conv());
    release();
    socket().answer(ok(`conv:${CONV}`, 9));
    expect(client.getRoomState(`conv:${CONV}`)).toBe('idle');
  });

  it('tells a listener when a room changes state', async () => {
    const { client, socket } = await connected();
    const key: RealtimeRoomKey = `conv:${CONV}`;
    const seen: string[] = [];
    client.onRoomState(key, () => seen.push(client.getRoomState(key)));
    client.join(conv());
    socket().answer(ok(key));
    expect(seen).toEqual(['joining', 'joined']);
  });

  it('names inbox rooms by scope', async () => {
    const { client, socket } = await connected();
    client.join({ kind: 'inbox', scope: 'all' });
    expect(socket().joins()).toEqual([{ kind: 'inbox', scope: 'all' }]);
    socket().answer(ok('inbox:all'));
    expect(client.getRoomState('inbox:all')).toBe('joined');
  });
});

describe('events', () => {
  it('delivers an event to the subscribers of its type and to the wildcard, and stops after unsubscribe', async () => {
    const { client, socket } = await connected();
    const typed: number[] = [];
    const all: string[] = [];
    const off = client.subscribe(REALTIME_EVENT.unread, (e) => typed.push(e.seq));
    client.subscribe('*', (e) => all.push(e.type));
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 1 });
    socket().push({ type: REALTIME_EVENT.presence, room: 'org', seq: 1 });
    off();
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 2 });
    expect(typed).toEqual([1]);
    expect(all).toEqual([REALTIME_EVENT.unread, REALTIME_EVENT.presence, REALTIME_EVENT.unread]);
  });

  it('hands over the whole envelope: room, sequence, time and payload', async () => {
    const { client, socket } = await connected();
    const got: unknown[] = [];
    client.subscribe(REALTIME_EVENT.messageStatus, (e) => got.push(e));
    socket().push({
      type: REALTIME_EVENT.messageStatus,
      room: `conv:${CONV}`,
      seq: 5,
      payload: { status: 'read' },
    });
    expect(got[0]).toMatchObject({
      v: 1,
      type: REALTIME_EVENT.messageStatus,
      room: `conv:${CONV}`,
      seq: 5,
      payload: { status: 'read' },
    });
  });

  it('delivers an event that arrived twice once', async () => {
    const { client, socket } = await connected();
    const got: unknown[] = [];
    client.subscribe('*', (e) => got.push(e));
    const env = {
      v: 1,
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      type: REALTIME_EVENT.unread,
      room: 'user',
      seq: 1,
      at: new Date(0).toISOString(),
      payload: {},
    };
    socket().serverEmit(REALTIME_EVENT.unread, env);
    socket().serverEmit(REALTIME_EVENT.unread, env);
    expect(got).toHaveLength(1);
  });

  it('ignores what is not an envelope, and one handler failing does not stop the others', async () => {
    const { client, socket } = await connected();
    const got: string[] = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    client.subscribe('*', () => {
      throw new Error('boom');
    });
    client.subscribe('*', (e) => got.push(e.type));
    socket().serverEmit('whatever', { hello: 'world' });
    socket().serverEmit('whatever', null);
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 1 });
    expect(got).toEqual([REALTIME_EVENT.unread]);
  });
});

describe('sequence numbers and gaps', () => {
  const gaps = (resyncs: ResyncRequest[]) => resyncs.filter((r) => r.reason === 'gap');

  it('in order is quiet', async () => {
    const { socket, resyncs } = await connected();
    ready(socket(), 10);
    for (const seq of [11, 12, 13])
      socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq });
    expect(gaps(resyncs)).toEqual([]);
  });

  it('a skipped number asks for a fetch of that room, once, and carries on from the new number', async () => {
    const { socket, resyncs } = await connected();
    ready(socket(), 10);
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 11 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 14 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 15 });
    expect(gaps(resyncs)).toEqual([{ reason: 'gap', room: 'user' }]);
  });

  it('the first event after joining a room is checked against the number the join reported', async () => {
    const { client, socket, resyncs } = await connected();
    client.join(conv());
    socket().answer(ok(`conv:${CONV}`, 7));
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 8 });
    expect(gaps(resyncs)).toEqual([]);
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 10 });
    expect(gaps(resyncs)).toEqual([{ reason: 'gap', room: `conv:${CONV}` }]);
  });

  it('events that overtook the join answer do not look like a gap', async () => {
    const { client, socket, resyncs } = await connected();
    client.join(conv());
    // Published after the join but delivered before its answer: 8 and 9 arrive first, then the answer says 9.
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 8 });
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 9 });
    socket().answer(ok(`conv:${CONV}`, 9));
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 10 });
    expect(gaps(resyncs)).toEqual([]);
  });

  it('a late or repeated number is not a gap', async () => {
    const { socket, resyncs } = await connected();
    ready(socket(), 5);
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 6 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 7 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 6 });
    expect(gaps(resyncs)).toEqual([]);
  });

  it('a counter that restarted at 1 after a higher number (the server lost it) is a gap', async () => {
    const { socket, resyncs } = await connected();
    ready(socket(), 40);
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 1 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 2 });
    expect(gaps(resyncs)).toEqual([{ reason: 'gap', room: 'user' }]);
  });

  it('rooms are counted separately', async () => {
    const { socket, resyncs } = await connected();
    ready(socket());
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 1 });
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 4 }); // first sighting: a baseline, not a gap
    socket().push({ type: REALTIME_EVENT.messageNew, room: `conv:${CONV}`, seq: 5 });
    socket().push({ type: REALTIME_EVENT.unread, room: 'user', seq: 2 });
    expect(gaps(resyncs)).toEqual([]);
  });
});

describe('resync: when to fetch again', () => {
  it('on the first connection, for the two rooms the server puts every socket in', async () => {
    const { socket, resyncs } = await connected();
    ready(socket());
    expect(resyncs).toEqual([
      { reason: 'connect', room: 'user' },
      { reason: 'connect', room: 'org' },
    ]);
  });

  it('after a reconnect, for those rooms and for every room that is joined again', async () => {
    const { client, socket, resyncs } = await connected();
    ready(socket());
    client.join(conv());
    socket().answer(ok(`conv:${CONV}`));
    resyncs.length = 0;

    socket().drop();
    socket().connect();
    await flush();
    socket().accept();
    ready(socket());
    socket().answer(ok(`conv:${CONV}`));
    expect(resyncs).toEqual([
      { reason: 'reconnect', room: 'user' },
      { reason: 'reconnect', room: 'org' },
      { reason: 'reconnect', room: `conv:${CONV}` },
    ]);
  });

  it('right after a room is joined, because events before the join were not delivered', async () => {
    const { client, socket, resyncs } = await connected();
    resyncs.length = 0;
    client.join(conv());
    expect(resyncs).toEqual([]); // not before the server has let it in
    socket().answer(ok(`conv:${CONV}`));
    expect(resyncs).toEqual([{ reason: 'join', room: `conv:${CONV}` }]);
  });

  it('when the server asks', async () => {
    const { socket, resyncs } = await connected();
    resyncs.length = 0;
    socket().push({
      type: 'rt.resync',
      room: `conv:${CONV}`,
      seq: 3,
      payload: { reason: 'permissions-changed' },
    });
    expect(resyncs).toEqual([{ reason: 'server', room: `conv:${CONV}` }]);
  });

  it('when the tab comes back to the foreground: all joined rooms if connected', async () => {
    const { client, socket, resyncs } = await connected();
    client.join(conv());
    socket().answer(ok(`conv:${CONV}`));
    client.join(conv(OTHER)); // still joining: nothing to check yet
    resyncs.length = 0;
    client.notifyForeground();
    expect(resyncs).toEqual([
      { reason: 'foreground', room: 'user' },
      { reason: 'foreground', room: `conv:${CONV}` },
    ]);
  });

  it('when the tab comes back and the connection is down, reconnects at once instead of waiting out the backoff', async () => {
    const { client, socket } = await connected();
    socket().drop(true);
    await vi.advanceTimersByTimeAsync(1000);
    socket().refuse();
    await vi.advanceTimersByTimeAsync(10); // waiting out a longer delay now
    const calls = socket().connectCalls;
    client.notifyForeground();
    expect(socket().connectCalls).toBe(calls + 1);
  });

  it('does nothing when not started', async () => {
    const { client, resyncs } = setup();
    client.notifyForeground();
    expect(resyncs).toEqual([]);
  });

  it('a handler that throws does not stop the others', async () => {
    const { client, socket } = await connected();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const got: string[] = [];
    client.onResync(() => {
      throw new Error('boom');
    });
    client.onResync((r) => got.push(r.reason));
    ready(socket());
    expect(got).toEqual(['connect', 'connect']);
  });
});
