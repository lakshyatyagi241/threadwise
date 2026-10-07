import { Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  extSheetsProductRowSchema,
  productCurrencySchema,
  type ExtSheetsRowResult,
  type ExtSheetsShopsResponse,
  type ExtSheetsSyncRequest,
  type ExtSheetsSyncResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ProductsRepository, ProductsService } from '../catalog-products';
import { ShopsService } from '../storefront-builder';
import { toSheetsShop } from './sheets-addon.mapper';
import type { SheetsCallerState } from './sheets-access';
import { SheetsRunLog } from './sheets-run-log.service';
import { failedRow, refOf, rowIssue, summarize } from './sheets-row.rules';

/**
 * The shop and product side of the add-on (TW-EXT-008 to 010): Reference's own behaviour. A sheet of products becomes a shop's catalogue. The
 * shop is saved first; each product row is then written through the product form's own create and update (so the plan's product cap, the
 * audit trail, the events and the push to Meta are the same as for a product added by hand), matched by SKU, then by name, and a bad row is
 * reported without stopping the rest (Reference refused the whole request for one bad row).
 */
@Injectable()
export class SheetsCatalogService {
  private readonly logger = new Logger(SheetsCatalogService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly shops: ShopsService,
    private readonly products: ProductsService,
    private readonly productsRepo: ProductsRepository,
    private readonly runs: SheetsRunLog,
  ) {}

  async listShops(workspaceUuid: string): Promise<ExtSheetsShopsResponse> {
    const ctx = RequestContextStore.require();
    const [shops, total] = await Promise.all([
      this.shops.listForIntegration(),
      // Products are not tied to one shop, so every shop reports the workspace's count (as in Reference).
      this.db.tx((tx) => this.productsRepo.countAll(tx, ctx.orgId)),
    ]);
    return {
      ok: true,
      shops: shops.map((s) => toSheetsShop(s, total)),
      workspace: workspaceUuid,
      product_count_total: total,
    };
  }

  async sync(
    caller: SheetsCallerState,
    body: ExtSheetsSyncRequest,
  ): Promise<ExtSheetsSyncResponse> {
    const ctx = RequestContextStore.require();
    const { shop, created: shopCreated } = await this.shops.upsertForIntegration({
      uuid: body.shop_id,
      shopName: body.shop_name,
      description: body.description,
      currencyCode: body.currency,
      themeKey: body.theme_key,
    });
    const currency = productCurrencySchema.safeParse(shop.currencyCode);

    const results: ExtSheetsRowResult[] = [];
    for (const [index, raw] of body.products.entries()) {
      const parsed = extSheetsProductRowSchema.safeParse(raw);
      if (!parsed.success) {
        results.push(rowIssue(index, raw, parsed.error));
        continue;
      }
      const row = parsed.data;
      const ref = refOf(raw);
      if (!currency.success) {
        results.push(
          failedRow(
            index,
            ref,
            ERROR_CODES.VALIDATION_FAILED,
            `The shop's currency ${shop.currencyCode} cannot be used for products.`,
            'currency',
          ),
        );
        continue;
      }
      try {
        const existing = await this.db.tx((tx) =>
          this.productsRepo.findBySkuOrName(tx, ctx.orgId, { sku: row.sku, name: row.name }),
        );
        const need = existing ? 'cat.products.update' : 'cat.products.create';
        if (!caller.holds(need)) {
          results.push(
            failedRow(
              index,
              ref,
              ERROR_CODES.FORBIDDEN,
              existing ? 'Your role cannot edit products.' : 'Your role cannot create products.',
            ),
          );
          continue;
        }
        const out = await this.products.upsertForIntegration({
          name: row.name,
          sku: row.sku,
          category: row.category,
          description: row.description,
          imageUrl: row.image_url,
          // toFixed keeps a value like 1e-7 in a form the product form accepts; the form rounds to the minor unit.
          priceMajor: Number.isInteger(row.price) ? String(row.price) : row.price.toFixed(6),
          currencyCode: currency.data,
          stockQty: row.stock,
          active: row.active,
        });
        results.push({
          index,
          ...(ref !== undefined ? { ref } : {}),
          status: out.created ? 'created' : out.changed ? 'updated' : 'unchanged',
          id: out.product.id,
        });
      } catch (err) {
        results.push(this.asFailure(index, ref, err));
      }
    }

    const summary = summarize(results);
    await this.runs.record(caller.owner.settingsId, 'products', body.products.length, summary);
    return {
      ok: true,
      shop: {
        id: shop.uuid,
        shop_name: shop.shopName,
        slug: shop.slug,
        currency: shop.currencyCode,
        public_url: shop.publicUrl,
        created: shopCreated,
      },
      products: { ...summary, results },
    };
  }

  private asFailure(
    index: number,
    ref: ExtSheetsRowResult['ref'],
    err: unknown,
  ): ExtSheetsRowResult {
    if (err instanceof AppError) {
      const body = err.getResponse() as { code: string; message: string };
      const first = err.details?.[0];
      return failedRow(
        index,
        ref,
        body.code,
        first?.message ?? body.message,
        first?.path || undefined,
      );
    }
    this.logger.error({ err }, 'sheets add-on: a product row failed unexpectedly');
    return failedRow(
      index,
      ref,
      ERROR_CODES.INTERNAL,
      'This row could not be saved. Try it again.',
    );
  }
}
