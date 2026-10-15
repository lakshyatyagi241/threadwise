import { Injectable } from '@nestjs/common';
import type { ViberInsights, ViberInsightsQuery } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { ChannelsRepository } from './channels.repository';
import { InsightsRepository } from './insights.repository';
import { lastDays, validTimeZone } from './insights-rules';

const DAYS = 7;

/** Viber insights (TW-VIB-016): message volume, active users and receipt rates for one channel over seven days. Nothing is stored. */
@Injectable()
export class InsightsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InsightsRepository,
    private readonly channels: ChannelsRepository,
  ) {}

  async view(q: ViberInsightsQuery): Promise<ViberInsights> {
    const { orgId } = RequestContextStore.require();
    const list = await this.db.tx((tx) => this.channels.list(tx, orgId));
    const channel = list.find((c) => c.uuid === q.channel) ?? list[0];
    const brief = list.map((c) => ({ id: c.uuid, name: c.name }));
    const empty = { in: 0, out: 0, users: 0, delivered: 0, seen: 0, failed: 0 };
    const tz = validTimeZone(q.tz);
    const days = lastDays(tz, new Date(), DAYS);
    if (!channel) {
      return {
        channels: brief,
        channelId: null,
        rows: days.map((d) => ({ date: d, in: 0, out: 0 })),
        totals: empty,
      };
    }

    const { perDay, totals } = await this.db.tx(async (tx) => ({
      perDay: await this.repo.trend(tx, orgId, channel.id, tz, days[0]!),
      totals: await this.repo.totals(tx, orgId, channel.id, tz, days[0]!),
    }));
    const rows = days.map((date) => ({
      date,
      in: perDay.get(date)?.in ?? 0,
      out: perDay.get(date)?.out ?? 0,
    }));
    return {
      channels: brief,
      channelId: channel.uuid,
      rows,
      totals: {
        in: rows.reduce((n, r) => n + r.in, 0),
        out: rows.reduce((n, r) => n + r.out, 0),
        ...totals,
      },
    };
  }
}
