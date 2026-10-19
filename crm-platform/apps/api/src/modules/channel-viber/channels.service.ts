import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ConnectViberChannelInput,
  type ConnectViberChannelResponse,
  type ViberChannelList,
  type ViberChannelResponse,
} from '@crm/contracts';
import { tokenColumns, tokenOf } from '../../common/crypto/secret-columns';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { VIBER_API, type ViberApiFactory } from '../../infra/providers/channel-viber/viber.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import {
  clipError,
  randomToken,
  senderObject,
  webhookRefusedMessage,
  webhookUrl,
} from './channel-rules';
import { ChannelsRepository, type ChannelRow } from './channels.repository';

const MODULE_KEY = 'viber_channels';

/**
 * Connecting and managing Viber channels (TW-VIB-001, 002, 007).
 *
 * Connect follows Reference's order: Viber proves the token (`get_account_info`, which also gives the bot's name, address and icon),
 * the channel is saved (a re-pasted token for the same account updates the same row and keeps its routing token), then the webhook is
 * registered. A refused webhook does not lose the channel: it stays saved with the reason on it ("needs attention") and the answer says
 * how to fix it. The token is encrypted at rest and never returned.
 */
@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    @Inject(VIBER_API) private readonly viber: ViberApiFactory,
    private readonly inbox: ChatInboxIngest,
  ) {}

  /** Keeps the channel's inbox channel in step with the account. Best effort: the channel itself is already saved. */
  private async syncChannel(orgId: number, row: ChannelRow, connected: boolean): Promise<void> {
    try {
      await this.inbox.syncChannel(orgId, row, connected);
    } catch (err) {
      this.logger.warn({ err, orgId, channel: row.id }, 'viber inbox channel not synced');
    }
  }

  private url(row: ChannelRow): string {
    return webhookUrl(
      this.config.get('APP_URL', { infer: true }),
      tokenOf(this.crypto, { enc: row.webhookTokenEnc, plain: row.webhookToken }),
    );
  }

  /** What the API shows of a channel: never the token. */
  toResponse(row: ChannelRow): ViberChannelResponse {
    return {
      id: row.uuid,
      viberId: row.viberId,
      name: row.name,
      uri: row.uri,
      avatar: row.avatar,
      active: row.active,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastError: row.lastError,
      webhookUrl: this.url(row),
      rowVersion: row.rowVersion,
    };
  }

  async list(): Promise<ViberChannelList> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return { data: rows.map((r) => this.toResponse(r)) };
  }

  async connect(input: ConnectViberChannelInput): Promise<ConnectViberChannelResponse> {
    const ctx = RequestContextStore.require();

    const token = input.authToken.trim();
    const info = await this.viber.forToken(token).getAccountInfo();
    if (!info.ok) {
      throw new AppError(
        ERROR_CODES.VIB_TOKEN_REJECTED,
        `Viber rejected that auth token: ${info.error ?? ''}`.trim(),
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const identity = info.data ?? {};
    const viberId = identity.id === undefined ? '' : String(identity.id);

    const saved = await this.db.tx(async (tx) => {
      const existing =
        viberId !== '' ? await this.repo.findByViberId(tx, ctx.orgId, viberId) : undefined;
      const values = {
        connectedBy: ctx.userId,
        authToken: this.crypto.encrypt(token),
        name: identity.name || 'Viber',
        uri: identity.uri ?? '',
        avatar: identity.icon ?? '',
      };
      const row = existing
        ? await this.repo.reconnect(tx, ctx.orgId, existing.id, values)
        : await this.repo.insert(tx, ctx.orgId, {
            ...values,
            viberId,
            webhookToken: tokenColumns(this.crypto, randomToken()),
          });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: existing ? 'update' : 'insert',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'viber.channel.connected',
        payload: { uuid: row.uuid, name: row.name, reconnected: Boolean(existing) },
      });
      return row;
    });

    // Registered after the row exists: the URL carries the routing token.
    const hook = await this.viber
      .forToken(token, senderObject(saved.name, saved.avatar))
      .setWebhook(this.url(saved));
    const row = await this.db.tx((tx) =>
      this.repo.setError(tx, ctx.orgId, saved.id, hook.ok ? null : clipError(hook.error)),
    );
    await this.syncChannel(ctx.orgId, row, row.active);
    this.logger.log(
      { orgId: ctx.orgId, channel: row.id, webhook: hook.ok },
      'viber channel connected',
    );
    return {
      ...this.toResponse(row),
      webhookError: hook.ok ? null : webhookRefusedMessage(hook.error ?? ''),
    };
  }

  /** "Re-hook": registers the webhook again with the stored token. */
  async retryWebhook(uuid: string): Promise<ConnectViberChannelResponse> {
    const ctx = RequestContextStore.require();
    const channel = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!channel) throw AppError.notFound('Viber channel', uuid);

    const hook = await this.viber
      .forToken(this.crypto.decrypt(channel.authToken), senderObject(channel.name, channel.avatar))
      .setWebhook(this.url(channel));
    const row = await this.db.tx((tx) =>
      this.repo.setError(tx, ctx.orgId, channel.id, hook.ok ? null : clipError(hook.error)),
    );
    return {
      ...this.toResponse(row),
      webhookError: hook.ok ? null : `Viber refused the webhook: ${hook.error ?? ''}`.trim(),
    };
  }

  /** Pause or resume. A paused channel still receives pushes but ignores them, and cannot start a broadcast. */
  async toggle(uuid: string): Promise<ViberChannelResponse> {
    const ctx = RequestContextStore.require();
    const toggled = await this.db.tx(async (tx) => {
      const channel = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!channel) throw AppError.notFound('Viber channel', uuid);
      const row = await this.repo.setActive(tx, ctx.orgId, channel.id, !channel.active);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: channel.id,
        action: 'update',
        delta: { active: { old: channel.active, new: row.active } },
      });
      return row;
    });
    await this.syncChannel(ctx.orgId, toggled, toggled.active);
    return this.toResponse(toggled);
  }

  /** Disconnect: Viber's webhook is removed (errors ignored), then the channel goes. Its inbox threads stay. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const channel = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!channel) throw AppError.notFound('Viber channel', uuid);

    await this.viber
      .forToken(this.crypto.decrypt(channel.authToken))
      .removeWebhook()
      .catch(() => undefined);
    await this.db.tx(async (tx) => {
      await this.repo.remove(tx, ctx.orgId, channel.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: channel.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: channel.id,
        eventType: 'viber.channel.disconnected',
        payload: { uuid: channel.uuid, name: channel.name },
      });
    });
    await this.syncChannel(ctx.orgId, channel, false);
  }
}
