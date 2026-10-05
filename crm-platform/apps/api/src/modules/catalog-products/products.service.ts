import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  PRODUCT_PICKER_LIMIT,
  type CreateProductInput,
  type ListProductsQuery,
  type ListProductsResponse,
  type ProductPickerQuery,
  type ProductPickerResponse,
  type ProductResponse,
  type ProductShareLinks,
  type SendProductInput,
  type SendProductResponse,
  type UpdateProductInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  BAILEYS_CATALOG_BRIDGE,
  CatalogProviderError,
  type BaileysCatalogBridge,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { PlanUsageService } from '../plans-subscriptions-trials';
import {
  CONVERSATION_MIRROR,
  SENDER_DIRECTORY,
  SHOP_DIRECTORY,
  type ConversationMirror,
  type SenderDirectory,
  type ShopDirectory,
} from './_shims/tokens';
import { majorStringToMinor } from './catalog-money';
import { CatalogSyncService } from './catalog-sync.service';
import {
  changedSyncFields,
  digitsOf,
  retailerIdOf,
  nextFreeSlug,
  normalizeGallery,
  normalizeTags,
  productShareCaption,
  slugify,
  waOrderText,
} from './catalog-rules';
import { toPickerItem, toProductResponse } from './products.mapper';
import {
  decodeProductCursor,
  encodeProductCursor,
  ProductsRepository,
  type ProductPatch,
  type ProductRow,
} from './products.repository';

export const PRODUCT_MODULE = 'products';

const blank = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

/** RFC 3986 percent-encoding, which also escapes `!'()*` (PHP's `rawurlencode`). */
const rawurlencode = (s: string) =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

type FormInput = CreateProductInput | UpdateProductInput;

/** The columns the product form sets; the same mapping serves create and update (WD-CAT-020). */
function formPatch(input: FormInput): ProductPatch {
  const tags = normalizeTags(input.tags);
  const gallery = normalizeGallery(input.galleryUrls);
  const compare =
    input.comparePriceMajor == null ? null : majorStringToMinor(input.comparePriceMajor);
  return {
    name: input.name,
    sku: blank(input.sku),
    description: blank(input.description),
    body_html: blank(input.bodyHtml),
    price_minor: majorStringToMinor(input.priceMajor),
    // WaDesk treated a compare price of 0 as "none".
    compare_price_minor: compare ? compare : null,
    currency_code: input.currencyCode,
    in_stock: input.inStock,
    stock_qty: input.stockQty ?? null,
    sort_order: input.sortOrder ?? 0,
    status: input.status,
    weight_grams: input.weightGrams ?? null,
    category: blank(input.category),
    tags_json: tags.length > 0 ? tags : null,
    image_url: blank(input.imageUrl),
    gallery_json: gallery.length > 0 ? gallery : null,
    ...(input.aliases !== undefined
      ? {
          // The matcher compares lower-cased text, so aliases are stored lower-cased and de-duplicated.
          aliases_json: normalizeTags(input.aliases.map((a) => a.toLowerCase())).length
            ? normalizeTags(input.aliases.map((a) => a.toLowerCase()))
            : null,
        }
      : {}),
  };
}

/** The value a column of the patch will hold, in the row's own vocabulary, to tell what really changed. */
function currentValue(row: ProductRow, column: string): unknown {
  switch (column) {
    case 'body_html':
      return row.bodyHtml;
    case 'price_minor':
      return row.priceMinor;
    case 'compare_price_minor':
      return row.comparePriceMinor;
    case 'currency_code':
      return row.currencyCode;
    case 'in_stock':
      return row.inStock;
    case 'stock_qty':
      return row.stockQty;
    case 'sort_order':
      return row.sortOrder;
    case 'weight_grams':
      return row.weightGrams;
    case 'tags_json':
      return row.tags.length > 0 ? row.tags : null;
    case 'image_url':
      return row.imageUrl;
    case 'gallery_json':
      return row.gallery.length > 0 ? row.gallery : null;
    case 'aliases_json':
      return Array.isArray(row.aliases) && row.aliases.length > 0 ? row.aliases : null;
    default:
      return (row as unknown as Record<string, unknown>)[column];
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Products (WD-CAT-019..024). Every write is one transaction holding the change, its audit row and its outbox event. A
 * catalog-relevant change also emits `catalog.product_changed`; the push to Meta follows the commit and never fails the save.
 *
 * Deviations from WaDesk, each recorded in the parity file: hard delete (WaDesk soft-deleted); `rowVersion` on edit; the search
 * box is scoped to the workspace (WaDesk's `orWhere` leaked SKU matches of other workspaces).
 */
@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ProductsRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly sync: CatalogSyncService,
    @Inject(SHOP_DIRECTORY) private readonly shops: ShopDirectory,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(BAILEYS_CATALOG_BRIDGE) private readonly bridge: BaileysCatalogBridge,
    @Inject(CONVERSATION_MIRROR) private readonly mirror: ConversationMirror,
    private readonly planUsage: PlanUsageService,
  ) {}

  // --- reads ---------------------------------------------------------------------------------------------------------------

  async list(query: ListProductsQuery): Promise<ListProductsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, {
        q: query.q,
        limit: query.limit,
        cursor: query.cursor ? decodeProductCursor(query.cursor) : undefined,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map(toProductResponse),
        page: {
          nextCursor:
            hasMore && last
              ? encodeProductCursor({ sortOrder: last.sortOrder, id: last.id })
              : null,
          hasMore,
          limit: query.limit,
        },
        ...(query.includeTotal
          ? { meta: { total: await this.repo.count(tx, ctx.orgId, query.q) } }
          : {}),
      };
    });
  }

  async get(uuid: string): Promise<ProductResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Product', uuid);
      return toProductResponse(row);
    });
  }

  /** Active, in-stock products for the pickers (inbox, chat, Send tab). With `shopId`: that shop's and the shared (no shop) ones. */
  async picker(query: ProductPickerQuery): Promise<ProductPickerResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let shopId: number | undefined;
      if (query.shopId)
        shopId = (await this.shops.findByUuid(tx, ctx.orgId, query.shopId))?.id ?? -1;
      const rows = await this.repo.picker(tx, ctx.orgId, {
        q: query.q || undefined,
        shopId,
        limit: PRODUCT_PICKER_LIMIT,
      });
      return { products: rows.map(toPickerItem) };
    });
  }

  /** The storefront page of the product and a `wa.me` link with a ready order text (WD-CAT-022). */
  async shareLinks(uuid: string): Promise<ProductShareLinks> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const p = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!p) throw AppError.notFound('Product', uuid);
      const shop = await this.shops.oldest(tx, ctx.orgId);
      const publicUrl = shop ? `${shop.publicUrl.replace(/\/+$/, '')}/p/${p.slug}` : null;
      const number = digitsOf(await this.senders.primaryPhone(tx, ctx.orgId));
      const waLink = number ? `https://wa.me/${number}?text=${rawurlencode(waOrderText(p))}` : null;
      return { publicUrl, waLink, product: { id: p.uuid, name: p.name, image: p.imageUrl } };
    });
  }

  // --- writes --------------------------------------------------------------------------------------------------------------

  async create(input: CreateProductInput): Promise<ProductResponse> {
    const ctx = RequestContextStore.require();
    // The plan's `catalog_products` cap (a live count, so deleting a product frees a slot). Products pulled in by a catalog sync are not user creates and are not capped.
    await this.planUsage.assertCanAdd(ctx.orgId, 'catalog_products');
    const { id, pushNeeded } = await this.db.tx(async (tx) => {
      const base = slugify(input.name) || 'product';
      const slug = nextFreeSlug(base, await this.repo.slugsLike(tx, ctx.orgId, base));
      const newId = await this.repo.insert(tx, ctx.orgId, {
        ...formPatch(input),
        slug,
        user_id: ctx.userId,
      });
      const row = (await this.repo.findById(tx, ctx.orgId, newId))!;
      await this.audit.record(tx, {
        module: PRODUCT_MODULE,
        recordId: row.id,
        action: 'insert',
        delta: {
          name: { old: null, new: row.name },
          sku: { old: null, new: row.sku },
          priceMinor: { old: null, new: row.priceMinor },
          currencyCode: { old: null, new: row.currencyCode },
          status: { old: null, new: row.status },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: PRODUCT_MODULE,
        aggregateId: row.id,
        eventType: 'product.created',
        payload: { uuid: row.uuid, name: row.name, sku: row.sku, status: row.status },
      });
      await this.outbox.emit(tx, {
        aggregateModule: PRODUCT_MODULE,
        aggregateId: row.id,
        eventType: 'catalog.product_changed',
        payload: { uuid: row.uuid, created: true },
      });
      return { id: row.id, pushNeeded: true };
    });
    if (pushNeeded) await this.sync.pushOne(ctx.orgId, id);
    return this.reload(ctx.orgId, id);
  }

  async update(uuid: string, input: UpdateProductInput): Promise<ProductResponse> {
    const ctx = RequestContextStore.require();
    const outcome = await this.db.tx(async (tx) => {
      const before = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!before) throw AppError.notFound('Product', uuid);
      if (input.rowVersion !== before.rowVersion) throw AppError.rowVersionConflict('Product');

      const patch = formPatch(input);
      const changedColumns = Object.keys(patch).filter(
        (c) => !same(patch[c], currentValue(before, c)),
      );
      if (changedColumns.length === 0) return { id: before.id, pushNeeded: false };

      const changedPatch = Object.fromEntries(
        changedColumns.map((c) => [c, patch[c]]),
      ) as ProductPatch;
      if (!(await this.repo.update(tx, ctx.orgId, before.id, input.rowVersion, changedPatch))) {
        throw AppError.rowVersionConflict('Product');
      }
      const after = (await this.repo.findById(tx, ctx.orgId, before.id))!;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const c of changedColumns)
        delta[c] = { old: currentValue(before, c), new: currentValue(after, c) };
      await this.audit.record(tx, {
        module: PRODUCT_MODULE,
        recordId: before.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: PRODUCT_MODULE,
        aggregateId: before.id,
        eventType: 'product.updated',
        payload: { uuid: after.uuid, changed: changedColumns },
      });
      const sync = changedSyncFields(before, after);
      if (sync.length > 0) {
        await this.outbox.emit(tx, {
          aggregateModule: PRODUCT_MODULE,
          aggregateId: before.id,
          eventType: 'catalog.product_changed',
          payload: { uuid: after.uuid, fields: sync },
        });
      }
      return { id: before.id, pushNeeded: sync.length > 0 };
    });
    if (outcome.pushNeeded) await this.sync.pushOne(ctx.orgId, outcome.id);
    return this.reload(ctx.orgId, outcome.id);
  }

  /** Hard delete (WaDesk soft-deleted); nothing is removed from Meta, as before. Reviews and holds go with the product. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!row) throw AppError.notFound('Product', uuid);
      await this.audit.record(tx, {
        module: PRODUCT_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { name: { old: row.name, new: null }, sku: { old: row.sku, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: PRODUCT_MODULE,
        aggregateId: row.id,
        eventType: 'product.deleted',
        payload: { uuid: row.uuid, name: row.name },
      });
      await this.repo.delete(tx, ctx.orgId, row.id);
    });
  }

  private reload(orgId: number, id: number): Promise<ProductResponse> {
    return this.db.tx(async (tx: Tx) => {
      const row = await this.repo.findById(tx, orgId, id);
      if (!row) throw AppError.notFound('Product');
      return toProductResponse(row);
    });
  }

  // --- send one product (WD-CAT-023) ---------------------------------------------------------------------------------------

  /**
   * Sends the product image with a caption (name, price, a short description and the shop link) to one number through the
   * workspace's connected device. It needs no Meta catalog, and unlike a catalog send it leaves no row in the activity log
   * (WaDesk marked these messages `product_share`, which the Activity tab does not read).
   */
  async sendToNumber(uuid: string, input: SendProductInput): Promise<SendProductResponse> {
    const ctx = RequestContextStore.require();
    const digits = digitsOf(input.phone);
    if (digits.length < 7) {
      throw AppError.validation('Enter a valid WhatsApp number with country code.', [
        { path: 'phone', message: 'Enter a valid WhatsApp number with country code.' },
      ]);
    }
    const plan = await this.db.tx(async (tx) => {
      const product = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!product) throw AppError.notFound('Product', uuid);
      const device = await this.senders.baileysDevice(tx, ctx.orgId, undefined);
      if (!device) {
        throw new AppError(
          ERROR_CODES.CAT_NO_SENDER,
          'No connected WhatsApp device. Pair one at /devices first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const shop = await this.shops.oldest(tx, ctx.orgId);
      return {
        product,
        device,
        link: shop ? `${shop.publicUrl.replace(/\/+$/, '')}/p/${product.slug}` : null,
      };
    });
    if (!plan.device.phone) {
      throw new AppError(
        ERROR_CODES.CAT_NO_SENDER,
        'Sending device has no phone number.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const caption = productShareCaption({
      name: plan.product.name,
      priceMinor: plan.product.priceMinor,
      currencyCode: plan.product.currencyCode,
      description: plan.product.description,
      link: plan.link,
    });
    const image = (plan.product.imageUrl ?? '').trim();
    let messageId: string | null;
    try {
      const sent = image
        ? await this.bridge.sendImage({
            senderPhone: plan.device.phone,
            to: digits,
            imageUrl: image,
            caption,
          })
        : await this.bridge.sendText({ senderPhone: plan.device.phone, to: digits, text: caption });
      messageId = sent.messageId;
    } catch (err) {
      if (err instanceof CatalogProviderError) {
        throw new AppError(
          ERROR_CODES.CAT_SEND_FAILED,
          `Could not deliver: ${err.meta.raw ?? err.message}`,
          HttpStatus.BAD_GATEWAY,
        );
      }
      throw err;
    }
    await this.mirror.mirrorCatalogSend({
      orgId: ctx.orgId,
      recipientDigits: digits,
      userId: ctx.userId,
      source: 'product_share',
      mode: 'spm',
      body: caption,
      provider: 'baileys',
      messageId,
      products: [
        {
          id: plan.product.id,
          name: plan.product.name,
          imageUrl: plan.product.imageUrl,
          priceMinor: plan.product.priceMinor,
          currency: plan.product.currencyCode,
          retailerId: retailerIdOf(plan.product),
        },
      ],
    });
    await this.db.tx((tx) =>
      this.audit.record(tx, {
        module: PRODUCT_MODULE,
        recordId: plan.product.id,
        action: 'export',
        // The number is not stored in full: the trail says a product left, and to whom by its last four digits.
        delta: { sentTo: { old: null, new: `***${digits.slice(-4)}` } },
      }),
    );
    this.logger.debug({ orgId: ctx.orgId }, 'product shared');
    return { message: `Product sent to ${digits}.` };
  }
}
