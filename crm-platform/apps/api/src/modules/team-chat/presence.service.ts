import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { TchatActivityResponse } from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { TeamChatAccess } from './team-chat-access.service';
import { TeamChatRepository } from './team-chat.repository';

/** How long a typing ping and a presence ping stay true (Reference: 8 s and 45 s). */
export const TYPING_TTL_SECONDS = 8;
export const ONLINE_TTL_SECONDS = 45;

/**
 * Who is typing in a channel and who is online (TW-TCHAT-021..023): short-lived Redis keys, one MGET per question instead of one
 * cache read per member. Unlike Reference, every route checks the caller's access to the channel.
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TeamChatRepository,
    private readonly access: TeamChatAccess,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private typingKey(orgId: number, channelId: number, userId: number) {
    return `tchat:typing:${orgId}:${channelId}:${userId}`;
  }
  private onlineKey(orgId: number, userId: number) {
    return `tchat:online:${orgId}:${userId}`;
  }

  async typing(channelUuid: string): Promise<{ ok: true }> {
    const { orgId, userId } = this.access.actor();
    const channel = await this.db.tx(
      async (tx) => (await this.access.openChannel(tx, this.repo, channelUuid)).channel,
    );
    await this.redis.set(this.typingKey(orgId, channel.id, userId), '1', 'EX', TYPING_TTL_SECONDS);
    return { ok: true };
  }

  async ping(): Promise<{ ok: true }> {
    const { orgId, userId } = this.access.actor();
    await this.redis.set(this.onlineKey(orgId, userId), '1', 'EX', ONLINE_TTL_SECONDS);
    return { ok: true };
  }

  /** Typing excludes the caller; online includes them (as Reference). */
  async activity(channelUuid: string): Promise<TchatActivityResponse> {
    const { orgId, userId } = this.access.actor();
    const { channel, roster } = await this.db.tx(async (tx) => {
      const opened = await this.access.openChannel(tx, this.repo, channelUuid);
      return { channel: opened.channel, roster: await this.repo.roster(tx, orgId) };
    });
    if (roster.length === 0) return { typing: [], online: [] };
    const typingKeys = roster.map((p) => this.typingKey(orgId, channel.id, p.id));
    const onlineKeys = roster.map((p) => this.onlineKey(orgId, p.id));
    const [typing, online] = await Promise.all([
      this.redis.mget(...typingKeys),
      this.redis.mget(...onlineKeys),
    ]);
    return {
      typing: roster.filter((p, i) => p.id !== userId && typing[i]).map((p) => p.uuid),
      online: roster.filter((_, i) => online[i]).map((p) => p.uuid),
    };
  }
}
