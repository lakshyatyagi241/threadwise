import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type StorefrontResponse,
  type UpdateStorefrontInput,
  type VerifyDomainResponse,
} from '@crm/contracts';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { STOREFRONT_ENV, type StorefrontEnv } from '../../../config/domains/storefront-builder.env';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  DNS_RESOLVER_PORT,
  type DnsResolverPort,
} from '../../../infra/providers/storefront-builder/dns-resolver.port';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { buildPaymentConfig, type StoredRazorpayConfig } from '../rules/payment-config';
import { buildSettings } from '../rules/settings';
import { buildShippingJson } from '../rules/shipping';
import { slugify } from '../rules/slug';
import { DOMAIN_CONSTRAINT, SLUG_CONSTRAINT, uniqueViolation } from './pg-errors';
import { domainTaken, ShopsService, STORE_MODULE } from './shops.service';
import { ShopsRepository } from './shops.repository';

/** The CNAME target and a record compared as hosts: lower-case, no trailing dot. */
const normalizeHost = (h: string): string => h.trim().toLowerCase().replace(/\.$/, '');

/**
 * The storefront design page (WD-STORE-006..008) and the custom-domain check (WD-STORE-007), shop by shop.
 *
 * Fixed from WaDesk: the settings belong to the shop in the path, not to "the first shop of the workspace"; the keys of
 * `settings_json` the form does not own survive a save; the slug is checked against the other shops by the unique index and
 * answers 409 `STORE_SLUG_TAKEN`; the CNAME must equal the expected target (WaDesk matched a substring, so
 * `app.example.com.attacker.net` passed for `app.example.com`). Kept: leaving a Razorpay secret blank keeps the stored one,
 * switching the provider away from Razorpay drops the keys, changing the domain resets it to unverified, and the check writes
 * its result every time.
 */
@Injectable()
export class StorefrontSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ShopsRepository,
    private readonly shops: ShopsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(DNS_RESOLVER_PORT) private readonly dns: DnsResolverPort,
    @Inject(STOREFRONT_ENV) private readonly env: StorefrontEnv,
  ) {}

  async update(uuid: string, input: UpdateStorefrontInput): Promise<StorefrontResponse> {
    const ctx = RequestContextStore.require();
    const slug = slugify(input.slug);
    if (!slug) {
      throw AppError.validation('Request payload failed validation', [
        { path: 'slug', message: 'Lowercase letters, numbers and dashes' },
      ]);
    }

    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Shop', uuid);

      const domain = input.customDomain || null;
      const domainChanged = domain !== existing.customDomain;
      const provider = input.paymentProvider || null;

      const paymentConfig = buildPaymentConfig(
        {
          provider,
          handle: input.paymentHandle,
          rzpKeyId: input.rzpKeyId,
          rzpKeySecret: input.rzpKeySecret,
          rzpWebhookSecret: input.rzpWebhookSecret,
        },
        (existing.paymentConfig as StoredRazorpayConfig | null) ?? null,
        (plain) => this.crypto.encrypt(plain),
      );

      const patch = {
        slug,
        themeKey: input.themeKey,
        enabled: input.enabled,
        customDomain: domain,
        ...(domainChanged ? { customDomainVerified: false } : {}),
        // Absent keeps the stored currency (changing it never converts prices).
        currencyCode: input.currencyCode ?? existing.currencyCode,
        shipping: buildShippingJson({
          flat: input.shippingFlat,
          freeAbove: input.shippingFreeAbove,
          note: input.shippingNote,
        }),
        paymentProvider: provider,
        paymentConfig: paymentConfig as Record<string, unknown> | null,
        settings: buildSettings(existing.settings, input),
      };

      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.update(sp, ctx.orgId, existing.id, patch, input.rowVersion),
        );
      } catch (err) {
        const unique = uniqueViolation(err);
        if (unique?.constraint === SLUG_CONSTRAINT) {
          throw new AppError(
            ERROR_CODES.STORE_SLUG_TAKEN,
            'That address is already used by another shop.',
            HttpStatus.CONFLICT,
            [{ path: 'slug', message: 'That address is already used by another shop.' }],
          );
        }
        if (unique?.constraint === DOMAIN_CONSTRAINT) throw domainTaken();
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Shop');

      const after = (await this.repo.findById(tx, ctx.orgId, existing.id))!;
      await this.audit.record(tx, {
        module: STORE_MODULE,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          {
            slug: existing.slug,
            themeKey: existing.themeKey,
            enabled: existing.enabled,
            customDomain: existing.customDomain,
            currencyCode: existing.currencyCode,
            paymentProvider: existing.paymentProvider,
            shipping: existing.shipping,
            // Secrets never enter the audit trail; only whether the keys are set.
            razorpayKeysSet: Boolean(existing.paymentConfig?.key_secret),
          },
          {
            slug: after.slug,
            themeKey: after.themeKey,
            enabled: after.enabled,
            customDomain: after.customDomain,
            currencyCode: after.currencyCode,
            paymentProvider: after.paymentProvider,
            shipping: after.shipping,
            razorpayKeysSet: Boolean(after.paymentConfig?.key_secret),
          },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: STORE_MODULE,
        aggregateId: existing.id,
        eventType: 'storefront.settings_updated',
        payload: { uuid, slug: after.slug, enabled: after.enabled },
      });
      return this.shops.respond(tx, ctx.orgId, after);
    });
  }

  /**
   * Looks the shop's custom domain up and stores whether its CNAME points at the platform. The result (true or false) is
   * written every time, so a domain whose DNS changed becomes unverified on the next check, as in WaDesk.
   */
  async verifyDomain(uuid: string): Promise<VerifyDomainResponse> {
    const ctx = RequestContextStore.require();
    const shop = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!shop) throw AppError.notFound('Shop', uuid);
    if (!shop.customDomain) {
      throw new AppError(
        ERROR_CODES.STORE_DOMAIN_NOT_SET,
        'No custom domain set.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    // The DNS call runs outside any transaction: a slow resolver must not hold a connection.
    const expected = this.env.cnameTarget;
    const records = await this.dns.resolveCname(shop.customDomain);
    const matched = records.some((r) => normalizeHost(r) === normalizeHost(expected));

    await this.db.tx(async (tx) => {
      const ok = await this.repo.update(tx, ctx.orgId, shop.id, { customDomainVerified: matched });
      if (!ok) return;
      await this.audit.record(tx, {
        module: STORE_MODULE,
        recordId: shop.id,
        action: 'update',
        delta: {
          customDomainVerified: { old: shop.customDomainVerified, new: matched },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: STORE_MODULE,
        aggregateId: shop.id,
        eventType: 'storefront.domain_checked',
        payload: { uuid, domain: shop.customDomain, verified: matched },
      });
    });

    return {
      ok: matched,
      expected,
      records,
      message: matched ? 'Domain verified ✓' : `CNAME not pointing to ${expected}`,
    };
  }
}
