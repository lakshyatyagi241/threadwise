import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ChannelHealthResponse,
  type ChannelListResponse,
  type ChannelResponse,
  type ChannelStatus,
  type CreateSimulatorChannelInput,
  type UpdateChannelInput,
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
import { WabaConnectService } from '../whatsapp-cloud-api-waba';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { mergeSettings, normalizeSettings } from './channel-settings';
import { ChannelVault } from './channel-vault';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { toChannelResponse } from './channels.mapper';
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
 * A WhatsApp channel is the inbox view of a number connected in the WABA domain (`channels.waba_config_id`, kept in step by
 * `WabaChannelLinkService`): it holds no credentials, and `runtime()` opens the connection's for the one call. Connecting, re-tokening
 * and removing the number happen under WhatsApp numbers, not here. What is left here is what the inbox owns: the list, the name, the
 * settings, switching a channel on or off, the health snapshot and the system marking a channel whose credentials the provider refused.
 *
 * Secrets: a channel's own stored credentials (a kind that takes them) are sealed by the vault and never part of any response.
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
    private readonly waba: WabaConnectService,
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
   *
   * A WhatsApp channel's credentials are its linked connection's, decrypted by the WABA domain: `route`, `accessToken` (Meta) or
   * `authKey` (Interakt), `businessAccountId`; the phone number id is the channel's `externalId`. A connection that is no longer
   * connected makes the channel read `disconnected` here whatever its own row says, so a send never leaves from a number a person
   * has disconnected, even in the moment before the link service has caught up.
   */
  async runtime(tx: Tx, orgId: number, row: ChannelRow): Promise<ChannelRuntime> {
    this.adapters.for(row.kind); // a kind with no adapter here has nothing to run
    let status = row.status;
    let credentials: Readonly<Record<string, string | undefined>>;
    if (row.kind === 'whatsapp_cloud') {
      // A WhatsApp channel has no credentials of its own: an unlinked one has none at all and fails its send with a clear reason.
      const connection =
        row.wabaConfigId === null
          ? null
          : await this.waba.resolveConnection(tx, orgId, { id: row.wabaConfigId });
      if (connection && connection.status !== 'connected') status = 'disconnected';
      const conn = connection?.conn;
      credentials = conn
        ? {
            route: conn.provider,
            accessToken: conn.accessToken,
            authKey: conn.authKey,
            businessAccountId: conn.wabaId,
            phoneNumberId: conn.phoneNumberId,
          }
        : {};
    } else {
      const opened = this.vault.open(await this.repo.credentialsOf(tx, orgId, row.id), row.uuid);
      credentials = opened.state === 'readable' ? opened.credentials : {};
    }
    return {
      orgId,
      uuid: row.uuid,
      kind: row.kind,
      status,
      externalId: row.externalId,
      displayAddress: row.displayAddress,
      settings: normalizeSettings(row.kind, row.settings),
      capabilityOverrides: row.capabilities,
      credentials,
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

  /**
   * Keeps the inbox channel of an unofficial-engine device in step with the device (TW-NODE-017): one `whatsapp_qr` channel per
   * device, its handle the device uuid, `connected` while the device is. Called by the NODE runtime, which owns the device; the
   * caller supplies the system context (audit and outbox read it). Creates the channel the first time, then only touches what
   * changed. No credentials: the session lives in the runtime, not here.
   */
  async syncDeviceChannel(
    orgId: number,
    device: { uuid: string; name: string; displayAddress: string | null; connected: boolean },
  ): Promise<{ id: number; uuid: string; created: boolean }> {
    const status = device.connected ? 'connected' : 'disconnected';
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const found = await this.repo.byExternal(tx, orgId, 'whatsapp_qr', device.uuid);
      if (found) {
        if (
          found.status !== status ||
          found.name !== device.name ||
          found.displayAddress !== device.displayAddress
        ) {
          await this.repo.update(tx, orgId, found.id, found.rowVersion, {
            status,
            name: device.name,
            displayAddress: device.displayAddress,
          });
        }
        return { id: found.id, uuid: found.uuid, created: false };
      }
      const row = await this.repo.insert(tx, orgId, {
        kind: 'whatsapp_qr',
        name: device.name,
        status,
        externalId: device.uuid,
        displayAddress: device.displayAddress,
        credentialsEnc: null,
        credentialHints: {},
        webhookTokenHash: null,
        // The unofficial engine has no per-message bill from Meta: it does not draw on the wallet.
        settings: normalizeSettings('whatsapp_qr', { metered: false }),
        createdBy: null,
      });
      // Another worker created it between the read and the insert: take theirs.
      const won = row ?? (await this.repo.byExternal(tx, orgId, 'whatsapp_qr', device.uuid));
      if (!won) throw new Error('device channel could not be created');
      if (row) await this.recordCreated(tx, row);
      return { id: won.id, uuid: won.uuid, created: row !== null };
    });
  }

  async update(uuid: string, input: UpdateChannelInput): Promise<ChannelResponse> {
    const { orgId } = this.actor();

    // Read first, and prove the provider accepts the channel before anything is written: a call to the provider never holds a
    // transaction open, and a channel is never switched on that nobody has tried.
    const pre = await this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      const adapter = this.adapters.for(before.kind);
      const connecting = input.status === 'connected' && before.status !== 'connected';
      if (connecting) this.assertCanConnect(adapter, before);
      const runtime = connecting ? await this.runtime(tx, orgId, before) : null;
      return { adapter, runtime, connecting };
    });

    let proven: ChannelHealthResult | null = null;
    if (pre.connecting && pre.runtime && pre.adapter.checkHealth) {
      proven = await this.probe(pre.adapter, pre.runtime);
      if (!proven.health.ok) {
        await this.storeHealth(orgId, uuid, proven, false);
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

      await this.audit.record(tx, {
        module: CHANNELS_MODULE,
        recordId: after.id,
        action: 'update',
        delta: this.audit.diff(this.auditView(before), this.auditView(after)),
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

  // --- connection: health ------------------------------------------------------------------------------------------------------

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
    // A linked number whose connection is connected and passes the check is usable again: the credentials the provider refused were
    // replaced under WhatsApp numbers, and nobody switched this channel off (a disconnected row stays as it is).
    const revive = row.wabaConfigId !== null && runtime.status !== 'disconnected';
    const after = await this.storeHealth(orgId, uuid, result, revive);
    return {
      ...result.health,
      status: after?.status ?? row.status,
      rowVersion: after?.rowVersion ?? row.rowVersion,
    };
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
   * waiting for a person to switch it on), or straight to `connected` when `revive` (a linked number whose connection is connected);
   * anything else (the provider unreachable) leaves the status alone.
   */
  private async storeHealth(
    orgId: number,
    uuid: string,
    r: ChannelHealthResult,
    revive: boolean,
  ): Promise<ChannelRow | null> {
    const done = await this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      let status: ChannelStatus = before.status;
      if (r.health.ok) {
        if (before.status === 'needs_reauth' || before.status === 'error') {
          status = revive ? 'connected' : 'disconnected';
        }
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

  private actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
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
    if (row.kind === 'whatsapp_cloud' && row.wabaConfigId === null) {
      throw new AppError(
        ERROR_CODES.CHANNEL_KIND_UNAVAILABLE,
        'This WhatsApp channel is not linked to a connected WhatsApp number. Connect the number under WhatsApp numbers.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
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
