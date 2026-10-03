import { Injectable } from '@nestjs/common';
import type {
  PaygwConfirmRequest,
  PaygwConfirmResponse,
  PaygwOrdersQuery,
  PaygwOrdersResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { buildPage } from '../../common/pagination/cursor';
import { DatabaseService } from '../../infra/db/database.service';
import { toOrderResponse, trimMoney } from './orders.mapper';
import { OrdersRepository } from './orders.repository';
import { PaymentConfirmationService } from './payment-confirmation.service';

/** The signed-in user's own purchases (WD-PAYGW-035), newest first, cursor-paginated, with lifetime spend per currency. */
@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly orders: OrdersRepository,
    private readonly confirmation: PaymentConfirmationService,
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

  /**
   * An in-app client confirms its own order (WD-PAYGW-034). Only the user who placed the order may; another workspace's order is
   * not found. The driver verifies whatever the client posts; the client's word alone changes nothing.
   */
  async confirmMine(orderUuid: string, req: PaygwConfirmRequest): Promise<PaygwConfirmResponse> {
    const ctx = RequestContextStore.require();
    if (!ctx.userId) throw AppError.unauthenticated();
    const order = await this.db.tx((tx) => this.orders.byUuid(tx, orderUuid));
    if (!order || order.userId !== ctx.userId) throw AppError.notFound('Order', orderUuid);
    const { outcome, alreadyPaid } = await this.confirmation.confirm(order, req.payload);
    return {
      orderNumber: order.orderNumber,
      status: outcome === 'success' ? 'paid' : outcome,
      alreadyPaid,
    };
  }
}
