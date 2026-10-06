import { Inject, Injectable } from '@nestjs/common';
import type { StoreDashboard } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { WOOCOMMERCE, type WooFactory } from '../../infra/providers/ecom/ecom.port';
import { ECOM_PLAN_GATE, type EcomPlanGate } from './_shims/tokens';
import {
  trend14,
  wooDashboardCustomer,
  wooDashboardOrder,
  wooDashboardProduct,
} from './dashboard-rules';
import { DashboardRepository } from './dashboard.repository';
import type { StoreKind } from './mirror-rules';
import { StoresRepository, type WooRow } from './stores.repository';

const SHOPIFY_PRODUCTS = 120;
const SHOPIFY_ORDERS = 20;
const SHOPIFY_CUSTOMERS = 50;
const WOO_LIVE = 10;
const HIGHLIGHTS = 8;

/**
 * The store dashboard (WD-ECOM-023). One read for every tab. Shopify is served from the CRM's mirror of the store. WooCommerce
 * reads recent orders, products, customers and the 30 day sales report live from the store (a store that does not answer leaves
 * those empty; the CRM figures still come from the mirror), as WaDesk does.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly stores: StoresRepository,
    private readonly data: DashboardRepository,
    @Inject(ECOM_PLAN_GATE) private readonly plan: EcomPlanGate,
    @Inject(WOOCOMMERCE) private readonly woo: WooFactory,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  async get(kind: StoreKind, uuid: string): Promise<StoreDashboard> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, kind);
    const store = await this.db.tx(async (tx) =>
      kind === 'shopify'
        ? this.stores.shopifyByUuid(tx, orgId, uuid)
        : this.stores.wooByUuid(tx, orgId, uuid),
    );
    if (!store)
      throw AppError.notFound(kind === 'shopify' ? 'Shopify store' : 'WooCommerce store', uuid);
    const currency = 'shopCurrency' in store ? store.shopCurrency : store.storeCurrency;
    const meta = store.metadata as {
      shopify_group_id?: unknown;
      woo_group_id?: unknown;
      senderKey?: unknown;
    } | null;
    const groupRaw = kind === 'shopify' ? meta?.shopify_group_id : meta?.woo_group_id;
    const groupId = typeof groupRaw === 'number' ? groupRaw : null;

    const live = 'consumerKey' in store ? await this.liveWoo(store) : null;
    const mirror = await this.db.tx(async (tx) => {
      const [
        products,
        orders,
        customers,
        counts,
        logs,
        activeEvents,
        analytics,
        templates,
        contactGroups,
        coupons,
        offerProducts,
        senders,
      ] = await Promise.all([
        kind === 'shopify'
          ? this.data.products(tx, orgId, kind, SHOPIFY_PRODUCTS)
          : Promise.resolve([]),
        kind === 'shopify'
          ? this.data.orders(tx, orgId, kind, SHOPIFY_ORDERS)
          : Promise.resolve([]),
        kind === 'shopify'
          ? this.data.customers(tx, orgId, groupId, SHOPIFY_CUSTOMERS)
          : this.data.customers(tx, orgId, groupId, 0),
        this.data.counts(tx, orgId, kind),
        this.data.logSummary(tx, orgId, kind, store.id),
        this.data.activeEvents(tx, orgId, kind, store.id),
        this.data.analytics(tx, orgId, kind, store.id),
        this.data.templates(tx, orgId),
        this.data.contactGroups(tx, orgId),
        this.data.coupons(tx, orgId),
        this.data.offerProducts(tx, orgId, kind),
        kind === 'woocommerce'
          ? this.data.senders(tx, orgId, await this.unofficial.isEnabled())
          : Promise.resolve([]),
      ]);
      return {
        products,
        orders,
        customers,
        counts,
        logs,
        activeEvents,
        analytics,
        templates,
        contactGroups,
        coupons,
        offerProducts,
        senders,
      };
    });

    const shop = kind === 'shopify';
    const aovMinor = mirror.analytics.orders
      ? mirror.analytics.revenueMinor / mirror.analytics.orders
      : 0;
    const aov = aovMinor / 100;
    const trend = trend14(mirror.analytics.byDay, new Date());
    const orders = shop ? mirror.orders : (live?.orders ?? []);
    const products = shop ? mirror.products : (live?.products ?? []);
    const money = currency ?? orders[0]?.currency ?? 'USD';

    return {
      currency: money,
      counts: shop
        ? {
            products: mirror.counts.products,
            orders: mirror.counts.orders,
            customers: mirror.customers.total,
          }
        : (live?.counts ?? { products: 0, orders: 0, customers: 0 }),
      activeEvents: mirror.activeEvents,
      logTotal: mirror.logs.total,
      logsByStatus: mirror.logs.byStatus,
      logsByEvent: mirror.logs.byEvent,
      recentLogs: mirror.logs.recent,
      orders,
      products,
      offers: shop
        ? products
            .filter((p) => p.comparePrice !== null && p.comparePrice > p.price)
            .slice(0, HIGHLIGHTS)
        : [],
      newArrivals: shop ? products.slice(0, HIGHLIGHTS) : [],
      popular: shop ? [...products].sort((a, b) => b.price - a.price).slice(0, HIGHLIGHTS) : [],
      customers: shop ? mirror.customers.rows : (live?.customers ?? []),
      templates: mirror.templates,
      contactGroups: mirror.contactGroups,
      coupons: mirror.coupons,
      offerProducts: mirror.offerProducts,
      analytics: {
        revenueTotal: mirror.analytics.revenueMinor / 100,
        ordersTotal: mirror.analytics.orders,
        aov,
        messagesSent: mirror.analytics.messagesSent,
        offersSent: mirror.analytics.offersSent,
        trend,
        trendMax: Math.max(1, ...trend.map((t) => t.value)),
        codConfirmed: mirror.analytics.codConfirmed,
        codCancelled: mirror.analytics.codCancelled,
        codProtected: mirror.analytics.codConfirmed * aov,
        rtoAvoided: mirror.analytics.codCancelled * aov,
        recoverySends: mirror.analytics.recoverySends,
      },
      // Shopify: the revenue of the recent synced orders shown (as WaDesk). WooCommerce: the store's own 30 day sales report.
      revenue30d: shop ? orders.reduce((sum, o) => sum + o.total, 0) : (live?.sales.total ?? 0),
      woo: shop
        ? null
        : {
            orders30d: live?.sales.orders ?? 0,
            customers30d: live?.sales.customers ?? 0,
            itemsSold30d: live?.sales.items ?? 0,
            senders: mirror.senders,
            senderKey: typeof meta?.senderKey === 'string' ? meta.senderKey : null,
          },
    };
  }

  /** WooCommerce's live reads. Each answers empty when the store does not, and never throws. */
  private async liveWoo(store: WooRow) {
    if (store.consumerKey === '') return null;
    const api = this.woo.store(
      store.storeUrl,
      this.crypto.decrypt(store.consumerKey),
      this.crypto.decrypt(store.consumerSecret),
    );
    const fallback = store.storeCurrency ?? 'USD';
    const [counts, orders, products, customers, report] = await Promise.all([
      api.counts().catch(() => ({ products: 0, orders: 0, customers: 0 })),
      api.recent('orders', WOO_LIVE).catch(() => []),
      api.recent('products', WOO_LIVE).catch(() => []),
      api.recent('customers', WOO_LIVE).catch(() => []),
      api.salesReport(30).catch(() => ({}) as Record<string, unknown>),
    ]);
    const num = (x: unknown): number => {
      const v = Number.parseFloat(String(x ?? ''));
      return Number.isFinite(v) ? v : 0;
    };
    return {
      counts,
      orders: orders.map((o) => wooDashboardOrder(o, fallback)),
      products: products.map(wooDashboardProduct),
      customers: customers.map(wooDashboardCustomer),
      sales: {
        total: num(report.total_sales),
        orders: Math.round(num(report.total_orders)),
        customers: Math.round(num(report.total_customers)),
        items: Math.round(num(report.total_items)),
      },
    };
  }
}
