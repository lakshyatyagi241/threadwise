import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type SetWorkspaceCurrencyRequest,
  type WorkspaceCurrencyResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, PlatformStore } from '../auth';
import { CurrencyService, SettingsService } from '../platform-settings-branding-storage';

/**
 * A workspace's display currency (TW-CPN-027): the currency its money is shown in and the base of its checkout and wallet. Null
 * follows the platform default (so a default change moves it); a code the owner picked stays until they change it. The owner picks
 * from ACTIVE catalog currencies (Reference's dropdown showed only those but its validator accepted any catalog row).
 *
 * Where it lives: the workspace's settings document (`organizations.settings.currency`), which the first-run onboarding step, the
 * account profile and the sales documents already read and write. It is mirrored to `workspace_settings.currency`, the column the
 * reseller billing reads, in the same transaction, so the two can never disagree.
 */
@Injectable()
export class WorkspaceCurrencyService {
  constructor(
    private readonly db: DatabaseService,
    private readonly store: PlatformStore,
    private readonly settings: SettingsService,
    private readonly money: CurrencyService,
    private readonly audit: AuthAuditService,
  ) {}

  async get(): Promise<WorkspaceCurrencyResponse> {
    const ctx = RequestContextStore.require();
    const [own, platformDefault, options] = await Promise.all([
      this.db.tx(async (tx) => {
        const res = await tx.execute(sql`
          SELECT coalesce(nullif(o.settings->>'currency', ''), (SELECT ws.currency FROM workspace_settings ws WHERE ws.org_id = o.id)) AS currency
          FROM organizations o WHERE o.id = ${ctx.orgId}`);
        return ((res.rows[0] as { currency: string | null } | undefined)?.currency ?? null) || null;
      }),
      this.settings.values('general').then((g) => (g.defaultCurrency || 'USD').toUpperCase()),
      this.store.tx(async (tx) => {
        const res = await tx.execute(
          sql`SELECT code, name, symbol FROM currencies WHERE is_active ORDER BY code`,
        );
        return res.rows as unknown as Array<{ code: string; name: string; symbol: string | null }>;
      }),
    ]);
    const currency = own ? own.toUpperCase() : null;
    return { currency, effective: currency ?? platformDefault, platformDefault, options };
  }

  async set(req: SetWorkspaceCurrencyRequest): Promise<WorkspaceCurrencyResponse> {
    const ctx = RequestContextStore.require();
    const next = req.currency;
    if (next !== null) {
      const ok = await this.store.tx(
        async (tx) =>
          (await tx.execute(sql`SELECT 1 FROM currencies WHERE code = ${next} AND is_active`)).rows
            .length > 0,
      );
      if (!ok) {
        throw new AppError(
          ERROR_CODES.CPN_WORKSPACE_CURRENCY_INVALID,
          `${next} is not an available currency.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'currency', message: 'Choose one of the listed currencies.' }],
        );
      }
    }
    await this.db.tx(async (tx) => {
      const before = await tx.execute(
        sql`SELECT nullif(settings->>'currency', '') AS currency FROM organizations WHERE id = ${ctx.orgId}`,
      );
      await tx.execute(sql`
        UPDATE organizations
        SET settings = CASE WHEN ${next}::text IS NULL THEN settings - 'currency'
                            ELSE settings || jsonb_build_object('currency', ${next}::text) END
        WHERE id = ${ctx.orgId}`);
      await tx.execute(sql`
        INSERT INTO workspace_settings (org_id, currency) VALUES (${ctx.orgId}, ${next})
        ON CONFLICT (org_id) DO UPDATE SET currency = EXCLUDED.currency`);
      await this.audit.record(tx, {
        event: 'workspace.currency_changed',
        status: 'info',
        payload: {
          previous: (before.rows[0] as { currency: string | null } | undefined)?.currency ?? null,
          now: next,
        },
      });
    });
    this.money.flush();
    return this.get();
  }
}
