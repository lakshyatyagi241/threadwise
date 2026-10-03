import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, STORE_SLUG_MAX } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { ShopsRepository, type ShopRow } from '../shops/shops.repository';

export interface ShopHandle {
  orgId: number;
  storefrontId: number;
}

export const notAvailable = () =>
  new AppError(
    ERROR_CODES.STORE_NOT_AVAILABLE,
    'This store is not available.',
    HttpStatus.NOT_FOUND,
  );

/**
 * How a public request finds its organization.
 *
 * The slug names the tenant, and the row that does is behind row-level security, so the first step is the narrow SECURITY
 * DEFINER function of migration 20261010200100 (three columns for one slug, nothing else). Every read and write after it runs
 * under the normal tenant context. An unknown and a disabled shop are the same 404: the caller cannot tell them apart.
 */
@Injectable()
export class PublicShopLoader {
  constructor(
    private readonly db: DatabaseService,
    private readonly shops: ShopsRepository,
  ) {}

  async resolve(slug: string): Promise<ShopHandle> {
    if (!slug || slug.length > STORE_SLUG_MAX) throw notAvailable();
    // Reference matched slugs through a case-insensitive MySQL collation, so /s/STP-AURORA opened the shop; slugs are stored lower case.
    const res = await this.db.primary.execute(
      sql`SELECT * FROM store_public_lookup_slug(${slug.toLowerCase()})`,
    );
    const row = res.rows[0] as
      | { storefront_id: number | string; store_org_id: number | string; enabled: boolean }
      | undefined;
    if (!row || !row.enabled) throw notAvailable();
    return { orgId: Number(row.store_org_id), storefrontId: Number(row.storefront_id) };
  }

  /** The shop row inside the tenant transaction; gone or disabled since the lookup is the same 404. */
  async shop(tx: Tx, handle: ShopHandle): Promise<ShopRow> {
    const shop = await this.shops.findById(tx, handle.orgId, handle.storefrontId);
    if (!shop || !shop.enabled) throw notAvailable();
    return shop;
  }
}
