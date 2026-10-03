import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  INVOICE_LOGO_MAX_KB,
  type BillingSettings,
  type BillingSettingsResponse,
  type InvoiceBillingBlock,
  type SaveBillingSettingsRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { DEFAULT_COUNTRIES } from './checkout-settings.service';
import { INVOICE_LOGO_MIMES, sniffImage } from './image-sniff';

/** WaDesk's key names, so checkout, the plan settings screen and the mobile app keep reading the same rows. */
const K = {
  taxEnabled: 'checkout.tax_enabled',
  taxRate: 'checkout.tax_rate',
  taxLabel: 'checkout.tax_label',
  refundEnabled: 'pricing.refund_enabled',
  refundDays: 'pricing.refund_days',
  yearlyToggle: 'pricing.yearly_toggle_enabled',
  yearlyDiscount: 'pricing.yearly_discount_pct',
  recurring: 'pricing.recurring_enabled',
  countries: 'checkout.countries',
  company: 'billing.company',
  address: 'billing.address',
  taxId: 'billing.tax_id',
  regNo: 'billing.reg_no',
  email: 'billing.email',
  phone: 'billing.phone',
} as const;
const KEYS = Object.values(K);
/** `set.asset.*` rows are left out of the settings snapshot, so a 1 MB logo never rides along on every settings read. */
const LOGO_KEY = 'set.asset.paygw-invoice-logo';
const LOCK = sql`SELECT pg_advisory_xact_lock(hashtext('paygw.billing_settings'))`;

interface Stored {
  mime: string;
  data: string;
  hash: string;
  size: number;
}

type Rows = Map<string, { value: unknown; at: Date }>;

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);
const int = (v: unknown, d: number, lo: number, hi: number): number => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi ? n : d;
};

/** WaDesk stored the list as a JSON string inside a JSON value; read both shapes. */
function countriesOf(v: unknown): string[] {
  let list: unknown = v;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  const arr = Array.isArray(list)
    ? list.filter((c): c is string => typeof c === 'string').map((c) => c.trim())
    : [];
  const clean = [...new Set(arr)].filter(Boolean);
  return clean.length > 0 ? clean : [...DEFAULT_COUNTRIES];
}

/**
 * The billing settings screen (WD-PAYGW-007): tax, refund window, yearly toggle, auto-renew switch, the checkout country list and
 * the company identity that prints on every invoice. One typed read and one atomic write over `platform_settings`; the save is
 * checked against the version the form was loaded with, so two operators cannot silently overwrite each other.
 *
 * Defaults live in ONE place (CheckoutSettingsService): a platform with nothing saved shows what checkout will actually do.
 */
@Injectable()
export class BillingSettingsService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly audit: AuthAuditService,
  ) {}

  private async rows(tx: Tx): Promise<Rows> {
    const res = await tx.execute(
      sql`SELECT key, value, updated_at FROM platform_settings
          WHERE is_secret = false AND key IN (${sql.join(
            KEYS.map((k) => sql`${k}`),
            sql`, `,
          )})`,
    );
    const out: Rows = new Map();
    for (const r of res.rows as unknown as Array<{
      key: string;
      value: unknown;
      updated_at: string;
    }>) {
      out.set(r.key, { value: r.value, at: new Date(r.updated_at) });
    }
    return out;
  }

  private versionOf(rows: Rows): string {
    let max = 0;
    for (const r of rows.values()) max = Math.max(max, r.at.getTime());
    return max === 0 ? 'none' : String(max);
  }

  private toSettings(rows: Rows): BillingSettings {
    const v = (k: string) => rows.get(k)?.value;
    return {
      // Tax is off until an operator turns it on (round 1's single source of defaults).
      taxEnabled: bool(v(K.taxEnabled), false),
      taxRate: int(v(K.taxRate), 0, 0, 100),
      taxLabel: str(v(K.taxLabel), 'Tax').slice(0, 32) || 'Tax',
      refundEnabled: bool(v(K.refundEnabled), true),
      refundDays: int(v(K.refundDays), 7, 0, 365),
      yearlyToggleEnabled: bool(v(K.yearlyToggle), true),
      yearlyDiscountPct: int(v(K.yearlyDiscount), 20, 0, 100),
      recurringEnabled: bool(v(K.recurring), true),
      countries: countriesOf(v(K.countries)),
      companyName: str(v(K.company)),
      companyAddress: str(v(K.address)),
      companyTaxId: str(v(K.taxId)),
      companyRegNo: str(v(K.regNo)),
      companyEmail: str(v(K.email)),
      companyPhone: str(v(K.phone)),
    };
  }

  private async logoHash(tx: Tx): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT value ->> 'hash' AS hash FROM platform_settings WHERE key = ${LOGO_KEY}`,
    );
    return (res.rows[0] as { hash: string | null } | undefined)?.hash ?? null;
  }

  async read(): Promise<BillingSettingsResponse> {
    return this.settings.inTx(async (tx) => {
      const rows = await this.rows(tx);
      const hash = await this.logoHash(tx);
      const counts = await tx.execute(
        sql`SELECT (SELECT count(*)::int FROM coupons) AS coupons, (SELECT count(*)::int FROM pricing_faqs) AS faqs`,
      );
      const c = counts.rows[0] as { coupons: number; faqs: number } | undefined;
      return {
        ...this.toSettings(rows),
        hasInvoiceLogo: hash !== null,
        invoiceLogoUrl: hash ? `/api/platform/billing/settings/logo?v=${hash}` : null,
        version: this.versionOf(rows),
        couponCount: c?.coupons ?? null,
        faqCount: c?.faqs ?? null,
      };
    });
  }

  async save(input: SaveBillingSettingsRequest): Promise<BillingSettingsResponse> {
    const actor = RequestContextStore.require();
    const next: BillingSettings = {
      ...input,
      countries: [...new Set(input.countries.map((c) => c.trim()).filter(Boolean))],
    };
    await this.settings.inTx(async (tx) => {
      await tx.execute(LOCK);
      const rows = await this.rows(tx);
      if (this.versionOf(rows) !== input.version) {
        throw AppError.rowVersionConflict('Billing settings');
      }
      const entries: Array<[string, unknown]> = [
        [K.taxEnabled, next.taxEnabled],
        [K.taxRate, next.taxRate],
        [K.taxLabel, next.taxLabel],
        [K.refundEnabled, next.refundEnabled],
        [K.refundDays, next.refundDays],
        [K.yearlyToggle, next.yearlyToggleEnabled],
        [K.yearlyDiscount, next.yearlyDiscountPct],
        [K.recurring, next.recurringEnabled],
        [K.countries, next.countries],
        [K.company, next.companyName],
        [K.address, next.companyAddress],
        [K.taxId, next.companyTaxId],
        [K.regNo, next.companyRegNo],
        [K.email, next.companyEmail],
        [K.phone, next.companyPhone],
      ];
      for (const [key, value] of entries) {
        await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${key}, ${JSON.stringify(value)}::jsonb, false, ${actor.actorId}, now())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
            WHERE NOT platform_settings.is_secret`);
      }
      await this.audit.record(tx, {
        event: 'platform.checkout_settings.updated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: actor.actorId,
        payload: {
          taxEnabled: next.taxEnabled,
          taxRate: next.taxRate,
          taxLabel: next.taxLabel,
          refundEnabled: next.refundEnabled,
          refundDays: next.refundDays,
          yearlyToggleEnabled: next.yearlyToggleEnabled,
          yearlyDiscountPct: next.yearlyDiscountPct,
          recurringEnabled: next.recurringEnabled,
          countryCount: next.countries.length,
        },
      });
    });
    return this.read();
  }

  // ---- invoice logo --------------------------------------------------------------------------------------------------

  async uploadLogo(file: Buffer | undefined): Promise<BillingSettingsResponse> {
    const actor = RequestContextStore.require();
    if (!file || file.length === 0) {
      throw AppError.validation('Choose a file to upload', [
        { path: 'file', message: 'a file is required' },
      ]);
    }
    if (file.length > INVOICE_LOGO_MAX_KB * 1024) {
      throw AppError.validation('The file is too large', [
        { path: 'file', message: `must be at most ${INVOICE_LOGO_MAX_KB} KB` },
      ]);
    }
    const mime = sniffImage(file);
    if (!mime || !(INVOICE_LOGO_MIMES as readonly string[]).includes(mime)) {
      throw AppError.validation('This file type is not allowed here', [
        { path: 'file', message: `must be one of ${INVOICE_LOGO_MIMES.join(', ')}` },
      ]);
    }
    const stored: Stored = {
      mime,
      data: file.toString('base64'),
      hash: createHash('sha256').update(file).digest('hex').slice(0, 8),
      size: file.length,
    };
    await this.settings.inTx(async (tx) => {
      await tx.execute(sql`
        INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
        VALUES (${LOGO_KEY}, ${JSON.stringify(stored)}::jsonb, false, ${actor.actorId}, now())
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`);
      await this.audit.record(tx, {
        event: 'platform.checkout_settings.logo_updated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: actor.actorId,
        payload: { mime, bytes: stored.size },
      });
    });
    return this.read();
  }

  async removeLogo(): Promise<BillingSettingsResponse> {
    const actor = RequestContextStore.require();
    await this.settings.inTx(async (tx) => {
      await tx.execute(sql`DELETE FROM platform_settings WHERE key = ${LOGO_KEY}`);
      await this.audit.record(tx, {
        event: 'platform.checkout_settings.logo_removed',
        status: 'success',
        actorType: 'platform_operator',
        actorId: actor.actorId,
      });
    });
    return this.read();
  }

  /** The stored logo bytes for the operator console's `<img>`; null when none is set. */
  async logo(): Promise<{ mime: string; bytes: Buffer; hash: string } | null> {
    const stored = await this.settings.inTx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${LOGO_KEY}`,
      );
      return (res.rows[0] as { value: Stored } | undefined)?.value ?? null;
    });
    return stored
      ? { mime: stored.mime, bytes: Buffer.from(stored.data, 'base64'), hash: stored.hash }
      : null;
  }

  /** What the invoice prints in its header and footer (WaDesk `Brand::billing()`); the company falls back to the site name. */
  async billingBlock(fallbackCompany: string): Promise<InvoiceBillingBlock> {
    return this.settings.inTx(async (tx) => {
      const rows = await this.rows(tx);
      const s = this.toSettings(rows);
      const hash = await this.logoHash(tx);
      return {
        company: s.companyName || fallbackCompany,
        address: s.companyAddress,
        taxId: s.companyTaxId,
        regNo: s.companyRegNo,
        email: s.companyEmail,
        phone: s.companyPhone,
        hasLogo: hash !== null,
        logoUrl: hash ? `/api/platform/billing/settings/logo?v=${hash}` : null,
      };
    });
  }

  /** The tax label invoices print ("GST", "VAT"), from the same saved setting checkout uses. */
  async taxLabel(): Promise<string> {
    const label = await this.settings.get<string>(K.taxLabel);
    return typeof label === 'string' && label.trim() ? label.trim().slice(0, 32) : 'Tax';
  }
}
