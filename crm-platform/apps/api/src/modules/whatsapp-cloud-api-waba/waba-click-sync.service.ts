import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WABA_ADMIN,
  type WabaAdminPort,
  type WabaConnection,
} from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaConnectService } from './waba-connect.service';

const DAY_S = 86_400;
const MAX_BACK_DAYS = 89;

/** Meta's analytics window for a campaign: its creation day start (never more than 89 days back) to the start of tomorrow. */
export function clickWindow(createdAt: Date, now: Date): { start: number; end: number } {
  const dayStart = (d: Date) => Math.floor(d.getTime() / 1000 / DAY_S) * DAY_S;
  const today = dayStart(now);
  return {
    start: Math.max(dayStart(createdAt), today - MAX_BACK_DAYS * DAY_S),
    end: today + DAY_S,
  };
}

/** Insights are off until somebody turns them on; Meta words the refusal in a few ways. */
export const insightsDisabled = (message: string): boolean => /insight/i.test(message);

interface CampaignRow {
  org_id: number | string;
  id: number | string;
  created_at: Date | string;
  tids: Array<number | string | null>;
}

/**
 * Pulls Meta's button-click counts for recent WhatsApp template campaigns onto `wpcampaigns.meta_clicked_count` (WD-WABA-053),
 * because Meta sends no click webhook. Campaign analytics show the larger of redirect clicks and these.
 *
 * Attribution is per template and window, so two campaigns that share a template on overlapping days both count its clicks
 * (WaDesk's documented limit, kept). One campaign failing never stops the run.
 */
@Injectable()
export class WabaClickSyncService {
  private readonly logger = new Logger(WabaClickSyncService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly connect: WabaConnectService,
    @Inject(WABA_ADMIN) private readonly admin: WabaAdminPort,
  ) {}

  /** `days` is how far back to look (at least 1); `campaignId` syncs one campaign of `orgId` whatever its age. */
  async run(
    opts: { days?: number; orgId?: number; campaignId?: number; now?: Date } = {},
  ): Promise<number> {
    const now = opts.now ?? new Date();
    const days = Math.max(1, opts.days ?? 14);
    const rows = await this.db.privileged(async (tx) => {
      const res = await tx.execute(
        opts.campaignId && opts.orgId
          ? sql`SELECT org_id, id, created_at, ARRAY[template_id, template_id_a, template_id_b] AS tids
                  FROM wpcampaigns WHERE org_id = ${opts.orgId} AND id = ${opts.campaignId} AND provider = 'waba'`
          : sql`SELECT org_id, id, created_at, ARRAY[template_id, template_id_a, template_id_b] AS tids
                  FROM wpcampaigns
                 WHERE provider = 'waba' AND created_at >= ${new Date(now.getTime() - days * DAY_S * 1000)}
                 ORDER BY created_at DESC LIMIT 500`,
      );
      return res.rows as unknown as CampaignRow[];
    });
    let synced = 0;
    for (const c of rows) {
      try {
        if (await this.one(c, now)) synced++;
      } catch (err) {
        this.logger.warn(
          { campaignId: Number(c.id), err: String(err) },
          'template clicks could not be synced',
        );
      }
    }
    return synced;
  }

  private async one(c: CampaignRow, now: Date): Promise<boolean> {
    const orgId = Number(c.org_id);
    const ids = [...new Set(c.tids.filter((t): t is number | string => t !== null).map(Number))];
    if (ids.length === 0) return false;

    // Templates with a Meta id, grouped by the WABA row they live on; one analytics call per WABA.
    const byConfig = await this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT provider_config_id, meta_template_id FROM wa_templates
             WHERE org_id = ${orgId} AND id IN (${sql.join(
               ids.map((i) => sql`${i}`),
               sql`, `,
             )})
               AND meta_template_id IS NOT NULL AND provider_config_id IS NOT NULL`,
      );
      const groups = new Map<number, string[]>();
      for (const r of res.rows as Array<{
        provider_config_id: number | string;
        meta_template_id: string;
      }>) {
        const k = Number(r.provider_config_id);
        groups.set(k, [...(groups.get(k) ?? []), String(r.meta_template_id)]);
      }
      return groups;
    });
    if (byConfig.size === 0) return false;

    const { start, end } = clickWindow(new Date(c.created_at), now);
    let total = 0;
    for (const [configId, metaIds] of byConfig) {
      const resolved = await this.db.txAs({ orgId }, (tx) =>
        this.connect.resolveConnection(tx, orgId, { id: configId }),
      );
      if (!resolved?.conn) continue;
      total += await this.clicks(resolved.conn, metaIds, start, end);
    }
    await this.db.txAs({ orgId }, (tx) =>
      tx.execute(
        sql`UPDATE wpcampaigns SET meta_clicked_count = ${total}, meta_analytics_synced_at = ${now}
             WHERE org_id = ${orgId} AND id = ${Number(c.id)}`,
      ),
    );
    return true;
  }

  private async clicks(
    conn: WabaConnection,
    metaIds: string[],
    start: number,
    end: number,
  ): Promise<number> {
    try {
      return await this.admin.getTemplateClicks(conn, metaIds, start, end);
    } catch (err) {
      if (!insightsDisabled(String((err as Error).message))) throw err;
      await this.admin.enableTemplateInsights(conn);
      return this.admin.getTemplateClicks(conn, metaIds, start, end);
    }
  }
}
