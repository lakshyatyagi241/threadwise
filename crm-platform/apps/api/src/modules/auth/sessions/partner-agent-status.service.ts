import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { onRedisFailure } from '../support/resilience';
import { AuthKeys, Ttl } from '../support/redis-keys';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('partner_agent_status');

/**
 * Revocation for partner agents.
 *
 * Staff users and operators are revoked through their session row; a partner agent has no session (stateless token
 * pair), so without this a suspended agent's tokens kept working, and kept renewing, for as long as they were refreshed.
 * The guard calls `assertActive` on every request and the refresh route calls it before re-issuing, so a suspension takes
 * effect within `Ttl.partnerStatusSeconds` on every instance (immediately on the instance that calls `invalidate`).
 */
@Injectable()
export class PartnerAgentStatusService {
  private readonly logger = new Logger(PartnerAgentStatusService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Throws 401 unless the agent exists and is active. `message` is what the caller's 401 says. */
  async assertActive(
    orgId: number,
    agentId: number,
    message = 'Invalid or expired token',
  ): Promise<void> {
    if (!(await this.isActive(orgId, agentId))) throw AppError.unauthenticated(message);
  }

  async isActive(orgId: number, agentId: number): Promise<boolean> {
    const key = AuthKeys.partnerStatus(orgId, agentId);
    try {
      const cached = await this.redis.get(key);
      if (cached === '1' || cached === '0') {
        cache.hit();
        return cached === '1';
      }
      cache.miss();
    } catch (err) {
      cache.error();
      cache.miss();
      // Closed mode: refuse (503). Open mode: read the database directly, which is authoritative anyway.
      onRedisFailure('partner-status.read', err);
    }
    const active = await this.readStatus(orgId, agentId);
    await this.redis
      .set(key, active ? '1' : '0', 'EX', Ttl.partnerStatusSeconds)
      .catch((err: unknown) => {
        this.logger.warn({ err }, 'could not cache partner agent status');
      });
    return active;
  }

  /** Call when an agent's status changes, so the change is not delayed by the cache. */
  async invalidate(orgId: number, agentId: number): Promise<void> {
    await this.redis.del(AuthKeys.partnerStatus(orgId, agentId)).catch(() => undefined);
  }

  private async readStatus(orgId: number, agentId: number): Promise<boolean> {
    const res = await this.db.txAs({ orgId }, async (tx) =>
      tx.execute(sql`
        SELECT status::text AS status FROM partner_agents WHERE org_id = ${orgId} AND id = ${agentId}
      `),
    );
    return (res.rows[0] as { status?: string } | undefined)?.status === 'active';
  }
}
