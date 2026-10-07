import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import type { RequestContext } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { AuthKeys, Ttl } from '../support/redis-keys';

/** A second look after an invalidation, to close the window where a request cached the old value before the writer committed. */
const RECHECK_DELAY_MS = 1_500;

/**
 * Whether a workspace is suspended, answered from a 5-second Redis cache (ADR-0019).
 *
 * `organizations.status = 'suspended'` is written by the platform inbox (frozen, tos_violation and fraud flags). This is the one
 * reader every enforcement point shares: the account gate (HTTP), the realtime handshake and sweep, the outbound send screen and
 * the inbound listeners. It fails OPEN on a read error (a cache or database blip must not lock every workspace out); the
 * suspension itself is durable, so the next successful read enforces it.
 */
@Injectable()
export class OrgSuspensionService {
  private readonly logger = new Logger(OrgSuspensionService.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async isSuspended(orgId: number): Promise<boolean> {
    if (!(orgId > 0)) return false;
    const key = AuthKeys.orgSuspended(orgId);
    try {
      const cached = await this.redis.get(key);
      if (cached !== null) return cached === '1';
    } catch (err) {
      this.logger.warn({ err, orgId }, 'org status cache read failed; using the database');
    }

    let suspended: boolean;
    try {
      const res = await this.db.txAs({ orgId, userId: null }, async (tx) =>
        tx.execute(sql`SELECT status FROM organizations WHERE id = ${orgId}`),
      );
      suspended = (res.rows[0] as { status?: string } | undefined)?.status === 'suspended';
    } catch (err) {
      this.logger.warn({ err, orgId }, 'org status read failed; letting the request through');
      return false;
    }
    await this.redis
      .setex(key, Ttl.orgSuspendedSeconds, suspended ? '1' : '0')
      .catch(() => undefined);
    return suspended;
  }

  /**
   * Drops the cached verdict. Called while the status write is still open, so it is repeated shortly after: a request that
   * re-cached the old status in between is corrected, and the TTL bounds anything beyond that.
   */
  async invalidate(orgId: number): Promise<void> {
    const key = AuthKeys.orgSuspended(orgId);
    await this.redis.del(key).catch(() => undefined);
    setTimeout(() => void this.redis.del(key).catch(() => undefined), RECHECK_DELAY_MS).unref();
  }

  /** Throws the stable suspended problem (HTTP 403, WSP_ORG_SUSPENDED) for a suspended workspace. */
  async assertActive(orgId: number): Promise<void> {
    if (await this.isSuspended(orgId)) throw orgSuspendedError();
  }
}

export function orgSuspendedError(): AppError {
  return new AppError(
    ERROR_CODES.WSP_ORG_SUSPENDED,
    'This workspace is suspended. Contact support to restore access.',
    HttpStatus.FORBIDDEN,
  );
}

/**
 * An operator acting inside a workspace through an act-as session is let past the suspension so support can look at what the
 * owner sees (ADR-0019). Whether the session may write is that session's own rule (`impersonation.readOnly`, refused by the
 * impersonation guard), not this gate's.
 */
export function isOperatorImpersonation(
  ctx: Pick<RequestContext, 'impersonation'> | undefined,
): boolean {
  return ctx?.impersonation !== undefined && ctx.impersonation !== null;
}
