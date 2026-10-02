import { beforeEach, describe, expect, it } from 'vitest';
import { REALTIME_EVENT } from '@crm/contracts';
import { RealtimeEmitter } from '../../../src/realtime/realtime-emitter.service';
import { roomKeyFor, roomName } from '../../../src/realtime/rooms';
import { FakeRedis } from './fake-redis';

const CONV = '33333333-3333-4333-8333-333333333333';
const MSG = '44444444-4444-4444-8444-444444444444';

let redis: FakeRedis;
let emitter: RealtimeEmitter;

const status = (conversationId = CONV) => ({
  conversationId,
  messageId: MSG,
  clientMessageId: null,
  status: 'sent' as const,
  at: new Date(0).toISOString(),
});

beforeEach(() => {
  redis = new FakeRedis();
  emitter = new RealtimeEmitter(redis as never);
});

describe('room names', () => {
  it('carry the workspace, so two tenants can never share a room', () => {
    expect(roomName(3, { kind: 'org' })).toBe('org:3');
    expect(roomName(3, { kind: 'user', userId: 7 })).toBe('user:3:7');
    expect(roomName(3, { kind: 'conv', id: CONV.toUpperCase() })).toBe(`conv:3:${CONV}`);
    expect(roomName(3, { kind: 'inbox', scope: 'all' })).toBe('inbox:3:all');
    expect(roomName(3, { kind: 'conv', id: CONV })).not.toBe(
      roomName(4, { kind: 'conv', id: CONV }),
    );
  });

  it('are shown to a client without internal ids', () => {
    expect(roomKeyFor({ kind: 'org' })).toBe('org');
    expect(roomKeyFor({ kind: 'user', userId: 7 })).toBe('user');
    expect(roomKeyFor({ kind: 'conv', id: CONV })).toBe(`conv:${CONV}`);
    expect(roomKeyFor({ kind: 'inbox', scope: 'all' })).toBe('inbox:all');
  });
});

describe('RealtimeEmitter: sequence numbers', () => {
  it('count one by one per room, from 1', async () => {
    const room = [{ kind: 'conv' as const, id: CONV }];
    const seqs: number[] = [];
    for (let i = 0; i < 4; i++) {
      const report = await emitter.emit(3, room, REALTIME_EVENT.messageStatus, status());
      seqs.push(report.rooms[0]!.seq);
    }
    expect(seqs).toEqual([1, 2, 3, 4]);
  });

  it('are independent per room and per workspace', async () => {
    const a = await emitter.emit(
      3,
      [{ kind: 'conv', id: CONV }],
      REALTIME_EVENT.messageStatus,
      status(),
    );
    const b = await emitter.emit(3, [{ kind: 'user', userId: 7 }], REALTIME_EVENT.unread, {
      conversationId: CONV,
      unread: 2,
    });
    const c = await emitter.emit(
      4,
      [{ kind: 'conv', id: CONV }],
      REALTIME_EVENT.messageStatus,
      status(),
    );
    expect([a.rooms[0]!.seq, b.rooms[0]!.seq, c.rooms[0]!.seq]).toEqual([1, 1, 1]);
    await emitter.emit(3, [{ kind: 'conv', id: CONV }], REALTIME_EVENT.messageStatus, status());
    expect(await emitter.currentSeq(3, { kind: 'conv', id: CONV })).toBe(2);
    expect(await emitter.currentSeq(4, { kind: 'conv', id: CONV })).toBe(1);
    expect(await emitter.currentSeq(3, { kind: 'inbox', scope: 'all' })).toBe(0);
  });

  it('are shared by every process: a second emitter on the same Redis carries on from the first', async () => {
    const other = new RealtimeEmitter(redis as never);
    const room = [{ kind: 'conv' as const, id: CONV }];
    await emitter.emit(3, room, REALTIME_EVENT.messageStatus, status());
    const report = await other.emit(3, room, REALTIME_EVENT.messageStatus, status());
    expect(report.rooms[0]!.seq).toBe(2);
  });

  it('give each room of one emit its own number and publish once per room', async () => {
    await emitter.emit(3, [{ kind: 'user', userId: 1 }], REALTIME_EVENT.unread, {
      conversationId: CONV,
      unread: 1,
    });
    redis.published.length = 0;
    const report = await emitter.emitToUsers(3, [1, 2, 2], REALTIME_EVENT.unread, {
      conversationId: CONV,
      unread: 2,
    });
    expect(report.rooms).toEqual([
      { room: 'user', seq: 2 },
      { room: 'user', seq: 1 },
    ]);
    expect(redis.published).toHaveLength(2);
  });

  it('a room that was idle for the counter lifetime starts again at 1 (a client sees that as a gap and refetches)', async () => {
    const room = [{ kind: 'conv' as const, id: CONV }];
    await emitter.emit(3, room, REALTIME_EVENT.messageStatus, status());
    redis.advance(31 * 24 * 3600 * 1000);
    const report = await emitter.emit(3, room, REALTIME_EVENT.messageStatus, status());
    expect(report.rooms[0]!.seq).toBe(1);
  });
});

describe('RealtimeEmitter: delivery', () => {
  it('publishes on the /realtime namespace, to the room named with the workspace', async () => {
    await emitter.emit(3, [{ kind: 'conv', id: CONV }], REALTIME_EVENT.messageStatus, status());
    expect(redis.published).toHaveLength(1);
    // The socket.io redis adapter's channel: `<key>#<namespace>#<room>#`.
    expect(redis.published[0]!.channel).toBe(`socket.io#/realtime#conv:3:${CONV}#`);
  });

  it('does nothing for no rooms', async () => {
    const report = await emitter.emit(3, [], REALTIME_EVENT.unread, {
      conversationId: CONV,
      unread: 0,
    });
    expect(report.rooms).toEqual([]);
    expect(redis.published).toEqual([]);
  });

  it('never throws when Redis is down: the database is the truth and a client catches up by cursor', async () => {
    const broken = {
      pipeline: () => ({
        incr: () => broken.pipeline(),
        expire: () => broken.pipeline(),
        exec: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
      publish: async () => 0,
    };
    const down = new RealtimeEmitter(broken as never);
    await expect(
      down.emit(3, [{ kind: 'user', userId: 1 }], REALTIME_EVENT.unread, {
        conversationId: CONV,
        unread: 1,
      }),
    ).resolves.toEqual({ rooms: [] });
  });
});
