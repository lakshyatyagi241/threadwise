import { randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  missingPermissionKeys,
  PLAN_UPGRADE_PATH,
  type ConfigureInstallationInput,
  type ConsentInstallationInput,
  type InstallAppInput,
  type MarketConnectionEventList,
  type MarketConnectionEventsQuery,
  type MarketInstallation,
  type MarketInstallationList,
  type MarketInstallationListQuery,
  type MarketInstallResult,
  type MarketManifest,
  type MarketRecipe,
  type MarketSampleLeadResult,
  type MarketTestResult,
  type SendSampleLeadInput,
  type UninstallAppInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ConnectorRegistry,
  isInbound,
  newConnectionSecret,
  newPublicKey,
  secretHint,
} from '../../infra/providers/marketplace';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BrowseRepository } from './browse.repository';
import { mergeCredentials } from './credentials';
import { DeliveryService } from './delivery.service';
import { InstallationsRepository, type InstallationRow } from './installations.repository';
import { LeadPipelineGateway } from './lead-pipeline.gateway';
import { MarketplaceAccess, INSTALLED_APPS_LIMIT } from './marketplace-access.service';
import { consentMatches, consentProblems, parseAppRef } from './marketplace-rules';
import { readManifest, readRecipe, toInstallationView } from './marketplace.mapper';
import { RelayService } from './relay.service';
import { isUniqueViolation } from './sql-helpers';
import { AddonEntitlementService } from '../addons-extension-registry';

const AUDIT_MODULE = 'marketplace';

/** A lead-source integration: it writes leads, so it gets a source of its own in the lead pipeline. */
const isLeadSource = (m: MarketManifest, r: MarketRecipe | null): boolean =>
  m.kind === 'integration' &&
  m.scopes.includes('leads.write') &&
  r !== null &&
  r.connector.type !== 'oauth';

/**
 * A workspace's installations: install with permission consent, re-consent for a version that asks for more, configure, pause, test,
 * send a sample lead, rotate the connection secret, and uninstall (access revoked in the same transaction, the keep-or-delete-data choice
 * recorded). Every change writes its audit row and its outbox event in the transaction that made it.
 *
 * Consent is exact: the scopes the admin confirms must equal the scopes of the version. The person installing must also hold every
 * permission the scopes stand for, so installing an app is never a way to gain a capability. Secrets are sealed and write-only; the one
 * value the platform generates, a connection's inbound secret, is returned once, in the answer that creates or rotates it.
 */
@Injectable()
export class InstallationsService {
  private readonly publicBase: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InstallationsRepository,
    private readonly browse: BrowseRepository,
    private readonly access: MarketplaceAccess,
    private readonly entitlements: AddonEntitlementService,
    private readonly crypto: CryptoService,
    private readonly registry: ConnectorRegistry,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly pipeline: LeadPipelineGateway,
    private readonly delivery: DeliveryService,
    private readonly relay: RelayService,
    config: ConfigService<Env, true>,
  ) {
    this.publicBase = config.get('APP_URL', { infer: true });
  }

  // --- reads -------------------------------------------------------------------------------------------------------------------------

  async list(q: MarketInstallationListQuery): Promise<MarketInstallationList> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId, q));
    const limit = await this.entitlements.limit(orgId, INSTALLED_APPS_LIMIT);
    return { data: rows.map((r) => this.view(r)), usage: { installed: rows.length, limit } };
  }

  async get(uuid: string): Promise<MarketInstallation> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, orgId, uuid));
    if (!row) throw this.notInstalled();
    return this.view(row);
  }

  async events(uuid: string, q: MarketConnectionEventsQuery): Promise<MarketConnectionEventList> {
    const { orgId } = RequestContextStore.require();
    const out = await this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid);
      if (!row) throw this.notInstalled();
      if (!row.connection) return { rows: [], badCursor: false };
      return this.repo.events(tx, orgId, row.connection.id, q);
    });
    if (out.badCursor)
      throw AppError.validation('Invalid pagination cursor', [
        { path: 'cursor', message: 'malformed' },
      ]);
    const hasMore = out.rows.length > q.limit;
    const items = hasMore ? out.rows.slice(0, q.limit) : out.rows;
    return {
      data: items.map((e) => ({
        id: e.uuid,
        externalId: e.externalId,
        status: e.status,
        error: e.error,
        receivedAt: e.receivedAt.toISOString(),
      })),
      page: {
        nextCursor: hasMore ? items[items.length - 1]!.cursor : null,
        hasMore,
        limit: q.limit,
      },
    };
  }

  // --- install ------------------------------------------------------------------------------------------------------------------------

  async install(appRef: string, input: InstallAppInput): Promise<MarketInstallResult> {
    const ctx = RequestContextStore.require();
    const ref = parseAppRef(appRef);
    if (!ref) throw this.appNotFound();

    const pre = await this.db.tx(async (tx) => {
      const target = await this.browse.installable(tx, ref);
      if (!target)
        return {
          target: null,
          exists: await this.browse.exists(tx, ref),
          installedCount: 0,
          already: false,
        };
      return {
        target,
        exists: true,
        installedCount: await this.browse.installedCount(tx, ctx.orgId),
        already: (await this.repo.byAppId(tx, ctx.orgId, target.appId)) !== null,
      };
    });
    const target = pre.target;
    if (!target) {
      throw pre.exists
        ? new AppError(
            ERROR_CODES.MKT_APP_UNAVAILABLE,
            'This app is not available for installation.',
            HttpStatus.CONFLICT,
          )
        : this.appNotFound();
    }
    if (pre.already) {
      throw new AppError(
        ERROR_CODES.MKT_ALREADY_INSTALLED,
        'This app is already installed in your workspace.',
        HttpStatus.CONFLICT,
      );
    }
    const manifest = readManifest(target.manifest);
    if (!manifest)
      throw new AppError(
        ERROR_CODES.MKT_APP_UNAVAILABLE,
        'This app is not available for installation.',
        HttpStatus.CONFLICT,
      );
    const recipe = manifest.kind === 'integration' ? readRecipe(target.recipe) : null;
    if (manifest.kind === 'integration' && !recipe) {
      throw new AppError(
        ERROR_CODES.MKT_APP_UNAVAILABLE,
        'This app is not available for installation.',
        HttpStatus.CONFLICT,
      );
    }

    // Plan feature (counting add-ons), the module behind a first-party app, and the cap on installed apps.
    const lock = await (
      await this.access.evaluator(ctx.orgId, pre.installedCount)
    )({
      planFeature: target.planFeature,
      moduleSlug: manifest.module ?? null,
      installed: false,
    });
    if (lock) throw this.locked(lock.reason, lock.key);

    // Consent: the admin confirmed exactly the permission list of this version.
    if (!consentMatches(target.scopes, input.acceptedScopes)) {
      const p = consentProblems(target.scopes, input.acceptedScopes);
      throw new AppError(
        ERROR_CODES.MKT_CONSENT_REQUIRED,
        'Confirm the permissions this app asks for to install it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          ...p.missing.map((s) => ({ path: 'acceptedScopes', message: `missing:${s}` })),
          ...p.extra.map((s) => ({ path: 'acceptedScopes', message: `unexpected:${s}` })),
        ],
      );
    }
    this.assertInstallerHolds(target.scopes);

    const creds = mergeCredentials(recipe, {}, input.credentials);
    if (creds.problems.length > 0) throw this.credentialError(creds.problems);

    const installationUuid = randomUUID();
    const connectionType = recipe?.connector.type ?? null;
    const type = connectionType ? this.registry.get(connectionType) : null;
    let inboundSecret: string | null = null;
    let connectionSecretEnc: string | null = null;
    let connectionHint: string | null = null;
    // A type that receives deliveries gets a generated secret, unless its recipe makes one of the admin's credentials the secret (a push
    // portal's own key): asking `secretFor` with a stand-in tells which.
    if (
      type &&
      isInbound(type) &&
      type.secretFor(recipe!, creds.values, 'generated') === 'generated'
    ) {
      inboundSecret = newConnectionSecret();
      connectionSecretEnc = this.crypto.encrypt(inboundSecret);
      connectionHint = secretHint(inboundSecret);
    }

    // The lead pipeline's source is made BEFORE the installation, so a workspace at its lead-source cap is told so and nothing is installed.
    let leadSourceId: number | null = null;
    const leadSource = isLeadSource(manifest, recipe);
    if (leadSource) {
      leadSourceId = await this.pipeline.ensureSource(ctx.orgId, {
        providerKey: target.slug,
        externalRef: installationUuid,
        name: target.name,
      });
    }

    let id: number;
    try {
      id = await this.db.tx(async (tx) => {
        const installationId = await this.repo.insert(tx, ctx.orgId, {
          uuid: installationUuid,
          appId: target.appId,
          versionId: target.versionId,
          grantedScopes: target.scopes,
          config: input.config,
          credentialsEnc:
            Object.keys(creds.values).length > 0
              ? this.crypto.encrypt(JSON.stringify(creds.values))
              : null,
          credentialHints: creds.hints,
          installedBy: ctx.userId,
        });
        await this.repo.insertConsent(tx, ctx.orgId, {
          installationId,
          appId: target.appId,
          versionId: target.versionId,
          action: 'install',
          scopes: target.scopes,
          previousScopes: [],
          dataChoice: null,
          consentedBy: ctx.userId,
        });
        if (recipe && connectionType) {
          await this.repo.insertConnection(tx, ctx.orgId, {
            installationId,
            type: connectionType,
            publicKey: newPublicKey(),
            secretEnc: connectionSecretEnc,
            secretHint: connectionHint,
            pollIntervalSeconds:
              recipe.connector.type === 'pull' ? recipe.connector.pollIntervalSeconds : null,
            leadSourceId,
          });
        }
        await this.audit.record(tx, {
          module: AUDIT_MODULE,
          recordId: installationId,
          action: 'insert',
          delta: {
            app: { old: null, new: target.slug },
            version: { old: null, new: target.version },
            scopes: { old: [], new: target.scopes },
          },
        });
        await this.outbox.emit(tx, {
          orgId: ctx.orgId,
          aggregateModule: AUDIT_MODULE,
          aggregateId: installationId,
          eventType: 'marketplace.app.installed',
          payload: {
            installation: installationUuid,
            app: target.slug,
            kind: target.kind,
            version: target.version,
            scopes: target.scopes,
          },
        });
        return installationId;
      });
    } catch (e) {
      if (leadSource) await this.pipeline.releaseSource(ctx.orgId, installationUuid);
      if (isUniqueViolation(e)) {
        throw new AppError(
          ERROR_CODES.MKT_ALREADY_INSTALLED,
          'This app is already installed in your workspace.',
          HttpStatus.CONFLICT,
        );
      }
      throw e;
    }

    const row = await this.db.tx((tx) => this.repo.byId(tx, ctx.orgId, id));
    return { installation: this.view(row!), inboundSecret };
  }

  // --- consent for a new version --------------------------------------------------------------------------------------------------

  /** Accepts the permission list of the newer version the installation is waiting on. */
  async consent(uuid: string, input: ConsentInstallationInput): Promise<MarketInstallation> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (row.status === 'killed') throw this.killed();
      if (!row.pending || row.pendingVersionId === null) {
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'There is no new version waiting for consent.',
          HttpStatus.CONFLICT,
        );
      }
      if (!consentMatches(row.pending.scopes, input.acceptedScopes)) {
        throw new AppError(
          ERROR_CODES.MKT_CONSENT_REQUIRED,
          'Confirm the permissions the new version asks for.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'acceptedScopes', message: 'must_equal_pending_scopes' }],
        );
      }
      this.assertInstallerHolds(row.pending.scopes);
      await this.repo.update(tx, ctx.orgId, row.id, {
        installed_version_id: row.pendingVersionId,
        pending_version_id: null,
        granted_scopes: row.pending.scopes,
      });
      await this.repo.insertConsent(tx, ctx.orgId, {
        installationId: row.id,
        appId: row.appId,
        versionId: row.pendingVersionId,
        action: 'reconsent',
        scopes: row.pending.scopes,
        previousScopes: row.grantedScopes,
        dataChoice: null,
        consentedBy: ctx.userId,
      });
      await this.audit.record(tx, {
        module: AUDIT_MODULE,
        recordId: row.id,
        action: 'update',
        delta: {
          version: { old: row.version, new: row.pending.version },
          scopes: { old: row.grantedScopes, new: row.pending.scopes },
        },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'marketplace.app.scopes_changed',
        payload: {
          installation: row.uuid,
          app: row.app.slug,
          version: row.pending.version,
          scopes: row.pending.scopes,
          previousScopes: row.grantedScopes,
        },
      });
    });
    return this.get(uuid);
  }

  // --- configure, pause, resume ---------------------------------------------------------------------------------------------------

  async configure(uuid: string, input: ConfigureInstallationInput): Promise<MarketInstallation> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (row.status === 'killed') throw this.killed();
      const recipe = readRecipe(row.recipe);
      const existing = this.relay.openCredentials(row.credentialsEnc);
      const touchesCredentials =
        input.credentials !== undefined || (input.clearCredentials?.length ?? 0) > 0;
      const merged = touchesCredentials
        ? mergeCredentials(recipe, existing, input.credentials ?? {}, input.clearCredentials ?? [])
        : null;
      if (merged && merged.problems.length > 0) throw this.credentialError(merged.problems);

      const ok = await this.repo.update(
        tx,
        ctx.orgId,
        row.id,
        {
          ...(input.config !== undefined ? { config: input.config } : {}),
          ...(merged
            ? {
                credentials_enc:
                  Object.keys(merged.values).length > 0
                    ? this.crypto.encrypt(JSON.stringify(merged.values))
                    : null,
                credential_hints: merged.hints,
              }
            : {}),
          // New credentials deserve a fresh look: the old failure no longer says anything about them.
          ...(merged
            ? {
                health_status: 'unknown' as const,
                last_error: null,
                last_error_at: null,
                health_checked_at: null,
              }
            : {}),
        },
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Installation');
      // The audit row names what changed, never a value: a secret must not be recoverable from the trail.
      await this.audit.record(tx, {
        module: AUDIT_MODULE,
        recordId: row.id,
        action: 'update',
        delta: {
          changed: {
            old: null,
            new: [
              ...(input.config !== undefined ? ['config'] : []),
              ...Object.keys(input.credentials ?? {}).map((k) => `credential:${k}`),
              ...(input.clearCredentials ?? []).map((k) => `credential-cleared:${k}`),
            ],
          },
        },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'marketplace.app.configured',
        payload: { installation: row.uuid, app: row.app.slug },
      });
    });
    return this.get(uuid);
  }

  async setEnabled(
    uuid: string,
    enabled: boolean,
    rowVersion: number,
  ): Promise<MarketInstallation> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (row.status === 'killed') throw this.killed();
      const next = enabled ? 'active' : 'disabled';
      if (row.status === next) return;
      const ok = await this.repo.update(
        tx,
        ctx.orgId,
        row.id,
        { status: next, disabled_at: enabled ? null : new Date() },
        rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('Installation');
      if (row.connection)
        await this.repo.setConnectionStatus(
          tx,
          ctx.orgId,
          row.connection.id,
          enabled ? 'active' : 'paused',
        );
      await this.audit.record(tx, {
        module: AUDIT_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: row.status, new: next } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: AUDIT_MODULE,
        aggregateId: row.id,
        eventType: enabled ? 'marketplace.app.enabled' : 'marketplace.app.disabled',
        payload: { installation: row.uuid, app: row.app.slug },
      });
    });
    return this.get(uuid);
  }

  // --- uninstall ------------------------------------------------------------------------------------------------------------------------

  /**
   * Access ends in this transaction: the installation, its connection (so its address stops answering) and its stored secrets are deleted,
   * and the choice about the data the app created is kept in the consent ledger and announced on the outbox for the domains that own that
   * data to act on. The platform deletes no contact itself.
   */
  async uninstall(uuid: string, input: UninstallAppInput): Promise<void> {
    const ctx = RequestContextStore.require();
    const leadSource = await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      const manifest = readManifest(row.manifest);
      const recipe = readRecipe(row.recipe);
      await this.repo.insertConsent(tx, ctx.orgId, {
        installationId: row.id,
        appId: row.appId,
        versionId: row.installedVersionId,
        action: 'uninstall',
        scopes: row.grantedScopes,
        previousScopes: row.grantedScopes,
        dataChoice: input.dataChoice,
        consentedBy: ctx.userId,
      });
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: AUDIT_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: {
          app: { old: row.app.slug, new: null },
          dataChoice: { old: null, new: input.dataChoice },
        },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'marketplace.app.uninstalled',
        payload: {
          installation: row.uuid,
          app: row.app.slug,
          kind: row.app.kind,
          dataChoice: input.dataChoice,
          scopes: row.grantedScopes,
        },
      });
      return manifest !== null && isLeadSource(manifest, recipe);
    });
    if (leadSource) await this.pipeline.releaseSource(ctx.orgId, uuid);
  }

  // --- test, sample, rotate -------------------------------------------------------------------------------------------------------

  async test(uuid: string): Promise<MarketTestResult> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, ctx.orgId, uuid));
    if (!row) throw this.notInstalled();
    if (row.status === 'killed') throw this.killed();
    const recipe = readRecipe(row.recipe);
    if (!recipe || !row.connection) throw this.noConnection();
    const started = Date.now();
    const result = await this.registry.get(recipe.connector.type).test({
      recipe,
      credentials: this.relay.openCredentials(row.credentialsEnc),
      config: row.config,
    });
    const checkedAt = new Date();
    await this.db.tx(async (tx) => {
      await this.repo.update(tx, ctx.orgId, row.id, {
        health_status: result.ok ? 'healthy' : 'error',
        health_checked_at: checkedAt,
        last_error: result.ok ? null : (result.message ?? result.code),
        last_error_at: result.ok ? null : checkedAt,
      });
    });
    return {
      ok: result.ok,
      code: result.code,
      message: result.message,
      latencyMs: Date.now() - started,
      checkedAt: checkedAt.toISOString(),
    };
  }

  /** Sends one of the recipe's sample payloads through the whole path, mapping included, with a delivery id of its own. */
  async sample(uuid: string, input: SendSampleLeadInput): Promise<MarketSampleLeadResult> {
    const ctx = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.byUuid(tx, ctx.orgId, uuid));
    if (!row) throw this.notInstalled();
    if (row.status === 'killed') throw this.killed();
    if (row.status !== 'active')
      throw new AppError(
        ERROR_CODES.MKT_INSTALLATION_DISABLED,
        'The installation is paused.',
        HttpStatus.CONFLICT,
      );
    const recipe = readRecipe(row.recipe);
    const type = recipe ? this.registry.get(recipe.connector.type) : null;
    if (!recipe || !type || !isInbound(type) || !row.connection) throw this.noConnection();
    const payload = input.payloadName
      ? recipe.testPayloads.find((p) => p.name === input.payloadName)
      : recipe.testPayloads[0];
    if (!payload)
      throw AppError.validation('This app has no such sample payload', [
        { path: 'payloadName', message: 'unknown' },
      ]);

    const parsed = type.parse(recipe, payload.payload);
    const lead = parsed.leads[0];
    if (!lead)
      throw AppError.validation('The sample payload produced no lead', [
        { path: 'payloadName', message: parsed.rejected[0]?.reason ?? 'empty' },
      ]);
    // A fresh id every time, so pressing the button twice is two samples and not one sample and a "duplicate".
    const externalId = `sample-${randomUUID()}`;
    const counts = await this.delivery.process(
      {
        orgId: ctx.orgId,
        connectionId: row.connection.id,
        installationId: row.id,
        installationUuid: row.uuid,
        appSlug: row.app.slug,
        appName: row.app.name,
        leadSourceId: row.connection.leadSourceId,
      },
      [{ ...lead, externalId, raw: { sample: true, payload: payload.payload } }],
      0,
    );
    if (counts.failed > 0) {
      throw new AppError(
        counts.pipelineDown ? ERROR_CODES.MKT_LEAD_PIPELINE_UNAVAILABLE : ERROR_CODES.INTERNAL,
        'The sample lead could not be stored. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: counts.duplicates > 0 ? 'duplicate' : 'accepted', externalId };
  }

  /** A new inbound secret; the old one stops working at once. Returned once. */
  async rotateSecret(uuid: string, rowVersion: number): Promise<MarketInstallResult> {
    const ctx = RequestContextStore.require();
    let secret = '';
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, ctx.orgId, uuid);
      if (row.status === 'killed') throw this.killed();
      const recipe = readRecipe(row.recipe);
      const type = recipe ? this.registry.get(recipe.connector.type) : null;
      if (!recipe || !type || !isInbound(type) || !row.connection) throw this.noConnection();
      // A push recipe whose secret is a credential the portal gave is changed by editing that credential, not here.
      if (type.secretFor(recipe, {}, 'generated') !== 'generated') throw this.noConnection();
      if (row.rowVersion !== rowVersion) throw AppError.rowVersionConflict('Installation');
      secret = newConnectionSecret();
      await this.repo.setConnectionSecret(
        tx,
        ctx.orgId,
        row.connection.id,
        this.crypto.encrypt(secret),
        secretHint(secret),
      );
      // The row version moves with it, so a stale page cannot save over the new state.
      await this.repo.update(tx, ctx.orgId, row.id, { last_error: row.lastError });
      await this.audit.record(tx, {
        module: AUDIT_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { changed: { old: null, new: ['connection-secret-rotated'] } },
      });
      await this.outbox.emit(tx, {
        orgId: ctx.orgId,
        aggregateModule: AUDIT_MODULE,
        aggregateId: row.id,
        eventType: 'marketplace.app.secret_rotated',
        payload: { installation: row.uuid, app: row.app.slug },
      });
    });
    return { installation: await this.get(uuid), inboundSecret: secret };
  }

  // --- internals ------------------------------------------------------------------------------------------------------------------------

  private view(row: InstallationRow): MarketInstallation {
    return toInstallationView(row, {
      publicBase: this.publicBase,
      describeAuth: (recipe) => {
        const t = this.registry.get(recipe.connector.type);
        return isInbound(t) ? t.describeAuth(recipe) : null;
      },
    });
  }

  private async lock(tx: Tx, orgId: number, uuid: string): Promise<InstallationRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid, true);
    if (!row) throw this.notInstalled();
    return row;
  }

  /** Installing is never a way to gain a capability: the person must hold every permission the scopes stand for. */
  private assertInstallerHolds(scopes: readonly string[]): void {
    const grants = RequestContextStore.require().grants;
    const held = (key: string) => grants?.get(key)?.effect === 'allow';
    const missing = missingPermissionKeys(scopes, held);
    if (missing.length > 0) {
      throw new AppError(
        ERROR_CODES.MKT_SCOPE_EXCEEDS_INSTALLER,
        'You cannot grant an app permissions you do not hold yourself.',
        HttpStatus.FORBIDDEN,
        missing.map((k) => ({ path: 'permission', message: k })),
      );
    }
  }

  private credentialError(problems: Array<{ path: string; message: string }>): AppError {
    const missing = problems.every((p) => p.message === 'Required');
    return new AppError(
      missing ? ERROR_CODES.MKT_CREDENTIAL_MISSING : ERROR_CODES.VALIDATION_FAILED,
      missing ? 'Fill in the required fields.' : 'Some fields are not right.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      problems,
    );
  }

  private locked(reason: string, key: string | null): AppError {
    if (reason === 'limit_reached') {
      return new AppError(
        ERROR_CODES.PLAN_LIMIT_REACHED,
        "You've reached your plan's limit of installed apps. Upgrade your plan or uninstall one to add another.",
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          { path: 'limit', message: INSTALLED_APPS_LIMIT },
          { path: 'reason', message: 'limit_reached' },
          { path: 'upgradeUrl', message: PLAN_UPGRADE_PATH },
        ],
      );
    }
    return new AppError(
      ERROR_CODES.MKT_APP_LOCKED,
      reason === 'module_disabled'
        ? 'This app is not available in this installation of the product.'
        : "Your plan doesn't include this app. Upgrade to unlock it.",
      HttpStatus.UNPROCESSABLE_ENTITY,
      [
        { path: 'reason', message: reason },
        { path: 'key', message: key ?? '' },
        ...(reason === 'plan_feature' ? [{ path: 'upgradeUrl', message: PLAN_UPGRADE_PATH }] : []),
      ],
    );
  }

  private appNotFound(): AppError {
    return new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
  }
  private notInstalled(): AppError {
    return new AppError(
      ERROR_CODES.MKT_NOT_INSTALLED,
      'Installation not found',
      HttpStatus.NOT_FOUND,
    );
  }
  private killed(): AppError {
    return new AppError(
      ERROR_CODES.MKT_INSTALLATION_KILLED,
      'This app was switched off by the platform. You can only uninstall it.',
      HttpStatus.CONFLICT,
    );
  }
  private noConnection(): AppError {
    return new AppError(
      ERROR_CODES.MKT_NO_CONNECTION,
      'This app has no connection that can do that.',
      HttpStatus.CONFLICT,
    );
  }
}
