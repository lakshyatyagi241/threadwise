import { HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ChannelListResponse,
  type ChannelResponse,
  type ChannelWebhookReveal,
  type CreateChannelInput,
  type CreateSimulatorChannelInput,
  type UpdateChannelInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import type { ChannelAdapter, ChannelRuntime } from '../../infra/providers/chat-conversations';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { mergeSettings, normalizeSettings } from './channel-settings';
import { ChannelVault, type Credentials } from './channel-vault';
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
    const credentials = this.parseCredentials(adapter, input.credentials);
    const { orgId, userId } = this.actor();
    const sealed = this.vault.seal(credentials, adapter.secretFields);
    const token = this.vault.newWebhookToken();
    return this.db.tx(async (tx) => {
      const row = await this.repo.insert(tx, orgId, {
        kind: adapter.kind,
        name: input.name,
        // Connected only once the adapter can send AND a health check has passed; neither exists yet for a skeleton adapter.
        status: 'disconnected',
        externalId: adapter.externalIdOf(credentials),
        displayAddress: input.displayAddress ?? null,
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
    return this.db.tx(async (tx) => {
      const before = await this.row(tx, orgId, uuid);
      const adapter = this.adapters.for(before.kind);

      if (input.status === 'connected' && before.status !== 'connected') {
        this.assertCanConnect(adapter, before);
      }

      const patch: Parameters<ChannelsRepository['update']>[4] = {};
      if (input.name !== undefined) patch.name = input.name;
      if (input.status !== undefined) patch.status = input.status;
      if (input.displayAddress !== undefined) patch.displayAddress = input.displayAddress;
      if (input.settings !== undefined) {
        patch.settings = mergeSettings(before.kind, before.settings, input.settings);
      }
      if (input.credentials !== undefined) {
        const merged = await this.rotatedCredentials(tx, orgId, before, adapter, input.credentials);
        const sealed = this.vault.seal(merged, adapter.secretFields);
        patch.credentialsEnc = sealed.cipher;
        patch.credentialHints = sealed.hints;
        patch.externalId = adapter.externalIdOf(merged);
        // New credentials have not been checked: the channel waits for a person to switch it on again.
        if (before.status === 'connected' && input.status === undefined)
          patch.status = 'disconnected';
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
