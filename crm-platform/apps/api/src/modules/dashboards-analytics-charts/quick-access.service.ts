import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type DashQuickAccessResponse as QuickAccessResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { effectiveQuickAccess, quickAccessTiles, sanitizeQuickAccess } from './quick-access';

const respond = (stored: unknown): QuickAccessResponse => {
  const items = effectiveQuickAccess(stored);
  return { items, tiles: quickAccessTiles(items) };
};

/** TW-DASH-009: the caller's own tiles, kept on `user_settings.quick_access`. Own row only; last write wins (a preference, not a record). */
@Injectable()
export class QuickAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  private who() {
    const { orgId, userId } = RequestContextStore.require();
    if (!userId) throw AppError.forbidden('quick-access');
    return { orgId, userId };
  }

  async get(): Promise<QuickAccessResponse> {
    const { orgId, userId } = this.who();
    return this.db.tx(async (tx) => {
      const r = await tx.execute(
        sql`SELECT quick_access FROM user_settings WHERE org_id = ${orgId} AND user_id = ${userId}`,
      );
      return respond((r.rows[0] as { quick_access?: unknown } | undefined)?.quick_access);
    });
  }

  async save(input: unknown): Promise<QuickAccessResponse & { ok: true }> {
    const { orgId, userId } = this.who();
    const items = sanitizeQuickAccess(input);
    return this.db.tx(async (tx) => {
      const old = await tx.execute(
        sql`SELECT quick_access FROM user_settings WHERE org_id = ${orgId} AND user_id = ${userId}`,
      );
      const row = await tx.execute(sql`
        INSERT INTO user_settings (org_id, user_id, quick_access)
        VALUES (${orgId}, ${userId}, ${JSON.stringify(items)}::jsonb)
        ON CONFLICT (org_id, user_id) DO UPDATE SET quick_access = EXCLUDED.quick_access
        RETURNING id`);
      await this.audit.record(tx, {
        module: 'user_settings',
        recordId: Number((row.rows[0] as { id: unknown }).id),
        action: 'update',
        delta: {
          quickAccess: {
            old: (old.rows[0] as { quick_access?: unknown } | undefined)?.quick_access ?? null,
            new: items,
          },
        },
      });
      return { ok: true as const, ...respond(items) };
    });
  }
}
