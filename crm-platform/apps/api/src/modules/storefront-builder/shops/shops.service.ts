import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_STORE_THEME,
  ERROR_CODES,
  type CreateShopInput,
  type EditShopInput,
  type ResetStoreInput,
  type ResetStoreResponse,
  type StorefrontResponse,
  type WizardResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { StorefrontProductsReader } from '../../catalog-products';
import {
  ORDERS_GATEWAY,
  SENDER_DIRECTORY,
  type OrdersGateway,
  type SenderDirectory,
} from '../_shims/tokens';
import { baseSlug, slugCandidate } from '../rules/slug';
import { DOMAIN_CONSTRAINT, SLUG_CONSTRAINT, uniqueViolation } from './pg-errors';
import { ShopUrlService } from './shop-url.service';
import { toStorefrontResponse, toWizardShop } from './storefront.mapper';
import { ShopsRepository, type ShopRow } from './shops.repository';

export const STORE_MODULE = 'storefronts';
const MAX_SLUG_ATTEMPTS = 200;

export const domainTaken = () =>
  AppError.validation('That domain is already used by another shop.', [
    { path: 'customDomain', message: 'That domain is already used by another shop.' },
  ]);

/**
 * Shops: the wizard (list, create, edit, delete, reset) and the default shop a channel connection creates (WD-STORE-003..005,
 * 029). Settings and the domain check are in StorefrontSettingsService.
 *
 * Rules carried over from WaDesk: the slug is derived from the name once and never rotated by a rename, a taken slug gets
 * `-2`, `-3`; the domain resets to unverified when it changes; a wizard save re-enables the shop (a WaDesk quirk, kept).
 * Fixed: every write needs `store.shops.manage` (WaDesk let any member), the slug is cut to the column width, a taken domain
 * is a field error (WaDesk: a database error), a shop is only saved when a WhatsApp number is connected (WaDesk only hid the
 * form), delete is a real DELETE that answers 404 for an unknown shop (WaDesk answered "Shop deleted." and did nothing).
 */
@Injectable()
export class ShopsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ShopsRepository,
    private readonly urls: ShopUrlService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly products: StorefrontProductsReader,
    @Inject(ORDERS_GATEWAY) private readonly orders: OrdersGateway,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
  ) {}

  /** The wizard page: every shop (newest first), the connected devices and whether anything can send. */
  async wizard(): Promise<WizardResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const [shops, senders] = await Promise.all([
        this.repo.listByNewest(tx, ctx.orgId),
        this.senders.wizard(tx, ctx.orgId),
      ]);
      const labels = await this.senders.sendingLabels(
        tx,
        ctx.orgId,
        shops.map((s) => s.deviceId),
      );
      return {
        shops: shops.map((s, i) =>
          toWizardShop(s, { publicUrl: this.urls.publicUrl(s), sendingLabel: labels[i] ?? null }),
        ),
        devices: senders.devices.map((d) => ({ id: d.uuid, label: d.label, phone: d.phone })),
        hasSender: senders.hasSender,
      };
    });
  }

  async get(uuid: string): Promise<StorefrontResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Shop', uuid);
      return this.respond(tx, ctx.orgId, row);
    });
  }

  async create(input: CreateShopInput): Promise<StorefrontResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.assertSender(tx, ctx.orgId);
      const deviceId = await this.resolveDevice(tx, ctx.orgId, input.deviceId);
      const id = await this.insertWithUniqueSlug(tx, ctx.orgId, baseSlug(input.shopName), {
        shopName: input.shopName,
        deviceId,
        customDomain: input.customDomain || null,
        themeKey: DEFAULT_STORE_THEME,
        enabled: true,
      });
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, { module: STORE_MODULE, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: STORE_MODULE,
        aggregateId: id,
        eventType: 'storefront.created',
        payload: { uuid: row.uuid, name: row.shopName, slug: row.slug },
      });
      return this.respond(tx, ctx.orgId, row);
    });
  }

  async update(uuid: string, input: EditShopInput): Promise<StorefrontResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Shop', uuid);
      await this.assertSender(tx, ctx.orgId);
      const deviceId = await this.resolveDevice(tx, ctx.orgId, input.deviceId);
      const domain = input.customDomain || null;

      try {
        await tx.transaction((sp) =>
          this.repo.update(sp, ctx.orgId, existing.id, {
            shopName: input.shopName,
            deviceId,
            // The slug is never touched: renaming must not break links already shared.
            ...(domain !== existing.customDomain
              ? { customDomain: domain, customDomainVerified: false }
              : {}),
            // WaDesk re-enables the shop on every wizard save (a quirk kept: see the parity file).
            enabled: true,
          }),
        );
      } catch (err) {
        if (uniqueViolation(err)?.constraint === DOMAIN_CONSTRAINT) throw domainTaken();
        throw err;
      }

      const after = (await this.repo.findById(tx, ctx.orgId, existing.id))!;
      await this.audit.record(tx, {
        module: STORE_MODULE,
        recordId: existing.id,
        action: 'update',
        delta: this.audit.diff(
          {
            shopName: existing.shopName,
            deviceId: existing.deviceUuid,
            customDomain: existing.customDomain,
            enabled: existing.enabled,
          },
          {
            shopName: after.shopName,
            deviceId: after.deviceUuid,
            customDomain: after.customDomain,
            enabled: after.enabled,
          },
        ),
      });
      await this.outbox.emit(tx, {
        aggregateModule: STORE_MODULE,
        aggregateId: existing.id,
        eventType: 'storefront.updated',
        payload: { uuid, name: after.shopName, slug: after.slug },
      });
      return this.respond(tx, ctx.orgId, after);
    });
  }

  /** Deletes the shop and its orders (through the orders shim); products stay. Views and recovery rows go with the shop. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Shop', uuid);
      const ordersDeleted = await this.orders.deleteByStorefront(tx, ctx.orgId, existing.id);
      await this.repo.deleteById(tx, ctx.orgId, existing.id);
      await this.audit.record(tx, {
        module: STORE_MODULE,
        recordId: existing.id,
        action: 'delete',
        delta: {
          shopName: { old: existing.shopName, new: null },
          orders: { old: ordersDeleted, new: 0 },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: STORE_MODULE,
        aggregateId: existing.id,
        eventType: 'storefront.deleted',
        payload: { uuid, name: existing.shopName, slug: existing.slug, ordersDeleted },
      });
    });
  }

  /** The all-store-data wipe: every order, every product (permanently) and every shop of the workspace. */
  async reset(input: ResetStoreInput): Promise<ResetStoreResponse> {
    const ctx = RequestContextStore.require();
    if (input.confirm !== 'yes') {
      throw new AppError(
        ERROR_CODES.STORE_RESET_NOT_CONFIRMED,
        'Reset not confirmed.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.db.tx(async (tx) => {
      const orders = await this.orders.deleteAll(tx, ctx.orgId);
      const products = await this.products.deleteAllProducts(tx, ctx.orgId);
      const shops = await this.repo.deleteAll(tx, ctx.orgId);
      await this.audit.record(tx, {
        module: STORE_MODULE,
        recordId: 0,
        action: 'delete',
        delta: {
          shops: { old: shops, new: 0 },
          orders: { old: orders, new: 0 },
          products: { old: products, new: 0 },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: STORE_MODULE,
        aggregateId: 0,
        eventType: 'storefront.reset',
        payload: { shops, orders, products },
      });
      return { shops, orders, products };
    });
  }

  /**
   * The default shop a workspace gets the moment it connects a WhatsApp number (WD-STORE-029): none exist yet -> one named
   * after nobody (`shop_name` null, so labels fall back to the workspace name), slug from the workspace name, theme aurora,
   * enabled, no device. A workspace that already has a shop is left alone. Called by the channel domains on connect, inside
   * their transaction when they pass one. Returns the shop's uuid when it created one.
   */
  async ensureDefaultShop(orgId: number, tx?: Tx): Promise<string | null> {
    const run = async (t: Tx): Promise<string | null> => {
      await this.repo.lockDefaultShop(t, orgId);
      if ((await this.repo.countByOrg(t, orgId)) > 0) return null;
      const name = await this.repo.orgName(t, orgId);
      const id = await this.insertWithUniqueSlug(t, orgId, baseSlug(name ?? ''), {
        shopName: null,
        themeKey: DEFAULT_STORE_THEME,
        enabled: true,
      });
      const row = (await this.repo.findById(t, orgId, id))!;
      if (RequestContextStore.peek()?.orgId === orgId) {
        await this.audit.record(t, { module: STORE_MODULE, recordId: id, action: 'insert' });
      }
      await this.outbox.emit(t, {
        orgId,
        aggregateModule: STORE_MODULE,
        aggregateId: id,
        eventType: 'storefront.created',
        payload: { uuid: row.uuid, name: null, slug: row.slug, default: true },
      });
      return row.uuid;
    };
    return tx ? run(tx) : this.db.txAs({ orgId }, run);
  }

  // --- helpers -----------------------------------------------------------------------------------------------------

  /** The wire shape of a shop, with its public URL and sending label. */
  async respond(tx: Tx, orgId: number, row: ShopRow): Promise<StorefrontResponse> {
    const [label] = await this.senders.sendingLabels(tx, orgId, [row.deviceId]);
    return toStorefrontResponse(row, {
      publicUrl: this.urls.publicUrl(row),
      cnameTarget: this.urls.env.cnameTarget,
      sendingLabel: label ?? null,
    });
  }

  private async assertSender(tx: Tx, orgId: number): Promise<void> {
    const { hasSender } = await this.senders.wizard(tx, orgId);
    if (!hasSender) {
      throw new AppError(
        ERROR_CODES.STORE_NO_SENDER,
        'Connect a WhatsApp number first: a shop needs one to confirm orders from.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  }

  /** The device the wizard picked: it must be a CONNECTED device of this workspace; an empty pick is the official API (null). */
  private async resolveDevice(
    tx: Tx,
    orgId: number,
    deviceUuid: string | null | undefined,
  ): Promise<number | null> {
    if (!deviceUuid) return null;
    const device = await this.senders.connectedDevice(tx, orgId, deviceUuid);
    if (!device) {
      throw new AppError(
        ERROR_CODES.STORE_DEVICE_INVALID,
        'Pick one of your connected devices.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'deviceId', message: 'Pick one of your connected devices.' }],
      );
    }
    return device.id;
  }

  /**
   * Inserts with `base`, `base-2`, `base-3` ... until a slug is free. The unique index is global (a slug is unique across all
   * workspaces) and not readable under row-level security, so the index itself answers: each try is a savepoint, and a
   * collision on the slug moves on to the next candidate.
   */
  private async insertWithUniqueSlug(
    tx: Tx,
    orgId: number,
    base: string,
    values: {
      shopName: string | null;
      deviceId?: number | null;
      customDomain?: string | null;
      themeKey: string;
      enabled: boolean;
    },
  ): Promise<number> {
    for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
      try {
        return await tx.transaction((sp) =>
          this.repo.insert(sp, orgId, { ...values, slug: slugCandidate(base, attempt) }),
        );
      } catch (err) {
        const unique = uniqueViolation(err);
        if (unique?.constraint === SLUG_CONSTRAINT) continue;
        if (unique?.constraint === DOMAIN_CONSTRAINT) throw domainTaken();
        throw err;
      }
    }
    throw new AppError(
      ERROR_CODES.STORE_SLUG_TAKEN,
      'Could not find a free address for this shop.',
      HttpStatus.CONFLICT,
    );
  }
}
