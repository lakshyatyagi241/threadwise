import { Inject, Injectable, Logger } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  REALTIME_EVENT,
  REALTIME_NAMESPACE,
  REALTIME_SYSTEM_EVENTS,
  type RealtimeEnvelope,
  type RealtimeEventPayload,
  type RealtimeEventType,
} from '@crm/contracts';
import { REDIS_CLIENT } from '../infra/redis/redis.module';
import { realtimeMetrics } from './realtime-metrics';
import { roomKeyFor, roomName, type RoomRef } from './rooms';

/** A room's counter is kept this long after its last event; a cold room starts again at 1, which clients treat as a gap. */
const SEQ_TTL_SECONDS = 30 * 24 * 3600;

const seqKey = (room: string) => `rt:seq:${room}`;

/**
 * Events whose payload is restricted to members holding a permission (AZ-016). Whatever room a producer names, these never go to
 * the shared `org` room: an `org` target is rewritten to the permission room, which the gateway fills only with sockets whose
 * member holds the permission. They are state events (the latest figure wins), so they carry sequence 0 and do not count in the
 * `org` room's sequence, which the members who never receive them would otherwise see as a gap.
 */
export const RESTRICTED_EVENT_PERMISSION: Readonly<Record<string, string>> = {
  [REALTIME_EVENT.walletUpdated]: 'wallet.balance.read',
};

export interface EmitReport {
  /** Each room the event went to, with the sequence number it carried there. */
  rooms: Array<{ room: string; seq: number }>;
}

/**
 * The one way anything publishes a realtime event: the HTTP app, the ingest worker and the dispatch worker all use it.
 *
 * It publishes through `@socket.io/redis-emitter`, so it needs nothing but Redis: the process does not host sockets, the API
 * pods that do pick the packet up through the Redis adapter and hand it to the sockets in the room.
 *
 * Each event carries a per-room sequence number (an atomic Redis `INCR`, shared by every process), so a client can see that it
 * missed something and fetch again. Delivery is best effort: a failure is logged and never thrown, because the database is the
 * truth and a client that missed an event catches up through its REST cursor. Call it AFTER the transaction commits, never
 * inside it (a rolled-back change must not be announced).
 */
@Injectable()
export class RealtimeEmitter {
  private readonly logger = new Logger(RealtimeEmitter.name);
  private readonly io: Emitter;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {
    this.io = new Emitter(redis).of(REALTIME_NAMESPACE);
  }

  /** Publishes one event to each room (duplicates collapse). Never throws. */
  async emit<T extends RealtimeEventType>(
    orgId: number,
    rooms: RoomRef[],
    type: T,
    payload: RealtimeEventPayload<T>,
  ): Promise<EmitReport> {
    return this.publish(orgId, rooms, type, payload);
  }

  /** The same event to each of these staff users' own rooms: how a list-level signal reaches exactly the people who may see it. */
  async emitToUsers<T extends RealtimeEventType>(
    orgId: number,
    userIds: Iterable<number>,
    type: T,
    payload: RealtimeEventPayload<T>,
  ): Promise<EmitReport> {
    return this.publish(
      orgId,
      [...new Set(userIds)].map((userId) => ({ kind: 'user' as const, userId })),
      type,
      payload,
    );
  }

  /** Asks every client in these rooms to fetch their state again (permissions changed, something the sequence cannot describe). */
  async requestResync(orgId: number, rooms: RoomRef[], reason: string): Promise<EmitReport> {
    return this.publish(orgId, rooms, REALTIME_SYSTEM_EVENTS.resync, { reason });
  }

  /**
   * Takes a user's sockets out of a room (access to a conversation ended: reassigned, role changed). A room is checked when it
   * is joined, so whoever loses access while it is open must be evicted or they would keep receiving its events.
   */
  async evict(orgId: number, userId: number, ref: RoomRef): Promise<void> {
    try {
      this.io.in(roomName(orgId, { kind: 'user', userId })).socketsLeave(roomName(orgId, ref));
    } catch (err) {
      this.logger.warn({ err, orgId, userId }, 'realtime evict failed');
    }
  }

  /** Where a room's counter stands: the sequence number of its latest event, 0 if it never had one. */
  async currentSeq(orgId: number, ref: RoomRef): Promise<number> {
    try {
      return Number((await this.redis.get(seqKey(roomName(orgId, ref)))) ?? 0);
    } catch (err) {
      this.logger.warn({ err }, 'realtime seq read failed');
      return 0;
    }
  }

  private async publish(
    orgId: number,
    rooms: RoomRef[],
    type: string,
    payload: unknown,
  ): Promise<EmitReport> {
    const startedAt = process.hrtime.bigint();
    const permission = RESTRICTED_EVENT_PERMISSION[type];
    const unique = new Map<string, RoomRef>();
    for (const ref of rooms) {
      // A restricted event only ever goes to its permission room, whatever the caller named.
      const target: RoomRef = permission && ref.kind === 'org' ? { kind: 'perm', permission } : ref;
      if (permission && target.kind !== 'perm') continue;
      unique.set(roomName(orgId, target), target);
    }
    if (unique.size === 0) return { rooms: [] };

    try {
      const names = [...unique.keys()];
      const counted = names.filter((name) => unique.get(name)!.kind !== 'perm');
      const pipeline = this.redis.pipeline();
      for (const name of counted) {
        pipeline.incr(seqKey(name)).expire(seqKey(name), SEQ_TTL_SECONDS);
      }
      const results = counted.length > 0 ? ((await pipeline.exec()) ?? []) : [];

      const report: EmitReport = { rooms: [] };
      names.forEach((name) => {
        const at = counted.indexOf(name);
        const seq = at < 0 ? 0 : Number(results[at * 2]?.[1] ?? 0);
        const ref = unique.get(name)!;
        const envelope: RealtimeEnvelope = {
          v: 1,
          id: randomUUID(),
          type,
          room: roomKeyFor(ref),
          seq,
          at: new Date().toISOString(),
          payload,
        };
        this.io.to(name).emit(type, envelope);
        report.rooms.push({ room: envelope.room, seq });
      });
      realtimeMetrics.published(
        type,
        report.rooms.length,
        Number(process.hrtime.bigint() - startedAt) / 1e9,
      );
      return report;
    } catch (err) {
      realtimeMetrics.publishFailed(type);
      this.logger.warn({ err, type, orgId }, 'realtime emit failed');
      return { rooms: [] };
    }
  }
}
