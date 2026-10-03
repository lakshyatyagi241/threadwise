import { timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  STORE_PAGE_SIZE,
  STORE_THEME_KEYS,
  type HostResolveResponse,
  type PublicHome,
  type PublicHomeQuery,
  type PublicOrder,
  type PublicProductPage,
  type PublicReviewInput,
  type PublicShop,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { STOREFRONT_ENV, type StorefrontEnv } from '../../../config/domains/storefront-builder.env';
import { DatabaseService } from '../../../infra/db/database.service';
import { StorefrontProductsReader } from '../../catalog-products';
import {
  SENDER_DIRECTORY,
  type SenderDirectory,
  ORDERS_GATEWAY,
  type OrdersGateway,
} from '../_shims/tokens';
import { ShopUrlService } from '../shops/shop-url.service';
import { ShopsRepository, type ShopRow } from '../shops/shops.repository';
import { notAvailable, PublicShopLoader, type ShopHandle } from './public-shop.loader';
import { toPublicProduct, toPublicShop } from './public.mapper';

const RELATED_LIMIT = 8;
const REVIEWS_LIMIT = 20;
/** Str::random(40) is alphanumeric; anything else cannot be a tracking token. */
const TOKEN_SHAPE = /^[A-Za-z0-9]{8,64}$/;

/** The public shop's reads (WD-STORE-009, 010, 016, 017, 021). No sign-in: the slug names the tenant. */
@Injectable()
export class PublicCatalogService {
  private readonly logger = new Logger(PublicCatalogService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly loader: PublicShopLoader,
    private readonly shops: ShopsRepository,
    private readonly urls: ShopUrlService,
    private readonly products: StorefrontProductsReader,
    @Inject(ORDERS_GATEWAY) private readonly orders: OrdersGateway,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(STOREFRONT_ENV) private readonly env: StorefrontEnv,
  ) {}

  /** The shop block of every public response. */
  async publicShop(tx: Tx, shop: ShopRow): Promise<PublicShop> {
    const [waNumber, orgName] = await Promise.all([
      this.senders.waNumber(tx, shop.orgId, shop.deviceId),
      this.shops.orgName(tx, shop.orgId),
    ]);
    return toPublicShop(shop, {
      orgName,
      waNumber,
      publicUrl: this.urls.publicUrl(shop),
      knownThemes: STORE_THEME_KEYS,
    });
  }

  async home(slug: string, query: PublicHomeQuery): Promise<PublicHome> {
    const handle = await this.loader.resolve(slug);
    const page = Math.max(1, query.page);
    const result = await this.db.txAs({ orgId: handle.orgId }, async (tx) => {
      const shop = await this.loader.shop(tx, handle);
      const list = await this.products.listAvailable(tx, handle.orgId, handle.storefrontId, {
        offset: (page - 1) * STORE_PAGE_SIZE,
        limit: STORE_PAGE_SIZE,
      });
      return { shop: await this.publicShop(tx, shop), list };
    });

    // A full render counts as a view; the "show more" fetches (page 2 and up) do not (WD-STORE-020).
    if (page === 1) await this.countView(handle);

    const cards = result.list.rows.map(toPublicProduct);
    const prices = result.list.rows.map((p) => p.priceMinor);
    return {
      shop: result.shop,
      products: cards,
      // Categories and the price range come from the page being shown, as in WaDesk (a known limit, kept).
      categories: [
        ...new Set(result.list.rows.map((p) => p.category).filter((c): c is string => !!c)),
      ],
      priceMin: prices.length ? Math.round(Math.min(...prices) / 100) : 0,
      priceMax: prices.length ? Math.round(Math.max(...prices) / 100) : 0,
      hasMore: (page - 1) * STORE_PAGE_SIZE + result.list.rows.length < result.list.total,
      total: result.list.total,
      page,
    };
  }

  async product(slug: string, productSlug: string): Promise<PublicProductPage> {
    const handle = await this.loader.resolve(slug);
    const page = await this.db.txAs({ orgId: handle.orgId }, async (tx) => {
      const shop = await this.loader.shop(tx, handle);
      const product = await this.products.findAvailableBySlug(
        tx,
        handle.orgId,
        handle.storefrontId,
        productSlug,
      );
      if (!product) throw AppError.notFound('Product');
      const [related, reviews] = await Promise.all([
        this.products.related(tx, handle.orgId, handle.storefrontId, product, RELATED_LIMIT),
        this.products.approvedReviews(tx, handle.orgId, product.id, REVIEWS_LIMIT),
      ]);
      return { shop: await this.publicShop(tx, shop), product, related, reviews };
    });
    await this.countView(handle);

    const { reviews } = page;
    const avg = reviews.length
      ? Math.round((reviews.reduce((s, r) => s + r.rating, 0) / reviews.length) * 10) / 10
      : null;
    return {
      shop: page.shop,
      product: toPublicProduct(page.product),
      related: page.related.map(toPublicProduct),
      reviews: reviews.map((r) => ({
        id: r.uuid,
        customerName: r.customerName,
        rating: r.rating,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      })),
      ratingAvg: avg,
      // The number of reviews LOADED (at most 20), not the total approved: WaDesk's count, kept.
      ratingCount: reviews.length,
    };
  }

  /** The tracking page (WD-STORE-017): the order must belong to this shop and the token must match exactly. */
  async order(slug: string, token: string): Promise<PublicOrder> {
    if (!TOKEN_SHAPE.test(token)) throw notAvailable();
    const handle = await this.loader.resolve(slug);
    return this.db.txAs({ orgId: handle.orgId }, async (tx) => {
      const shop = await this.loader.shop(tx, handle);
      const order = await this.orders.findByToken(tx, handle.orgId, handle.storefrontId, token);
      if (!order || !order.recoveryToken || !sameToken(order.recoveryToken, token)) {
        throw AppError.notFound('Order');
      }
      return {
        shop: await this.publicShop(tx, shop),
        order: {
          orderNo: order.id,
          status: order.status,
          paymentMethod: order.paymentMethod,
          customerName: order.customerName,
          items: order.items.map((i) => ({
            name: String(i.name ?? ''),
            qty: Number(i.qty ?? 1),
            priceMinor: Number(i.price_minor ?? 0),
            image: typeof i.image === 'string' && i.image !== '' ? i.image : null,
          })),
          shippingMinor: order.shippingMinor,
          discountMinor: order.discountMinor,
          totalMinor: order.totalMinor,
          currencyCode: order.currencyCode,
          paymentLink: order.paymentLink,
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
        },
      };
    });
  }

  /** A review from the public shop, stored pending (WD-STORE-016). */
  async review(slug: string, input: PublicReviewInput): Promise<{ message: string }> {
    const handle = await this.loader.resolve(slug);
    await this.db.txAs({ orgId: handle.orgId }, async (tx) => {
      await this.loader.shop(tx, handle);
      const stored = await this.products.createPendingReview(tx, handle.orgId, {
        storefrontId: handle.storefrontId,
        productUuid: input.productId,
        customerName: input.name,
        rating: input.rating,
        body: input.body ? input.body : null,
      });
      if (!stored) throw AppError.validation('Unknown product.');
    });
    return { message: 'Thanks! Your review will appear once approved.' };
  }

  /**
   * Which shop a host serves (WD-STORE-021): a verified custom domain first, then `<slug>.<STOREFRONT_HOST>` when subdomain
   * mode is on. One configured host is used both to advertise and to resolve subdomains (WaDesk advertised one host and
   * resolved another). The workspace-level custom domain belongs to the workspaces domain and is not consulted here.
   */
  async resolveHost(rawHost: string): Promise<HostResolveResponse> {
    const host = rawHost.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
    if (!host) throw AppError.notFound('Shop');

    const custom = await this.db.primary.execute(
      sql`SELECT * FROM store_public_lookup_host(${host})`,
    );
    const row = custom.rows[0] as { slug: string; enabled: boolean } | undefined;
    if (row) {
      if (!row.enabled) throw AppError.notFound('Shop');
      return { slug: row.slug };
    }

    const parent = this.env.storefrontHost;
    if (parent && host.endsWith(`.${parent}`)) {
      const candidate = host.slice(0, -(parent.length + 1));
      // A multi-label left part (`a.b`) is looked up as the slug `a.b` and fails, as in WaDesk.
      if (candidate && !candidate.includes('.')) {
        await this.loader.resolve(candidate);
        return { slug: candidate };
      }
    }
    throw AppError.notFound('Shop');
  }

  /** `views + 1` for today. Analytics never break the page: any failure is logged and dropped. */
  private async countView(handle: ShopHandle): Promise<void> {
    try {
      await this.db.txAs({ orgId: handle.orgId }, (tx) =>
        this.shops.bumpView(tx, handle.orgId, handle.storefrontId),
      );
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[STORE] view could not be counted');
    }
  }
}

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
