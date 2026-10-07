import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';

/** How long "I just read this chat" is remembered. It only has to outlive the outbox drain's latency (about 2 seconds) with margin. */
const SEEN_TTL_MS = 60_000;

const key = (orgId: number, userId: number, conversationUuid: string) =>
  `rt:nc:seen:${orgId}:${userId}:${conversationUuid}`;

/**
 * Whether a person has the conversation open right now, as far as the server can tell. There is no server-side presence, so this uses
 * the one thing an open thread always does: it marks itself read each time a message arrives (the `POST .../read` call). That call
 * records the moment here; the notification consumer skips a person whose last read is at or after the message's arrival, because they
 * are looking at it and an alert would only interrupt them.
 *
 * Best effort by design: a Redis failure answers "not looking" (the person is notified; the client also hides alerts for the thread it
 * shows), never the reverse.
 */
@Injectable()
export class ConversationReadState {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async markSeen(orgId: number, userId: number, conversationUuid: string): Promise<void> {
    try {
      await this.redis.set(
        key(orgId, userId, conversationUuid),
        String(Date.now()),
        'PX',
        SEEN_TTL_MS,
      );
    } catch {
      /* best effort */
    }
  }

  /** The users among `userIds` who marked this conversation read at or after `sinceMs` (epoch milliseconds). */
  async seenSince(
    orgId: number,
    userIds: number[],
    conversationUuid: string,
    sinceMs: number,
  ): Promise<Set<number>> {
    const seen = new Set<number>();
    if (userIds.length === 0) return seen;
    try {
      const values = await this.redis.mget(userIds.map((u) => key(orgId, u, conversationUuid)));
      values.forEach((v, i) => {
        // A read a moment BEFORE the message cannot have been about it; allow one second for the two clocks.
        if (v !== null && Number(v) >= sinceMs - 1000) seen.add(userIds[i]!);
      });
    } catch {
      /* best effort */
    }
    return seen;
  }
}
