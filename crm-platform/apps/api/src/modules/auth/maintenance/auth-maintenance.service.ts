import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../../infra/db/database.service';

/**
 * Daily housekeeping for the auth tables. Runs in the worker process only
 * (registered by WorkersModule), cross-tenant by nature, so it is one of the
 * sanctioned worker uses of `privileged()` (ADR-0002, ADR-0019).
 *
 *   user_tokens        consumed or expired more than 7 days ago
 *   auth_sessions      ended more than 90 days ago (the history feeds the new-device alert)
 *   platform_sessions  same
 *   security_events    older than the policy's audit retention (0 = keep forever)
 *   audit_log          same retention, every module's rows, in bounded batches
 *
 * Reference never pruned its security log and left expired reset tokens and the
 * audit log to an unscheduled command (TW-AUTH-013/037/046); this closes all three.
 */
const AUDIT_BATCH = 10_000;
/** Bound one run so a first sweep over years of history cannot hold the worker for long. */
const AUDIT_MAX_BATCHES = 100;

@Injectable()
export class AuthMaintenanceService {
  private readonly logger = new Logger(AuthMaintenanceService.name);

  constructor(private readonly db: DatabaseService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    try {
      const counts = await this.sweep();
      const auditLog = await this.pruneAuditLog(counts.retentionDays ?? 0);
      this.logger.log({ ...counts, auditLog }, 'auth maintenance sweep finished');
    } catch (err) {
      this.logger.error({ err }, 'auth maintenance sweep failed');
    }
  }

  async sweep(): Promise<Record<string, number>> {
    return this.db.privileged(async (tx) => {
      const tokens = await tx.execute(sql`
        DELETE FROM user_tokens
        WHERE (consumed_at IS NOT NULL AND consumed_at < now() - interval '7 days')
           OR expires_at < now() - interval '7 days'
        RETURNING 1
      `);
      const sessions = await tx.execute(sql`
        DELETE FROM auth_sessions
        WHERE COALESCE(revoked_at, expires_at) < now() - interval '90 days'
        RETURNING 1
      `);
      const operatorSessions = await tx.execute(sql`
        DELETE FROM platform_sessions
        WHERE COALESCE(revoked_at, expires_at) < now() - interval '90 days'
        RETURNING 1
      `);

      const setting = await tx.execute(sql`
        SELECT (value ->> 'auditLogRetentionDays')::int AS days
        FROM platform_settings WHERE key = 'security.policy'
      `);
      const days = (setting.rows[0] as unknown as { days: number | null } | undefined)?.days ?? 365;
      const events =
        days > 0
          ? await tx.execute(sql`
              DELETE FROM security_events WHERE at < now() - make_interval(days => ${days}) RETURNING 1
            `)
          : { rows: [] as unknown[] };

      return {
        tokens: tokens.rows.length,
        sessions: sessions.rows.length,
        operatorSessions: operatorSessions.rows.length,
        securityEvents: events.rows.length,
        retentionDays: days,
      };
    });
  }

  /**
   * Deletes `audit_log` rows older than the retention window, one short
   * transaction per batch, so a large backlog never holds a long lock.
   * Returns how many rows went.
   */
  async pruneAuditLog(days: number): Promise<number> {
    if (days <= 0) return 0;
    let total = 0;
    for (let i = 0; i < AUDIT_MAX_BATCHES; i++) {
      const removed = await this.db.privileged(async (tx) => {
        const res = await tx.execute(sql`
          DELETE FROM audit_log
          WHERE (id, at) IN (
            SELECT id, at FROM audit_log
            WHERE at < now() - make_interval(days => ${days})
            ORDER BY at
            LIMIT ${AUDIT_BATCH}
          )
          RETURNING 1
        `);
        return res.rows.length;
      });
      total += removed;
      if (removed < AUDIT_BATCH) break;
    }
    return total;
  }
}
