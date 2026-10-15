import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type CatalogLoginConfig,
  type CatalogSummary,
  type CommerceSettingsInput,
  type ConnectCatalogInput,
  type CreateCatalogInput,
  type DeleteRemoteCatalogInput,
  type RenameCatalogInput,
  type SaveAutomationInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { readCatalogEnv } from '../../config/domains/catalog-products.env';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CATALOG_PROVIDER,
  CatalogProviderError,
  type CatalogProvider,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { SENDER_DIRECTORY, type SenderDirectory } from './_shims/tokens';
import { applyAutomation, readAutomation } from './catalog-automation';
import { CatalogBindings } from './catalog-bindings';
import { metaRejectionMessage } from './catalog-rules';
import { providerRefusal } from './catalog-problems';
import { CatalogSyncRepository } from './catalog-sync.repository';
import { CatalogsRepository, type CatalogRow } from './catalogs.repository';
import { toCatalogSummary } from './catalogs.mapper';

export const CATALOG_MODULE = 'catalog';

const GENERIC_VERIFY =
  'Could not verify the catalog right now. Check the Catalog ID and access token, then try again.';

/**
 * Connecting, linking, disconnecting and configuring the workspace's Meta catalog (TW-CAT-002..006).
 *
 * Where Reference wrote the row and then deleted it again when Meta refused the credentials (so a failed re-connect destroyed a
 * working connection), the credentials are verified FIRST and the row is written only when Meta accepts them.
 */
@Injectable()
export class CatalogConnectionService {
  private readonly logger = new Logger(CatalogConnectionService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly sync: CatalogSyncRepository,
    private readonly bindings: CatalogBindings,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @Inject(CATALOG_PROVIDER) private readonly provider: CatalogProvider,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
  ) {}

  /** The catalog of the workspace or a 404; the connected-only actions all start here. */
  async requireCatalog(tx: Tx, orgId: number, forUpdate = false): Promise<CatalogRow> {
    const row = await this.catalogs.first(tx, orgId, forUpdate);
    if (!row) throw AppError.notFound('Catalog');
    return row;
  }

  // --- connect (TW-CAT-002) -----------------------------------------------------------------------------------------------

  async connect(input: ConnectCatalogInput): Promise<CatalogSummary> {
    const ctx = RequestContextStore.require();
    const accessToken = input.accessToken;
    try {
      await this.provider.verifyCatalog({
        provider: input.provider,
        catalogId: input.catalogId,
        wabaId: input.wabaId ?? null,
        phoneNumberId: input.phoneNumberId ?? null,
        accessToken,
      });
    } catch (err) {
      throw this.verifyFailure(err, (e) => metaRejectionMessage(e.meta), 'accessToken');
    }

    return this.db.tx(async (tx) => {
      const before = await this.catalogs.first(tx, ctx.orgId);
      const row = await this.catalogs.upsert(tx, ctx.orgId, {
        provider: input.provider,
        catalogId: input.catalogId,
        catalogName: input.catalogName?.trim() ? input.catalogName.trim() : null,
        wabaId: input.wabaId?.trim() ? input.wabaId.trim() : null,
        phoneNumberId: input.phoneNumberId?.trim() ? input.phoneNumberId.trim() : null,
        accessTokenEnc: this.bindings.encrypt(accessToken),
      });
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: row.id,
        action: before && before.provider === row.provider ? 'update' : 'insert',
        // The token is deliberately absent: the trail says a credential was replaced, never what it was.
        delta: {
          provider: { old: before?.provider ?? null, new: row.provider },
          catalogId: { old: before?.catalogId ?? null, new: row.catalogId },
          accessToken: { old: before ? 'set' : null, new: 'set' },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: row.id,
        eventType: 'catalog.connected',
        payload: { uuid: row.uuid, provider: row.provider, catalogId: row.catalogId },
      });
      return toCatalogSummary(row);
    });
  }

  // --- autodetect (TW-CAT-003) --------------------------------------------------------------------------------------------

  async autodetect(): Promise<CatalogSummary> {
    const ctx = RequestContextStore.require();
    const creds = await this.db.tx((tx) => this.senders.wabaCredentials(tx, ctx.orgId));
    if (!creds) {
      throw new AppError(
        ERROR_CODES.CAT_NO_WABA,
        'No connected WhatsApp Business (WABA) number found. Connect a WABA number first, or link the catalog manually below.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (creds.accessToken === '' || creds.wabaId === '') {
      throw new AppError(
        ERROR_CODES.CAT_WABA_TOKEN_MISSING,
        'Your WABA number is connected but its Meta access token could not be read. Reconnect the number, or link the catalog manually below.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const auth = { accessToken: creds.accessToken };

    let catalogId = creds.catalogId;
    if (catalogId === '') {
      try {
        const linked = await this.provider.listWabaCatalogs(auth, creds.wabaId);
        if (linked[0]) {
          catalogId = linked[0];
        } else if (creds.businessId !== '') {
          // Nothing linked yet: create one and attach it to the WABA.
          const name = `${this.config.get('APP_NAME', { infer: true })} · ${new Date().toISOString().slice(0, 10)}`;
          const created = await this.provider.createCatalog(auth, creds.businessId, name);
          if (created) {
            catalogId = created;
            await this.provider.linkCatalogToWaba(auth, creds.wabaId, created);
          }
        }
      } catch (err) {
        this.logger.warn(
          { err: err instanceof Error ? err.message : 'failed' },
          'autodetect list or create failed',
        );
      }
    }
    if (catalogId === '') {
      throw new AppError(
        ERROR_CODES.CAT_NO_CATALOG_LINKED,
        'No product catalog is linked to your WhatsApp account yet. Create one in Meta Commerce Manager (or add a Business ID to your WABA connection), then try again, or link it manually below.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    let catalogName: string | null = null;
    try {
      catalogName = await this.provider.catalogName(auth, catalogId);
    } catch {
      /* the label is optional */
    }

    const binding = {
      provider: 'meta_cloud' as const,
      catalogId,
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId || null,
      accessToken: creds.accessToken,
    };
    try {
      await this.provider.verifyCatalog(binding);
    } catch (err) {
      throw this.verifyFailure(
        err,
        (e) => `Found catalog ${catalogId} but Meta rejected the stored token: ${e.message}`,
        'autodetect',
        'Could not verify the catalog right now. Please try again in a moment.',
      );
    }

    return this.db.tx(async (tx) => {
      const before = await this.catalogs.first(tx, ctx.orgId);
      const row = await this.catalogs.upsert(tx, ctx.orgId, {
        provider: 'meta_cloud',
        catalogId,
        catalogName: catalogName || 'WhatsApp Catalog',
        wabaId: creds.wabaId,
        phoneNumberId: creds.phoneNumberId || null,
        accessTokenEnc: this.bindings.encrypt(creds.accessToken),
      });
      // Persist the id back onto the WABA config so a later reconnect keeps it.
      if (creds.catalogId !== catalogId) {
        await this.senders.saveWabaCatalogId(tx, ctx.orgId, creds.configId, catalogId);
      }
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: row.id,
        action: before ? 'update' : 'insert',
        delta: {
          provider: { old: before?.provider ?? null, new: row.provider },
          catalogId: { old: before?.catalogId ?? null, new: row.catalogId },
          source: { old: null, new: 'autodetect' },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: row.id,
        eventType: 'catalog.connected',
        payload: {
          uuid: row.uuid,
          provider: row.provider,
          catalogId: row.catalogId,
          source: 'autodetect',
        },
      });
      return toCatalogSummary(row);
    });
  }

  /** What the browser needs to open the catalog login popup; `ready` is false until the Meta app and its configuration are set. */
  loginConfig(): CatalogLoginConfig {
    const e = readCatalogEnv();
    const ready = Boolean(e.META_APP_ID && e.META_APP_SECRET && e.META_CATALOGUE_CONFIG_ID);
    return {
      ready,
      appId: ready ? (e.META_APP_ID ?? null) : null,
      configId: ready ? (e.META_CATALOGUE_CONFIG_ID ?? null) : null,
      graphVersion: e.CAT_GRAPH_API_VERSION,
    };
  }

  // --- create, rename and delete on Meta ----------------------------------------------------------------------------------

  /**
   * Creates a brand-new catalog on Meta under the WABA's business, links it to the WABA and connects it here. Meta is asked first,
   * so a refusal leaves nothing behind locally; a workspace that already has a catalog must disconnect it first.
   */
  async create(input: CreateCatalogInput): Promise<CatalogSummary> {
    const ctx = RequestContextStore.require();
    const existing = await this.db.tx((tx) => this.catalogs.first(tx, ctx.orgId));
    if (existing) {
      throw new AppError(
        ERROR_CODES.CAT_ALREADY_CONNECTED,
        'A catalog is already connected. Disconnect it first to create a new one.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const creds = await this.db.tx((tx) => this.senders.wabaCredentials(tx, ctx.orgId));
    if (!creds) {
      throw new AppError(
        ERROR_CODES.CAT_NO_WABA,
        'No connected WhatsApp Business (WABA) number found. Connect a WABA number first.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if ((creds.accessToken === '' && !input.loginCode) || creds.wabaId === '') {
      throw new AppError(
        ERROR_CODES.CAT_WABA_TOKEN_MISSING,
        'Your WABA number is connected but its Meta access token could not be read. Reconnect the number.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (creds.businessId === '') {
      throw new AppError(
        ERROR_CODES.CAT_NO_CATALOG_LINKED,
        'Add the Meta Business ID to your WABA connection so the catalog can be created under it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // A catalog is created with the token of the catalog login (it carries `catalog_management`); the number's own token, from
    // WhatsApp Embedded Signup, usually does not. Without a login code the number's token is tried, as before.
    let token = creds.accessToken;
    if (input.loginCode) {
      try {
        token = await this.provider.exchangeLoginCode(input.loginCode);
      } catch (err) {
        if (err instanceof CatalogProviderError) throw providerRefusal(err);
        throw err;
      }
    }
    const auth = { accessToken: token };
    const name = input.name.trim();

    let catalogId: string | null;
    try {
      catalogId = await this.provider.createCatalog(auth, creds.businessId, name);
      if (!catalogId) {
        throw new CatalogProviderError('Meta did not return a catalog id.', 'meta');
      }
      await this.provider.linkCatalogToWaba(auth, creds.wabaId, catalogId);
    } catch (err) {
      if (err instanceof CatalogProviderError) throw providerRefusal(err);
      throw err;
    }

    const binding = {
      provider: 'meta_cloud' as const,
      catalogId,
      wabaId: creds.wabaId,
      phoneNumberId: creds.phoneNumberId || null,
      accessToken: token,
    };
    try {
      await this.provider.verifyCatalog(binding);
    } catch (err) {
      throw this.verifyFailure(
        err,
        (e) => `Created catalog ${catalogId} but Meta would not read it back: ${e.message}`,
        'name',
      );
    }

    return this.db.tx(async (tx) => {
      const row = await this.catalogs.upsert(tx, ctx.orgId, {
        provider: 'meta_cloud',
        catalogId: catalogId as string,
        catalogName: name,
        wabaId: creds.wabaId,
        phoneNumberId: creds.phoneNumberId || null,
        accessTokenEnc: this.bindings.encrypt(token),
      });
      await this.senders.saveWabaCatalogId(tx, ctx.orgId, creds.configId, catalogId as string);
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: row.id,
        action: 'insert',
        delta: {
          catalogId: { old: null, new: row.catalogId },
          catalogName: { old: null, new: name },
          source: { old: null, new: 'created_on_meta' },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: row.id,
        eventType: 'catalog.created',
        payload: { uuid: row.uuid, catalogId: row.catalogId, name },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: row.id,
        eventType: 'catalog.connected',
        payload: {
          uuid: row.uuid,
          provider: row.provider,
          catalogId: row.catalogId,
          source: 'created_on_meta',
        },
      });
      return toCatalogSummary(row);
    });
  }

  /** Renames the catalog on Meta, then here; Meta refusing leaves the stored name as it was. */
  async rename(input: RenameCatalogInput): Promise<CatalogSummary> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.requireCatalog(tx, ctx.orgId));
    const name = input.name.trim();
    try {
      await this.provider.renameCatalog(this.bindings.of(row), name);
    } catch (err) {
      if (err instanceof CatalogProviderError) throw providerRefusal(err);
      throw err;
    }
    return this.db.tx(async (tx) => {
      const locked = await this.requireCatalog(tx, ctx.orgId, true);
      await this.catalogs.setName(tx, ctx.orgId, locked.id, name);
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: locked.id,
        action: 'update',
        delta: { catalogName: { old: locked.catalogName, new: name } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: locked.id,
        eventType: 'catalog.renamed',
        payload: { uuid: locked.uuid, name },
      });
      return toCatalogSummary((await this.catalogs.first(tx, ctx.orgId))!);
    });
  }

  /**
   * Deletes the catalog on Meta (irreversible there) and then disconnects it here, which also forgets every product's sync state and
   * the Meta ids of the collections. The catalog id must be typed back exactly.
   */
  async deleteRemote(input: DeleteRemoteCatalogInput): Promise<void> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.requireCatalog(tx, ctx.orgId));
    if (input.confirmCatalogId.trim() !== row.catalogId) {
      throw new AppError(
        ERROR_CODES.CAT_CONFIRM_MISMATCH,
        'The catalog id you typed does not match the connected catalog.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'confirmCatalogId', message: 'Does not match the connected catalog id.' }],
      );
    }
    try {
      await this.provider.deleteCatalog(this.bindings.of(row));
    } catch (err) {
      if (err instanceof CatalogProviderError) throw providerRefusal(err);
      throw err;
    }
    await this.disconnect();
  }

  /** Meta's verdict becomes a 422 that names its code; anything else is the generic retry message. */
  private verifyFailure(
    err: unknown,
    metaMessage: (e: CatalogProviderError) => string,
    field: string,
    generic = GENERIC_VERIFY,
  ): AppError {
    if (err instanceof CatalogProviderError && err.kind === 'meta') {
      const problem = providerRefusal(err, metaMessage(err));
      return new AppError(problem.code, metaMessage(err), HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: field, message: metaMessage(err) },
        ...(problem.details ?? []),
      ]);
    }
    this.logger.warn(
      { err: err instanceof Error ? err.message : 'failed' },
      'catalog verify failed',
    );
    return new AppError(ERROR_CODES.CAT_PROVIDER_FAILED, generic, HttpStatus.UNPROCESSABLE_ENTITY, [
      { path: field, message: generic },
    ]);
  }

  // --- disconnect (TW-CAT-004) --------------------------------------------------------------------------------------------

  /** Idempotent: with no catalog it still forgets the products' sync state. Nothing is removed from Meta. */
  async disconnect(): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.catalogs.first(tx, ctx.orgId, true);
      const removed = await this.catalogs.deleteAll(tx, ctx.orgId);
      const cleared = await this.sync.clearSyncState(tx, ctx.orgId);
      // The product sets lived in the catalog being left: their Meta ids point nowhere now.
      await this.sync.clearSetIds(tx, ctx.orgId);
      if (row) {
        await this.audit.record(tx, {
          module: CATALOG_MODULE,
          recordId: row.id,
          action: 'delete',
          delta: {
            provider: { old: row.provider, new: null },
            catalogId: { old: row.catalogId, new: null },
            productsReset: { old: null, new: cleared },
          },
        });
        await this.outbox.emit(tx, {
          aggregateModule: CATALOG_MODULE,
          aggregateId: row.id,
          eventType: 'catalog.disconnected',
          payload: { uuid: row.uuid, provider: row.provider, removed },
        });
      }
    });
  }

  // --- commerce settings (TW-CAT-005) -------------------------------------------------------------------------------------

  async setCommerce(input: CommerceSettingsInput): Promise<CatalogSummary> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.requireCatalog(tx, ctx.orgId));
    if (!row.phoneNumberId) {
      throw new AppError(
        ERROR_CODES.CAT_NO_PHONE_NUMBER,
        'Catalog has no phone_number_id bound: set commerce settings against a specific phone number.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    // Meta first: the local flags change only after Meta accepts them.
    try {
      await this.provider.setCommerceSettings(this.bindings.of(row), {
        catalogVisible: input.isCatalogVisible,
        cartEnabled: input.isCartEnabled,
      });
    } catch (err) {
      if (err instanceof CatalogProviderError) throw providerRefusal(err);
      throw err;
    }
    return this.db.tx(async (tx) => {
      const locked = await this.requireCatalog(tx, ctx.orgId, true);
      await this.catalogs.setCommerce(tx, ctx.orgId, locked.id, {
        isCartEnabled: input.isCartEnabled,
        isCatalogVisible: input.isCatalogVisible,
      });
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: locked.id,
        action: 'update',
        delta: {
          isCartEnabled: { old: locked.isCartEnabled, new: input.isCartEnabled },
          isCatalogVisible: { old: locked.isCatalogVisible, new: input.isCatalogVisible },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: locked.id,
        eventType: 'catalog.commerce_updated',
        payload: {
          uuid: locked.uuid,
          isCartEnabled: input.isCartEnabled,
          isCatalogVisible: input.isCatalogVisible,
        },
      });
      return toCatalogSummary((await this.catalogs.first(tx, ctx.orgId))!);
    });
  }

  // --- automation (TW-CAT-006) --------------------------------------------------------------------------------------------

  async saveAutomation(input: SaveAutomationInput): Promise<CatalogSummary> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.requireCatalog(tx, ctx.orgId, true);
      const before = readAutomation(row.metaJson);
      await this.catalogs.setMeta(tx, ctx.orgId, row.id, applyAutomation(row.metaJson, input));
      const after = readAutomation(applyAutomation(row.metaJson, input));
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const key of Object.keys(after) as Array<keyof typeof after>) {
        if (before[key] !== after[key]) delta[key] = { old: before[key], new: after[key] };
      }
      await this.audit.record(tx, {
        module: CATALOG_MODULE,
        recordId: row.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: CATALOG_MODULE,
        aggregateId: row.id,
        eventType: 'catalog.automation_updated',
        payload: { uuid: row.uuid, changed: Object.keys(delta) },
      });
      return toCatalogSummary((await this.catalogs.first(tx, ctx.orgId))!);
    });
  }
}
