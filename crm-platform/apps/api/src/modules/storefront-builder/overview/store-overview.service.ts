import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ERROR_CODES, type StoreOverview, type StoreOverviewQuery } from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { StorefrontProductsReader } from '../../catalog-products';
import { ORDERS_GATEWAY, type OrdersGateway } from '../_shims/tokens';
import { ShopsRepository } from '../shops/shops.repository';
import { ShopsService } from '../shops/shops.service';

const WINDOW_DAYS = 30;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-10-02` as the dashboard labels a bucket: `Oct 02`. */
export const dayLabel = (iso: string): string => {
  const [, m, d] = iso.split('-');
  return `${MONTHS[Number(m) - 1] ?? m} ${d}`;
};

/**
 * The store dashboard (WD-STORE-001): the last 30 days, the five best sellers and the eight newest orders.
 *
 * Every number is workspace-wide (every shop, every channel, every order status, cancelled ones included) exactly as in
 * WaDesk: `shopId` only chooses which shop the page is about (its currency, link and switcher). A shop id that is not one of
 * the workspace's falls back to the most recently updated shop, as WaDesk did.
 */
@Injectable()
export class StoreOverviewService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ShopsRepository,
    private readonly shops: ShopsService,
    private readonly products: StorefrontProductsReader,
    @Inject(ORDERS_GATEWAY) private readonly orders: OrdersGateway,
  ) {}

  async overview(query: StoreOverviewQuery): Promise<StoreOverview> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const all = await this.repo.listByUpdated(tx, ctx.orgId);
      const shop = (query.shopId ? all.find((s) => s.uuid === query.shopId) : undefined) ?? all[0];
      if (!shop) {
        throw new AppError(
          ERROR_CODES.STORE_NO_SHOP,
          'This workspace has no shop yet.',
          HttpStatus.NOT_FOUND,
        );
      }

      const win = await this.orders.window(tx, ctx.orgId, WINDOW_DAYS);
      const [views, productCount, byDay, top, recent, shopResponse] = await Promise.all([
        this.repo.viewsSince(tx, ctx.orgId, WINDOW_DAYS),
        this.products.countProducts(tx, ctx.orgId),
        this.orders.salesByDay(tx, ctx.orgId, WINDOW_DAYS),
        this.orders.topProducts(tx, ctx.orgId, WINDOW_DAYS, 5),
        this.orders.recent(tx, ctx.orgId, 8),
        this.shops.respond(tx, ctx.orgId, shop),
      ]);

      return {
        shop: shopResponse,
        shops: all.map((s) => ({ id: s.uuid, shopName: s.shopName, slug: s.slug })),
        stats: {
          revenue30: win.revenueMinor,
          orders30: win.orders,
          aov: win.orders > 0 ? Math.round(win.revenueMinor / win.orders) : 0,
          products: productCount,
          storefrontViews30: views,
        },
        salesByDay: {
          labels: byDay.map((b) => dayLabel(b.day)),
          // Whole major units, truncated, as WaDesk drew them.
          revenue: byDay.map((b) => Math.trunc(b.revenueMinor / 100)),
          orders: byDay.map((b) => b.orders),
        },
        topProducts: top,
        recentOrders: recent.map((o) => ({
          id: o.uuid,
          orderNo: o.id,
          customerName: o.customerName,
          customerPhone: o.customerPhone,
          itemsCount: o.itemsCount,
          totalMinor: o.totalMinor,
          currencyCode: o.currencyCode,
          status: o.status,
          source: o.source,
          createdAt: o.createdAt.toISOString(),
        })),
      };
    });
  }
}
