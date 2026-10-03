import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  createCreditPackageRequestSchema,
  currencyExponent,
  minorToMajor,
  slugifyPackageName,
  type CreateCreditPackagePayload,
  type CreditPackageItem,
  type CreditPackageListResponse,
  type UpdateCreditPackagePayload,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService } from '../auth';
import { CurrencyService } from '../platform-settings-branding-storage';
import { FALLBACK_CURRENCIES } from './coupon-admin.service';
import { majorDecimalToMinor } from './coupon-rules';
import { CpnStore, type UniqueMap } from './cpn-store';

interface PackageRow {
  id: string | number;
  uuid: string;
  name: string;
  slug: string;
  price_minor: string | number;
  currency_code: string;
  credits: string | number;
  badge: string | null;
  description: string | null;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  created_at: string | Date;
  updated_at: string | Date;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, name, slug, price_minor, currency_code, credits, badge, description, is_active, is_featured,
   sort_order, created_at, updated_at, row_version`,
);

const UNIQUE: UniqueMap = {
  uq_credit_packages_slug: {
    code: ERROR_CODES.CPN_PACKAGE_SLUG_TAKEN,
    message: 'Another credit package already uses this slug.',
  },
};

const iso = (v: string | Date): string => new Date(v).toISOString();

/** Credits per one major unit of the package currency, one decimal, half up ("55.0"). Exact: no float. */
export function creditsPerMajor(credits: number, priceMinor: number, currency: string): string {
  if (priceMinor <= 0) return '0.0';
  const exp = BigInt(currencyExponent(currency));
  const tenths =
    (BigInt(credits) * 10n ** exp * 10n * 2n + BigInt(priceMinor)) / (BigInt(priceMinor) * 2n);
  const s = tenths.toString().padStart(2, '0');
  return `${s.slice(0, -1)}.${s.slice(-1)}`;
}

export function toPackageItem(row: PackageRow, priceDisplay = ''): CreditPackageItem {
  const priceMinor = Number(row.price_minor);
  const credits = Number(row.credits);
  return {
    id: row.uuid,
    name: row.name,
    slug: row.slug,
    price: minorToMajor(BigInt(priceMinor), row.currency_code),
    priceMinor,
    priceDisplay,
    currencyCode: row.currency_code,
    credits,
    creditsPerMajor: creditsPerMajor(credits, priceMinor, row.currency_code),
    badge: row.badge,
    description: row.description,
    isActive: row.is_active,
    isFeatured: row.is_featured,
    sortOrder: row.sort_order,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    rowVersion: row.row_version,
  };
}

interface PackageFields {
  name: string;
  slug: string | null;
  price: string;
  currencyCode: string;
  credits: number;
  badge: string | null;
  description: string | null;
  isActive: boolean;
  isFeatured: boolean;
  sortOrder: number;
}

const toFields = (p: CreditPackageItem): PackageFields => ({
  name: p.name,
  slug: p.slug,
  price: p.price,
  currencyCode: p.currencyCode,
  credits: p.credits,
  badge: p.badge,
  description: p.description,
  isActive: p.isActive,
  isFeatured: p.isFeatured,
  sortOrder: p.sortOrder,
});

/**
 * The operator's credit-package catalogue (TW-CPN-009..013): every package in display order, create, update, activate or
 * deactivate, delete. One platform transaction per write, with its security event; updates are optimistic-locked.
 *
 * Differences from Reference (parity doc): the price is stored in the minor units of the package currency using that currency's own
 * number of decimals (Reference multiplied by 100 for every currency); a unique slug race is a 409 not a 500.
 */
@Injectable()
export class CreditPackageAdminService {
  constructor(
    private readonly store: CpnStore,
    private readonly audit: AuthAuditService,
    private readonly currencies: CurrencyService,
  ) {}

  /** The package with its price shown the way Reference's `price_display` does: converted into the platform default currency. */
  private async present(row: PackageRow): Promise<CreditPackageItem> {
    const price = minorToMajor(BigInt(Number(row.price_minor)), row.currency_code);
    return toPackageItem(row, await this.currencies.display(price, row.currency_code, null));
  }

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  async list(): Promise<CreditPackageListResponse> {
    return this.store
      .tx(async (tx) => {
        const res = await tx.execute(
          sql`SELECT ${COLUMNS} FROM credit_packages ORDER BY sort_order ASC, id ASC`,
        );
        return res.rows as unknown as PackageRow[];
      })
      .then(async (rows) => ({
        data: await Promise.all(rows.map((r) => this.present(r))),
        defaultSymbol: await this.currencies.symbolFor(await this.currencies.effectiveCode()),
      }));
  }

  async get(uuid: string): Promise<CreditPackageItem> {
    return this.present(await this.store.tx((tx) => this.byUuid(tx, uuid)));
  }

  async create(body: CreateCreditPackagePayload): Promise<CreditPackageItem> {
    const operatorId = this.operatorId();
    return this.store
      .tx(async (tx) => {
        await this.assertCurrency(tx, body.currencyCode);
        const slug = body.slug ?? (await this.freeSlug(tx, body.name, null));
        const res = await tx.execute(sql`
        INSERT INTO credit_packages (name, slug, price_minor, currency_code, credits, badge, description,
                                     is_active, is_featured, sort_order)
        VALUES (${body.name}, ${slug}, ${majorDecimalToMinor(body.price, body.currencyCode).toString()}::bigint,
                ${body.currencyCode}, ${body.credits}, ${body.badge}, ${body.description},
                ${body.isActive}, ${body.isFeatured}, ${body.sortOrder})
        RETURNING ${COLUMNS}`);
        const item = toPackageItem(res.rows[0] as unknown as PackageRow);
        await this.record(tx, 'platform.credit_package.created', operatorId, {
          slug: item.slug,
          name: item.name,
          price: item.price,
          currencyCode: item.currencyCode,
          credits: item.credits,
        });
        return res.rows[0] as unknown as PackageRow;
      }, UNIQUE)
      .then((row) => this.present(row));
  }

  async update(uuid: string, patch: UpdateCreditPackagePayload): Promise<CreditPackageItem> {
    const operatorId = this.operatorId();
    return this.store
      .tx(async (tx) => {
        const stored = await this.byUuid(tx, uuid, true);
        if (stored.row_version !== patch.rowVersion) {
          throw AppError.rowVersionConflict('The credit package');
        }
        const before = toPackageItem(stored);
        const { rowVersion: _rv, ...fields } = patch;
        void _rv;
        const defined = Object.fromEntries(
          Object.entries(fields).filter(([, v]) => v !== undefined),
        ) as Partial<PackageFields>;
        const merged = { ...toFields(before), ...defined };

        const checked = createCreditPackageRequestSchema.safeParse(merged);
        if (!checked.success) {
          throw AppError.validation(
            'The credit package failed validation.',
            checked.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
          );
        }
        const after = checked.data;
        await this.assertCurrency(tx, after.currencyCode);
        // A cleared slug is re-derived from the name on save (TW-CPN-011 rule 2).
        const slug = after.slug ?? (await this.freeSlug(tx, after.name, stored.id));

        const res = await tx.execute(sql`
        UPDATE credit_packages SET
          name = ${after.name}, slug = ${slug},
          price_minor = ${majorDecimalToMinor(after.price, after.currencyCode).toString()}::bigint,
          currency_code = ${after.currencyCode}, credits = ${after.credits}, badge = ${after.badge},
          description = ${after.description}, is_active = ${after.isActive},
          is_featured = ${after.isFeatured}, sort_order = ${after.sortOrder}
        WHERE id = ${stored.id} AND row_version = ${patch.rowVersion}
        RETURNING ${COLUMNS}`);
        if (res.rows.length === 0) throw AppError.rowVersionConflict('The credit package');
        const item = toPackageItem(res.rows[0] as unknown as PackageRow);

        const changes = diffFields(toFields(before), toFields(item));
        if (Object.keys(changes).length > 0) {
          await this.record(tx, 'platform.credit_package.updated', operatorId, {
            slug: item.slug,
            fields: Object.keys(changes),
            changes,
          });
        }
        return res.rows[0] as unknown as PackageRow;
      }, UNIQUE)
      .then((row) => this.present(row));
  }

  /** Idempotent: setting the state it already has changes nothing and writes no audit row. */
  async setActive(
    uuid: string,
    isActive: boolean,
    rowVersion?: number,
  ): Promise<CreditPackageItem> {
    const operatorId = this.operatorId();
    return this.store
      .tx(async (tx) => {
        const stored = await this.byUuid(tx, uuid, true);
        if (rowVersion !== undefined && stored.row_version !== rowVersion) {
          throw AppError.rowVersionConflict('The credit package');
        }
        if (stored.is_active === isActive) return stored;
        const res = await tx.execute(
          sql`UPDATE credit_packages SET is_active = ${isActive} WHERE id = ${stored.id} RETURNING ${COLUMNS}`,
        );
        await this.record(
          tx,
          isActive ? 'platform.credit_package.activated' : 'platform.credit_package.deactivated',
          operatorId,
          { slug: stored.slug },
        );
        return res.rows[0] as unknown as PackageRow;
      })
      .then((row) => this.present(row));
  }

  /** Hard delete, as Reference: orders and ledger rows keep their own copies of price and credits (the order's package id is nulled). */
  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    await this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      await tx.execute(sql`DELETE FROM credit_packages WHERE id = ${stored.id}`);
      await this.record(tx, 'platform.credit_package.deleted', operatorId, {
        slug: stored.slug,
        name: stored.name,
      });
    });
  }

  // --- internals ------------------------------------------------------------------------------------------------------------

  private async byUuid(tx: Tx, uuid: string, lock = false): Promise<PackageRow> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${COLUMNS} FROM credit_packages WHERE uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${COLUMNS} FROM credit_packages WHERE uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as PackageRow | undefined;
    if (!row) throw AppError.notFound('Credit package');
    return row;
  }

  /** The currency must be one the dropdown offered: an active catalog currency, or the five fallbacks while the catalog is empty. */
  private async assertCurrency(tx: Tx, code: string): Promise<void> {
    const res = await tx.execute(sql`SELECT code FROM currencies WHERE is_active`);
    const active = (res.rows as unknown as Array<{ code: string }>).map((r) => r.code);
    const allowed = active.length > 0 ? active : FALLBACK_CURRENCIES.map((c) => c.code as string);
    if (!allowed.includes(code)) {
      throw new AppError(
        ERROR_CODES.CPN_CURRENCY_UNKNOWN,
        'Choose one of the active currencies.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'currencyCode', message: code }],
      );
    }
  }

  /** The name's slug, with `-2`, `-3`... appended until no OTHER package has it. */
  private async freeSlug(tx: Tx, name: string, exceptId: string | number | null): Promise<string> {
    const base = slugifyPackageName(name);
    const res = await tx.execute(
      sql`SELECT slug FROM credit_packages WHERE id IS DISTINCT FROM ${exceptId}::bigint AND (slug = ${base} OR slug LIKE ${base + '-%'})`,
    );
    const taken = new Set((res.rows as unknown as Array<{ slug: string }>).map((r) => r.slug));
    let slug = base;
    for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
    return slug;
  }

  private async record(
    tx: Tx,
    event: string,
    operatorId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload,
    });
  }
}

function diffFields(
  before: PackageFields,
  after: PackageFields,
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(after) as Array<keyof PackageFields>) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changes[key] = { from: before[key], to: after[key] };
    }
  }
  return changes;
}
