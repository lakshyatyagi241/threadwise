import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { Env } from '../../../config/env.schema';
import type { ShopDirectory, ShopRow } from './tokens';

const toRow =
  (appUrl: string) =>
  (r: Record<string, unknown>): ShopRow => {
    const slug = r.slug as string;
    const domain = r.custom_domain as string | null;
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      shopName: (r.shop_name as string | null) ?? null,
      slug,
      // A verified custom domain, else the path-based address on the app (WaDesk's local/IP fallback; the wildcard-subdomain mode
      // needs a platform setting that does not exist here yet).
      publicUrl:
        domain && r.custom_domain_verified === true
          ? `https://${domain}`
          : `${appUrl.replace(/\/+$/, '')}/s/${slug}`,
    };
  };

/** Reads `wa_storefronts` directly until the storefront-builder domain exports its own lookup. */
@Injectable()
export class SqlShopDirectory implements ShopDirectory {
  constructor(private readonly config: ConfigService<Env, true>) {}

  private get appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  private async query(
    tx: Tx,
    orgId: number,
    where: ReturnType<typeof sql>,
    order: ReturnType<typeof sql>,
  ) {
    const res = await tx.execute(sql`
      SELECT id, uuid, shop_name, slug, custom_domain, custom_domain_verified
      FROM wa_storefronts WHERE org_id = ${orgId} ${where} ${order}`);
    return (res.rows as Array<Record<string, unknown>>).map(toRow(this.appUrl));
  }

  list(tx: Tx, orgId: number): Promise<ShopRow[]> {
    return this.query(tx, orgId, sql``, sql`ORDER BY id DESC`);
  }

  async oldest(tx: Tx, orgId: number): Promise<ShopRow | undefined> {
    return (await this.query(tx, orgId, sql``, sql`ORDER BY id LIMIT 1`))[0];
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ShopRow | undefined> {
    return (await this.query(tx, orgId, sql`AND uuid = ${uuid}::uuid`, sql`LIMIT 1`))[0];
  }
}
