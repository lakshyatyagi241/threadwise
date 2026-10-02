import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  walletMajorToMinor,
  type CreditPackage,
  type CreditPackageInput,
  type CreditPackageList,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { PlatformStore } from '../auth';
import { CurrencyService } from '../platform-settings-branding-storage';
import type { Operator } from './platform-wallet.service';
import { WalletLogService } from './wallet-log.service';
import { WalletSettingsService } from './wallet-settings.service';

interface Db {
  uuid: string;
  name: string;
  slug: string;
  price_minor: string;
  currency_code: string;
  credits: string;
  badge: string | null;
  description: string | null;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  row_version: number;
}

const FALLBACK_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED'];

/**
 * The operator's catalogue of credit packages (TW-WALLET-019): list, create, edit, activate or deactivate, delete. Same rules as
 * Reference (slug made from the name and made unique with -2, -3; a price of 0 is allowed; delete is hard and old ledger rows keep
 * their entries), plus: an edit is refused when the form is stale, every change is logged, and the currency must be one the
 * platform has active. Buying a package is not built (Reference retired its checkout): top-ups use any amount.
 */
@Injectable()
export class CreditPackagesService {
  constructor(
    private readonly store: PlatformStore,
    private readonly currencies: CurrencyService,
    private readonly settings: WalletSettingsService,
    private readonly log: WalletLogService,
  ) {}

  private map(r: Db): CreditPackage {
    const price = Number(r.price_minor);
    const credit = Number(r.credits);
    return {
      id: r.uuid,
      name: r.name,
      slug: r.slug,
      currency: r.currency_code,
      priceMinor: price,
      walletCreditMinor: credit,
      bonusPercent:
        price > 0 && credit > price ? Math.round(((credit - price) / price) * 10_000) / 100 : 0,
      badge: r.badge,
      description: r.description,
      isActive: r.is_active,
      isFeatured: r.is_featured,
      sortOrder: r.sort_order,
      rowVersion: r.row_version,
    };
  }

  private async allowedCurrencies(): Promise<string[]> {
    const res = await this.store.tx((tx) =>
      tx.execute(sql`SELECT code FROM currencies WHERE is_active ORDER BY code`),
    );
    const codes = (res.rows as Array<{ code: string }>).map((r) => r.code.toUpperCase());
    return codes.length > 0 ? codes : FALLBACK_CURRENCIES;
  }

  async list(): Promise<CreditPackageList> {
    const res = await this.store.tx((tx) =>
      tx.execute(sql`SELECT * FROM credit_packages ORDER BY sort_order, id`),
    );
    return {
      data: (res.rows as unknown as Db[]).map((r) => this.map(r)),
      currencies: await this.allowedCurrencies(),
    };
  }

  async create(input: CreditPackageInput, operator: Operator): Promise<CreditPackage> {
    const v = await this.validate(input);
    return this.store.tx(async (tx) => {
      const slug = await this.uniqueSlug(tx, input.slug || input.name, null);
      const res = await tx.execute(sql`
        INSERT INTO credit_packages (name, slug, price_minor, currency_code, credits, badge, description, is_active, is_featured, sort_order)
        VALUES (${input.name}, ${slug}, ${v.price}, ${input.currency}, ${v.credit}, ${input.badge || null}, ${input.description || null},
                ${input.isActive}, ${input.isFeatured}, ${input.sortOrder})
        RETURNING *`);
      const row = res.rows[0] as unknown as Db;
      await this.log.platform(tx, {
        event: 'platform.package.saved',
        message: `Credit package ${slug} created`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: {
          slug,
          priceMinor: v.price,
          walletCreditMinor: v.credit,
          currency: input.currency,
        },
      });
      return this.map(row);
    });
  }

  async update(
    uuid: string,
    input: CreditPackageInput,
    operator: Operator,
  ): Promise<CreditPackage> {
    const v = await this.validate(input);
    return this.store.tx(async (tx) => {
      const cur = await tx.execute(
        sql`SELECT * FROM credit_packages WHERE uuid = ${uuid}::uuid FOR UPDATE`,
      );
      const before = cur.rows[0] as unknown as Db | undefined;
      if (!before) throw AppError.notFound('Credit package');
      if (input.rowVersion !== undefined && input.rowVersion !== before.row_version) {
        throw AppError.rowVersionConflict('Credit package');
      }
      const slug = await this.uniqueSlug(tx, input.slug || input.name, before.slug);
      const res = await tx.execute(sql`
        UPDATE credit_packages SET name = ${input.name}, slug = ${slug}, price_minor = ${v.price}, currency_code = ${input.currency},
          credits = ${v.credit}, badge = ${input.badge || null}, description = ${input.description || null},
          is_active = ${input.isActive}, is_featured = ${input.isFeatured}, sort_order = ${input.sortOrder}
        WHERE uuid = ${uuid}::uuid RETURNING *`);
      await this.log.platform(tx, {
        event: 'platform.package.saved',
        message: `Credit package ${slug} updated`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: {
          priceMinor: { old: Number(before.price_minor), new: v.price },
          walletCreditMinor: { old: Number(before.credits), new: v.credit },
          isActive: { old: before.is_active, new: input.isActive },
        },
      });
      return this.map(res.rows[0] as unknown as Db);
    });
  }

  async toggle(uuid: string, operator: Operator): Promise<CreditPackage> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`UPDATE credit_packages SET is_active = NOT is_active WHERE uuid = ${uuid}::uuid RETURNING *`,
      );
      const row = res.rows[0] as unknown as Db | undefined;
      if (!row) throw AppError.notFound('Credit package');
      await this.log.platform(tx, {
        event: 'platform.package.saved',
        message: `Credit package ${row.slug} ${row.is_active ? 'activated' : 'deactivated'}`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: { isActive: row.is_active },
      });
      return this.map(row);
    });
  }

  async remove(uuid: string, operator: Operator): Promise<boolean> {
    const removed = await this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`DELETE FROM credit_packages WHERE uuid = ${uuid}::uuid RETURNING slug, price_minor, credits`,
      );
      const r = res.rows[0] as { slug: string } | undefined;
      if (!r) return false;
      await this.log.platform(tx, {
        event: 'platform.package.deleted',
        severity: 'warning',
        message: `Credit package ${r.slug} deleted`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: { slug: r.slug },
      });
      return true;
    });
    if (!removed) throw AppError.notFound('Credit package');
    return true;
  }

  private async validate(input: CreditPackageInput): Promise<{ price: number; credit: number }> {
    const allowed = await this.allowedCurrencies();
    if (!allowed.includes(input.currency)) {
      throw new AppError(
        ERROR_CODES.WALLET_PACKAGE_INVALID,
        `${input.currency} is not an active currency.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'currency', message: `Use one of ${allowed.join(', ')}` }],
      );
    }
    const price = walletMajorToMinor(input.price);
    const credit = walletMajorToMinor(input.walletCredit);
    if (price === null || credit === null || credit <= 0) {
      throw new AppError(
        ERROR_CODES.WALLET_PACKAGE_INVALID,
        'The price or the wallet credit is not a valid amount.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return { price, credit };
  }

  private async uniqueSlug(
    tx: Parameters<Parameters<PlatformStore['tx']>[0]>[0],
    base: string,
    own: string | null,
  ): Promise<string> {
    const root =
      base
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 90) || 'package';
    let slug = root;
    for (let n = 2; n < 1000; n++) {
      const taken = await tx.execute(
        sql`SELECT 1 FROM credit_packages WHERE slug = ${slug} AND (${own}::text IS NULL OR slug <> ${own})`,
      );
      if (taken.rows.length === 0) return slug;
      slug = `${root}-${n}`;
    }
    throw new AppError(
      ERROR_CODES.WALLET_PACKAGE_INVALID,
      'Could not make a unique slug.',
      HttpStatus.CONFLICT,
    );
  }
}
