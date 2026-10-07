import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { V1Me, V1Usage } from '@crm/contracts';
import { RequestContextStore } from '../../../../../common/context/request-context';
import { AppError } from '../../../../../common/errors/app-error';
import { DatabaseService } from '../../../../../infra/db/database.service';
import { PlanCatalogService, PlanUsageService } from '../../../../plans-subscriptions-trials';
import { WalletQueryService } from '../../../../wallet-message-billing';
import { toMe, toUsage } from './account.mapper';

/** `/me` and `/usage` (TW-API-020, 021): the workspace, its plan and its meters, from the same services the billing screens use. */
@Injectable()
export class AccountService {
  constructor(
    private readonly db: DatabaseService,
    private readonly usageSvc: PlanUsageService,
    private readonly catalog: PlanCatalogService,
    private readonly wallet: WalletQueryService,
  ) {}

  async me(): Promise<V1Me> {
    const ctx = RequestContextStore.require();
    const usage = await this.usageSvc.usage(ctx.orgId);
    const bits = await this.db.tx(async (tx) => {
      const org = await tx.execute(
        sql`SELECT uuid, name, slug, settings FROM organizations WHERE id = ${ctx.orgId}`,
      );
      const o = org.rows[0] as
        | { uuid: string; name: string; slug: string; settings: Record<string, unknown> | null }
        | undefined;
      if (!o || !usage) return null;
      const user =
        ctx.userId == null
          ? undefined
          : (
              await tx.execute(
                sql`SELECT full_name, email FROM users WHERE org_id = ${ctx.orgId} AND id = ${ctx.userId}`,
              )
            ).rows[0];
      const u = user as { full_name: string; email: string } | undefined;
      const plan = await this.catalog.findBySlug(tx, usage.planSlug);
      return {
        user: { name: u?.full_name ?? null, email: u?.email ?? null },
        org: { uuid: o.uuid, name: o.name, slug: o.slug, settings: o.settings ?? {} },
        planIsFree: plan?.is_free ?? false,
      };
    });
    if (!bits || !usage) throw AppError.notFound('Workspace');
    return toMe({ ...bits, usage });
  }

  async usage(): Promise<V1Usage> {
    const ctx = RequestContextStore.require();
    const usage = await this.usageSvc.usage(ctx.orgId);
    if (!usage) throw AppError.notFound('Workspace');
    const wallet = await this.wallet.summary();
    return toUsage(usage, { balanceMinor: wallet.balanceMinor, currency: wallet.currency });
  }
}
