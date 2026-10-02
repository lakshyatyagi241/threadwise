import { Injectable } from '@nestjs/common';
import type { PaygwOrdersQuery, PaygwOrdersResponse } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { toOrderResponse, trimMoney } from './orders.mapper';
import { OrdersRepository } from './orders.repository';

/** The signed-in user's own purchases (TW-PAYGW-035), newest first, cursor-paginated, with lifetime spend per currency. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersRepository,
  ) {}

  async listMine(query: PaygwOrdersQuery): Promise<PaygwOrdersResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    const userId = ctx.userId;
    return this.db.tx(async (tx) => {
      const rows = await this.orders.listForUser(tx, ctx.orgId, userId, query.limit, query.cursor);
      const { items, page } = buildPage(rows, query.limit);
      const spend = await this.orders.lifetimeSpend(tx, ctx.orgId, userId);
      return {
        data: items.map(toOrderResponse),
        page,
        lifetimeSpend: spend.map((s) => ({ ...s, total: trimMoney(s.total, s.currency) })),
      };
    });
  }
}
