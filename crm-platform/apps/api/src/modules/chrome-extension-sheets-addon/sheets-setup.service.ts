import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  listProductsQuerySchema,
  type ExtSheetsOverview,
  type ExtSheetsShop,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { readSheetsAddonEnv } from '../../config/domains/chrome-extension-sheets-addon.env';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { ProductsRepository, ProductsService } from '../catalog-products';
import { ShopsService } from '../storefront-builder';
import { capabilitiesOf } from './sheets-access';
import { SheetsAppAccess } from './sheets-app-access.service';
import { SheetsFilesService } from './sheets-files.service';
import { SheetsKeyRepository } from './sheets-key.repository';
import { toKeyStatus } from './sheets-key.service';

/**
 * Everything the add-on setup page draws, in one call (WD-EXT-006): the member's key, whether the add-on is installed, what their role lets
 * it do, the source files, and (when their role may read the catalog) the shops and the products that landed last, which is how a member
 * checks that a sync arrived where they expected.
 */
@Injectable()
export class SheetsSetupService {
  constructor(
    private readonly db: DatabaseService,
    private readonly keys: SheetsKeyRepository,
    private readonly access: SheetsAppAccess,
    private readonly files: SheetsFilesService,
    private readonly shops: ShopsService,
    private readonly products: ProductsService,
    private readonly productsRepo: ProductsRepository,
    private readonly rbac: RbacService,
    private readonly config: ConfigService,
  ) {}

  async overview(): Promise<ExtSheetsOverview> {
    const ctx = RequestContextStore.require();
    const env = readSheetsAddonEnv(this.config);
    const holds = (key: string) => this.rbac.can(ctx.grants!, key).allowed;
    const install = await this.access.find(ctx.orgId);
    const can = capabilitiesOf(install ?? { grantedScopes: [] }, holds);

    const [key, files] = await Promise.all([
      this.db.tx((tx) => this.keys.read(tx, ctx.orgId, ctx.userId!)),
      this.files.list(),
    ]);

    let shops: ExtSheetsShop[] = [];
    let productCount = 0;
    let recent: ExtSheetsOverview['recentProducts'] = [];
    if (holds('cat.products.read') && holds('store.storefront.read')) {
      const [list, total, page] = await Promise.all([
        this.shops.listForIntegration(),
        this.db.tx((tx) => this.productsRepo.countAll(tx, ctx.orgId)),
        this.products.list(listProductsQuerySchema.parse({ limit: 100 })),
      ]);
      shops = list.map((s) => ({
        id: s.uuid,
        shopName: s.shopName,
        slug: s.slug,
        currency: s.currencyCode,
        enabled: s.enabled,
        themeKey: s.themeKey,
        customDomain: s.customDomain,
        publicUrl: s.publicUrl,
        updatedAt: s.updatedAt.toISOString(),
      }));
      productCount = total;
      recent = [...page.data]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 5)
        .map((p) => ({
          id: p.id,
          name: p.name,
          priceMajor: p.priceMajor,
          currencyCode: p.currencyCode,
          imageUrl: p.imageUrl,
          createdAt: p.createdAt,
        }));
    }

    return {
      installed: install !== null,
      blockers: install ? [] : ['not_installed'],
      marketplaceUrl: env.marketplaceUrl,
      apiBase: env.apiBase,
      key: toKeyStatus(key),
      can,
      files,
      shops,
      productCount,
      recentProducts: recent,
    };
  }
}
