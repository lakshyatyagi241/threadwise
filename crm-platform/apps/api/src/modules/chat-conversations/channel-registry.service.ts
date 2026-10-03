import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ChannelHealthResponse,
  type ChannelListResponse,
  type ChannelResponse,
  type ChannelStatus,
  type ChannelWebhookReveal,
  type CreateChannelInput,
  type CreateSimulatorChannelInput,
  type SubscribeChannelInput,
  type SubscribeChannelResponse,
  type UpdateChannelInput,
  type WhatsappCredentialRequirements,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelHealthResult,
  type ChannelRuntime,
} from '../../infra/providers/chat-conversations';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { mergeSettings, normalizeSettings } from './channel-settings';
import { ChannelVault, type Credentials } from './channel-vault';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { toChannelResponse, webhookPath } from './channels.mapper';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { SimulatorPolicy } from './simulator-policy.service';

export const CHANNELS_MODULE = 'channels';

const PG_UNIQUE_VIOLATION = '23505';
const PG_FK_VIOLATION = '23503';
const pgCode = (err: unknown): string | undefined => {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code ?? e?.cause?.code;
};

/**
 * The channel registry: which ways of talking to customers this workspace has connected (plan-inbox-chat.md section 3).
 *
 * Secrets: credentials are sealed by the vault before they are stored and are never part of any response; the webhook verify token is
 * returned once (create, rotate) and kept only as a hash. A channel of a skeleton adapter (WhatsApp Cloud until its send is built)
 * is stored `disconnected` and cannot be switched on, so nothing is ever sent through an adapter that cannot send.
 */
@Injectable()
export class ChannelRegistryService {
  private readonly publicBaseUrl: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly vault: ChannelVault,
    private readonly simulator: SimulatorPolicy,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: ChatRealtimePublisher,
    config: ConfigService<Env, true>,
  ) {
    this.publicBaseUrl = config.get('APP_URL', { infer: true }).replace(/\/$/, '');
  }

  // --- reads -------------------------------------------------------------------------------------------------------------------

  /** The workspace's channels, oldest first. A row whose kind has no adapter here (a simulator row in production) is left out. */
  async list(): Promise<ChannelListResponse> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId);
      const data: ChannelResponse[] = [];
      for (const row of rows) {
        const adapter = this.adapters.find(row.kind);
        if (adapter) data.push(toChannelResponse(row, adapter, this.publicBaseUrl));
      }
      return { data };
    });
  }

  async get(uuid: string): Promise<ChannelResponse> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const row = await this.row(tx, orgId, uuid);
      return toChannelResponse(row, this.adapters.for(row.kind), this.publicBaseUrl);
    });
  }

  /** The row, or a 404 that never says whether the uuid exists in another workspace. */
  async row(tx: Tx, orgId: number, uuid: string): Promise<ChannelRow> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    if (!row) throw AppError.notFound('Channel', uuid);
    return row;
  }

  /**
   * A channel as an adapter needs it, credentials opened. For the send and the webhook paths inside this module only; the facade other
   * domains see never carries credentials.
   */
  async runtime(tx: Tx, orgId: number, row: ChannelRow): Promise<ChannelRuntime> {
    this.adapters.for(row.kind); // a kind with no adapter here has nothing to run
    const opened = this.vault.open(await this.repo.credentialsOf(tx, orgId, row.id), row.uuid);
    return {
      orgId,
      uuid: row.uuid,
      kind: row.kind,
      status: row.status,
      externalId: row.externalId,
      displayAddress: row.displayAddress,
      settings: normalizeSettings(row.kind, row.settings),
      capabilityOverrides: row.capabilities,
      credentials: opened.state === 'readable' ? opened.credentials : {},
    };
  }

  // --- writes ------------------------------------------------------------------------------------------------------------------

  async createSimulator(input: CreateSimulatorChannelInput): Promise<ChannelResponse> {
    this.simulator.assertCanCreate();
    const adapter = this.adapters.for('simulator');
    const { orgId, userId } = this.actor();
    return this.db.tx(async (tx) => {
      const row = await this.repo.insert(tx, orgId, {
        kind: 'simulator',
        name: input.name,
        status: 'connected',
        externalId: null,
        displayAddress: null,
        credentialsEnc: null,
        credentialHints: {},
        webhookTokenHash: null,
        settings: mergeSettings('simulator', normalizeSettings('simulator', {}), input.settings),
        createdBy: userId,
      });
      if (!row) throw new Error('simulator insert returned no row');
      await this.recordCreated(tx, row);
      return toChannelResponse(row, adapter, this.publicBaseUrl);
    });
  }

  /** Connects a provider account. The verify token in the answer is the only time it is shown. */
  async create(input: CreateChannelInput): Promise<ChannelWebhookReveal> {
    const adapter = this.adapters.for(input.kind);
    if (!adapter.credentialsSchema) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        `Channel kind "${input.kind}" cannot be connected with credentials`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const { orgId, userId } = this.actor();
    const credentials = this.parseCredentials(adapter, input.credentials);
    await this.assertRequirements(adapter, orgId, credentials);
    const sealed = this.vault.seal(credentials, adapter.secretFields);
    const token = this.vault.newWebhookToken();
    return this.db.tx(async (tx) => {
      const row = await this.repo.insert(tx, orgId, {
        kind: adapter.kind,
        name: input.name,
        // Connected only when a person switches it on, and then only after a live health check passed (see `update`).
        status: 'disconnected',
        externalId: adapter.externalIdOf(credentials),
        displayAddress: input.displayAddress ?? null,
        businessAccountId: credentials.businessAccountId ?? null,
        credentialsEnc: sealed.cipher,
        credentialHints: sealed.hints,
        webhookTokenHash: token.hash,
        settings: mergeSettings(adapter.kind, normalizeSettings(adapter.kind, {}), input.settings),
        createdBy: userId,
      });
      if (!row) throw this.alreadyConnected();
      await this.recordCreated(tx, row);
      return {
        ...toChannelResponse(row, adapter, this.publicBaseUrl),
        webhookVerifyToken: token.token,
      };
    });
  }

  async update(uuid: string, input: UpdateChannelInput): Promise<ChannelResponse> {
    const { orgId } = this.actor();

    // Read first, and prove the credentials work before anything is written: a call to the provider never holds a transaction open,
    // and a channel is never switched on with credentials nobody has tried.
    const pre = await this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      const adapter = this.adapters.for(before.kind);
      const connecting = input.status === 'connected' && before.status !== 'connected';
      if (connecting) this.assertCanConnect(adapter, before);
      const merged =
        input.credentials !== undefined
          ? await this.rotatedCredentials(tx, orgId, before, adapter, input.credentials)
          : null;
      const opened = connecting ? await this.runtime(tx, orgId, before) : null;
      const runtime = opened && merged ? { ...opened, credentials: merged } : opened;
      return { adapter, merged, runtime, connecting };
    });
    if (pre.merged) await this.assertRequirements(pre.adapter, orgId, pre.merged);

    let proven: ChannelHealthResult | null = null;
    if (pre.connecting && pre.runtime && pre.adapter.checkHealth) {
      proven = await this.probe(pre.adapter, pre.runtime);
      if (!proven.health.ok) {
        await this.storeHealth(orgId, uuid, proven);
        throw new AppError(
          ERROR_CODES.CHANNEL_HEALTH_FAILED,
          `The provider did not accept this channel: ${proven.health.errorMessage ?? 'the health check failed'}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }

    return this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      const adapter = this.adapters.for(before.kind);

      const patch: Parameters<ChannelsRepository['update']>[4] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.status !== undefined) patch.status = input.status;
      if (input.displayAddress !== undefined) patch.displayAddress = input.displayAddress;
      if (input.settings !== undefined) {
        patch.settings = mergeSettings(before.kind, before.settings, input.settings);
      }
      if (pre.merged) {
        const sealed = this.vault.seal(pre.merged, adapter.secretFields);
        patch.credentialsEnc = sealed.cipher;
        patch.credentialHints = sealed.hints;
        patch.externalId = adapter.externalIdOf(pre.merged);
        patch.businessAccountId = pre.merged.businessAccountId ?? null;
        // New credentials have not been checked: the channel waits for a person to switch it on again (and a channel the provider
        // had refused is no longer refused, as far as anyone knows).
        if (input.status === undefined && before.status !== 'disconnected')
          patch.status = 'disconnected';
        patch.health = null;
        patch.lastError = null;
      }
      if (proven) {
        patch.health = proven.health;
        patch.lastError = null;
      } else if (patch.status === 'connected') {
        patch.lastError = null;
      }

      let after: ChannelRow | null;
      try {
        after = await this.repo.update(tx, orgId, before.id, input.rowVersion, patch);
      } catch (err) {
        if (pgCode(err) === PG_UNIQUE_VIOLATION) throw this.alreadyConnected();
        throw err;
      }
      if (!after) throw AppError.rowVersionConflict('Channel');

      const delta = this.audit.diff(this.auditView(before), this.auditView(after));
      if (input.credentials !== undefined)
        delta.credentials = { old: '[sealed]', new: '[rotated]' };
      await this.audit.record(tx, {
        module: CHANNELS_MODULE,
        recordId: after.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: CHANNELS_MODULE,
        aggregateId: after.id,
        eventType: 'channel.updated',
        payload: { uuid: after.uuid, kind: after.kind, status: after.status },
      });
      return toChannelResponse(after, adapter, this.publicBaseUrl);
    });
  }

  // --- connection: requirements, health, webhook -----------------------------------------------------------------------------

  /** What a connection of this kind needs in this workspace (which credential keys the form must ask for). */
  async requirements(kind: string): Promise<WhatsappCredentialRequirements> {
    const { orgId } = this.actor();
    const adapter = this.adapters.for(kind);
    const req = await adapter.credentialRequirements?.(orgId);
    if (!req) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        `Channel kind "${kind}" has no connection requirements`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return req as WhatsappCredentialRequirements;
  }

  /**
   * A live read of the provider account with the stored credentials; stores the snapshot (and moves the status when the provider
   * refused the credentials) and answers with it. A failed check is an answer (`ok: false` with the reason), not an error.
   */
  async checkHealth(uuid: string): Promise<ChannelHealthResponse> {
    const { orgId } = this.actor();
    const { row, adapter, runtime } = await this.db.tx(async (tx) => {
      const found = await this.row(tx, orgId, uuid);
      const a = this.adapters.for(found.kind);
      return { row: found, adapter: a, runtime: await this.runtime(tx, orgId, found) };
    });
    if (!adapter.checkHealth) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        'This channel has no health check',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const result = await this.probe(adapter, runtime);
    const after = await this.storeHealth(orgId, uuid, result);
    return {
      ...result.health,
      status: after?.status ?? row.status,
      rowVersion: after?.rowVersion ?? row.rowVersion,
    };
  }

  /**
   * Points the provider's webhooks for this channel at us. With the provider's per-number override (a BSP proxy always; Meta when
   * asked) a new verify token is issued FIRST and committed, because the provider checks it against our GET challenge during the
   * call; the token is shown once in the answer.
   */
  async configureWebhook(
    uuid: string,
    input: SubscribeChannelInput,
  ): Promise<SubscribeChannelResponse> {
    const { orgId } = this.actor();
    const { adapter, runtime } = await this.db.tx(async (tx) => {
      const row = await this.row(tx, orgId, uuid);
      return { adapter: this.adapters.for(row.kind), runtime: await this.runtime(tx, orgId, row) };
    });
    if (!adapter.configureNumberWebhook) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        'This channel has no webhook to configure',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const mode = (await adapter.webhookMode?.(runtime)) ?? 'subscribe';
    const override = input.overrideCallback || mode === 'number_override';

    let config: { callbackUrl: string; verifyToken: string } | undefined;
    if (override) {
      const token = this.vault.newWebhookToken();
      await this.db.tx(async (tx) => {
        const row = await this.row(tx, orgId, uuid);
        await this.repo.setWebhookTokenHash(tx, orgId, row.id, token.hash);
        await this.audit.record(tx, {
          module: CHANNELS_MODULE,
          recordId: row.id,
          action: 'update',
          delta: { webhookToken: { old: '[hash]', new: '[rotated]' } },
        });
      });
      config = { callbackUrl: `${this.publicBaseUrl}${webhookPath(uuid)}`, verifyToken: token.token };
    }
    try {
      const done = await adapter.configureNumberWebhook(runtime, config);
      return {
        subscribed: true,
        overrideApplied: done.overrideApplied,
        webhookVerifyToken: config?.verifyToken ?? null,
      };
    } catch (err) {
      if (err instanceof ChannelError) {
        throw new AppError(
          ERROR_CODES.CHANNEL_PROVIDER_REFUSED,
          `The provider refused the webhook configuration: ${err.message}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  /**
   * A send (or a media fetch) found that the provider no longer accepts the channel's credentials. A connected channel moves to
   * `needs_reauth` (the customer can paste a new token) or `error` (the platform's own credential failed), with the reason, an audit
   * row and an outbox event in one transaction, and the people who manage channels are told after the commit. Idempotent: only the
   * first call finds the channel still connected.
   */
  async markCredentialsRefused(
    orgId: number,
    channelUuid: string,
    err: ChannelError,
  ): Promise<boolean> {
    const status = err.providerFault ? 'error' : 'needs_reauth';
    const lastError = {
      code: err.code,
      message: err.message.slice(0, 500),
      at: new Date().toISOString(),
    };
    const moved = await this.db.txAs({ orgId }, async (tx) => {
      const found = await this.repo.byUuid(tx, orgId, channelUuid);
      if (!found) return null;
      const after = await this.repo.markCredentialsRefused(tx, orgId, found.id, status, lastError);
      if (!after) return null;
      await this.audit.record(tx, {
        module: CHANNELS_MODULE,
        recordId: after.id,
        action: 'update',
        delta: {
          status: { old: found.status, new: after.status },
          lastError: { old: null, new: err.code },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: CHANNELS_MODULE,
        aggregateId: after.id,
        eventType: 'channel.status_changed',
        payload: {
          uuid: after.uuid,
          kind: after.kind,
          from: found.status,
          to: after.status,
          code: err.code,
        },
      });
      return after;
    });
    if (!moved) return false;
    await this.realtime.channelStatus(
      orgId,
      moved.uuid,
      moved.status,
      lastError.code,
      lastError.message,
    );
    return true;
  }

  /** Issues a new webhook verify token; the old one stops working at once. Shown once. */
  async rotateWebhookToken(uuid: string): Promise<ChannelWebhookReveal> {
    const { orgId } = this.actor();
    const token = this.vault.newWebhookToken();
    return this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      const adapter = this.adapters.for(before.kind);
      if (!adapter.publicWebhook) {
        throw new AppError(
          ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
          'This channel has no webhook',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const after = await this.repo.setWebhookTokenHash(tx, orgId, before.id, token.hash);
      if (!after) throw AppError.notFound('Channel', uuid);
      await this.audit.record(tx, {
        module: CHANNELS_MODULE,
        recordId: after.id,
        action: 'update',
        delta: { webhookToken: { old: '[hash]', new: '[rotated]' } },
      });
      return {
        ...toChannelResponse(after, adapter, this.publicBaseUrl),
        webhookVerifyToken: token.token,
      };
    });
  }

  /** Removes a channel nobody has talked through. One with conversations is refused (the database's RESTRICT key). */
  async remove(uuid: string): Promise<void> {
    const { orgId } = this.actor();
    await this.db.tx(async (tx) => {
      const row = await this.row(tx, orgId, uuid);
      await this.audit.record(tx, { module: CHANNELS_MODULE, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: CHANNELS_MODULE,
        aggregateId: row.id,
        eventType: 'channel.deleted',
        payload: { uuid: row.uuid, kind: row.kind, name: row.name },
      });
      try {
        await this.repo.delete(tx, orgId, row.id);
      } catch (err) {
        if (pgCode(err) === PG_FK_VIOLATION) {
          throw new AppError(
            ERROR_CODES.CHANNEL_IN_USE,
            'This channel has conversations. Disconnect it instead of deleting it.',
            HttpStatus.CONFLICT,
          );
        }
        throw err;
      }
    });
  }

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  /** Runs the adapter's health check; a refusal to even try (no credentials) is a failed check, not an exception. */
  private async probe(
    adapter: ChannelAdapter,
    runtime: ChannelRuntime,
  ): Promise<ChannelHealthResult> {
    try {
      return await adapter.checkHealth!(runtime);
    } catch (err) {
      if (!(err instanceof ChannelError)) throw err;
      return {
        needsReauth: err.needsReauth,
        providerFault: err.providerFault,
        health: {
          ok: false,
          overall: 'blocked',
          checkedAt: new Date().toISOString(),
          displayName: null,
          displayPhoneNumber: null,
          qualityRating: null,
          messagingLimitTier: null,
          phoneStatus: null,
          codeVerificationStatus: null,
          nameStatus: null,
          platformType: null,
          token: { valid: null, expiresAt: null, scopes: null },
          webhook: { subscribed: null },
          issues: [{ severity: 'critical', code: err.code, title: err.message, detail: null }],
          errorCode: err.code,
          errorMessage: err.message,
        },
      };
    }
  }

  /**
   * Stores a health check's outcome and moves the status by what it found: credentials the provider refuses take a connected (or
   * already refused) channel to `needs_reauth` / `error`; a passing check takes a refused channel back to `disconnected` (usable,
   * waiting for a person to switch it on); anything else (the provider unreachable) leaves the status alone.
   */
  private async storeHealth(
    orgId: number,
    uuid: string,
    r: ChannelHealthResult,
  ): Promise<ChannelRow | null> {
    const done = await this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      let status: ChannelStatus = before.status;
      if (r.health.ok) {
        if (before.status === 'needs_reauth' || before.status === 'error') status = 'disconnected';
      } else if (r.providerFault) {
        if (before.status === 'connected') status = 'error';
      } else if (r.needsReauth) {
        if (before.status === 'connected' || before.status === 'error') status = 'needs_reauth';
      }
      const lastError = r.health.ok
        ? null
        : {
            code: r.health.errorCode ?? 'HEALTH_CHECK_FAILED',
            message: (r.health.errorMessage ?? 'The health check failed').slice(0, 500),
            at: r.health.checkedAt,
          };
      const after = await this.repo.recordHealth(tx, orgId, before.id, {
        status,
        health: r.health,
        lastError,
      });
      if (after && after.status !== before.status) {
        await this.outbox.emit(tx, {
          aggregateModule: CHANNELS_MODULE,
          aggregateId: after.id,
          eventType: 'channel.status_changed',
          payload: {
            uuid: after.uuid,
            kind: after.kind,
            from: before.status,
            to: after.status,
            code: lastError?.code ?? null,
          },
        });
      }
      return { before, after, lastError };
    });
    if (done.after && done.after.status !== done.before.status) {
      await this.realtime.channelStatus(
        orgId,
        done.after.uuid,
        done.after.status,
        done.lastError?.code ?? null,
        done.lastError?.message ?? null,
      );
    }
    return done.after;
  }

  /** The credential keys this workspace's provider needs (own token, or the platform's) must all be present. */
  private async assertRequirements(
    adapter: ChannelAdapter,
    orgId: number,
    credentials: Credentials,
  ): Promise<void> {
    const req = await adapter.credentialRequirements?.(orgId);
    if (!req) return;
    const missing = req.required.filter((k) => !credentials[k]);
    if (missing.length > 0) {
      throw AppError.validation(
        'Credentials are incomplete',
        missing.map((k) => ({ path: `credentials.${k}`, message: 'required' })),
      );
    }
  }

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  private parseCredentials(adapter: ChannelAdapter, raw: unknown): Credentials {
    const parsed = adapter.credentialsSchema!.safeParse(raw);
    if (!parsed.success) {
      throw AppError.validation(
        'Credentials failed validation',
        parsed.error.issues.map((i) => ({
          path: `credentials.${i.path.join('.')}`,
          message: i.message,
        })),
      );
    }
    return parsed.data;
  }

  /** The stored credentials with the supplied keys replaced, validated as a whole (a rotation cannot leave a required key out). */
  private async rotatedCredentials(
    tx: Tx,
    orgId: number,
    row: ChannelRow,
    adapter: ChannelAdapter,
    partial: Record<string, string | undefined>,
  ): Promise<Credentials> {
    if (!adapter.credentialsSchema) {
      throw AppError.validation('This channel takes no credentials', [
        { path: 'credentials', message: 'not applicable' },
      ]);
    }
    const opened = this.vault.open(await this.repo.credentialsOf(tx, orgId, row.id), row.uuid);
    if (opened.state === 'unreadable' && Object.keys(partial).length === 0) {
      throw AppError.validation('Stored credentials cannot be read: send all of them again');
    }
    const current = opened.state === 'readable' ? opened.credentials : {};
    return this.parseCredentials(adapter, { ...current, ...partial });
  }

  private assertCanConnect(adapter: ChannelAdapter, row: ChannelRow): void {
    if (!adapter.live) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        `Sending through ${row.kind} is not available yet`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (adapter.credentialsSchema && !row.hasCredentials) {
      throw AppError.validation('Add credentials before connecting', [
        { path: 'credentials', message: 'required' },
      ]);
    }
  }

  private alreadyConnected(): AppError {
    return new AppError(
      ERROR_CODES.CHANNEL_ALREADY_CONNECTED,
      'This account is already connected in this workspace',
      HttpStatus.CONFLICT,
    );
  }

  private async recordCreated(tx: Tx, row: ChannelRow): Promise<void> {
    await this.audit.record(tx, { module: CHANNELS_MODULE, recordId: row.id, action: 'insert' });
    await this.outbox.emit(tx, {
      aggregateModule: CHANNELS_MODULE,
      aggregateId: row.id,
      eventType: 'channel.created',
      payload: { uuid: row.uuid, kind: row.kind, name: row.name },
    });
  }

  private auditView(r: ChannelRow): Record<string, unknown> {
    return {
      name: r.name,
      status: r.status,
      displayAddress: r.displayAddress,
      externalId: r.externalId,
      settings: r.settings,
    };
  }
}
