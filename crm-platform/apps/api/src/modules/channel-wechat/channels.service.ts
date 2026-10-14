import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ConnectWechatChannelInput,
  type RecheckWechatChannelResponse,
  type WechatChannel,
  type WechatChannelList,
  type WechatServerConfig,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { WECHAT_API, type WechatApi } from '../../infra/providers/channel-wechat/wechat.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { ChatInboxIngest } from './chat-inbox-ingest';
import { WechatTokenService } from './wechat-token.service';
import { clipError, randomToken, tokenLifetimeSeconds, webhookUrl } from './wechat-rules';

const MODULE_KEY = 'wechat_channels';

/**
 * Connecting and managing WeChat Official Accounts (WECH).
 *
 * Connect follows Reference: WeChat proves the AppID and AppSecret (an access token is fetched), the channel is saved with its secrets
 * encrypted (a re-pasted AppID updates the same row and keeps its webhook address), and the person is shown the address and Token to paste
 * into the WeChat console, because WeChat has no API to set them. The AppSecret, the EncodingAESKey and the access token are never returned.
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
    @Inject(WECHAT_API) private readonly wechat: WechatApi,
    private readonly tokens: WechatTokenService,
    private readonly inbox: ChatInboxIngest,
  ) {}

  private url(row: ChannelRow): string {
    return webhookUrl(this.config.get('APP_URL', { infer: true }), row.webhookToken);
  }

  /** What the API shows of a channel: never a secret, only whether an EncodingAESKey is saved. */
  toResponse(row: ChannelRow): WechatChannel {
    return {
      id: row.uuid,
      appId: row.appId,
      wxId: row.wxId,
      accountName: row.accountName,
      encMode: row.encMode,
      hasEncodingAesKey: row.encodingAesKey !== null,
      active: row.active,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastError: row.lastError,
      webhookUrl: this.url(row),
      rowVersion: row.rowVersion,
    };
  }

  /** Keeps the channel's inbox channel in step with it. Best effort: the channel itself is already saved. */
  private async syncChannel(orgId: number, row: ChannelRow, connected: boolean): Promise<void> {
    try {
      await this.inbox.syncChannel(orgId, row, connected);
    } catch (err) {
      this.logger.warn({ err, orgId, channel: row.id }, 'wechat inbox channel not synced');
    }
  }

  async list(): Promise<WechatChannelList> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return { data: rows.map((r) => this.toResponse(r)) };
  }

  async connect(input: ConnectWechatChannelInput): Promise<WechatChannel> {
    const ctx = RequestContextStore.require();
    const appId = input.appId.trim();
    const appSecret = input.appSecret.trim();

    // WeChat proves the credentials before anything is saved: a call to the provider never holds a transaction open.
    const fetched = await this.wechat.fetchAccessToken(appId, appSecret);
    if (!fetched.ok) {
      throw new AppError(
        ERROR_CODES.WECH_CREDENTIALS_REJECTED,
        `WeChat rejected those credentials: ${fetched.error ?? ''}`.trim(),
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const expiresAt = new Date(Date.now() + tokenLifetimeSeconds(fetched.data.expiresIn) * 1000);

    const saved = await this.db.tx(async (tx) => {
      const existing = await this.repo.findByAppId(tx, ctx.orgId, appId);
      const values = {
        connectedBy: ctx.userId,
        appId,
        appSecret: this.crypto.encrypt(appSecret),
        verifyToken: this.crypto.encrypt(input.verifyToken.trim()),
        encodingAesKey: input.encodingAesKey ? this.crypto.encrypt(input.encodingAesKey) : null,
        encMode: input.encMode,
        accountName: input.accountName?.trim() || 'WeChat',
        cachedAccessToken: this.crypto.encrypt(fetched.data.accessToken),
        tokenExpiresAt: expiresAt,
      };
      const row = existing
        ? await this.repo.reconnect(tx, ctx.orgId, existing.id, values)
        : await this.repo.insert(tx, ctx.orgId, { ...values, webhookToken: randomToken() });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: existing ? 'update' : 'insert',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: row.id,
        eventType: 'wechat.channel.connected',
        payload: { uuid: row.uuid, appId, reconnected: Boolean(existing) },
      });
      return row;
    });

    await this.syncChannel(ctx.orgId, saved, saved.active);
    this.logger.log({ orgId: ctx.orgId, channel: saved.id }, 'wechat channel connected');
    return this.toResponse(saved);
  }

  /** The address and Token to paste into the WeChat console (Settings and development, Basic configuration, Server configuration). */
  async serverConfig(uuid: string): Promise<WechatServerConfig> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('WeChat channel', uuid);
    return { webhookUrl: this.url(row), verifyToken: this.crypto.decrypt(row.verifyToken) };
  }

  /** "Re-check": asks WeChat for a new access token with the saved credentials, and says whether it answered. */
  async recheck(uuid: string): Promise<RecheckWechatChannelResponse> {
    const { orgId } = RequestContextStore.require();
    const found = await this.db.tx((tx) => this.repo.findByUuid(tx, orgId, uuid));
    if (!found) throw AppError.notFound('WeChat channel', uuid);

    const ok = await this.tokens.recheck(orgId, found.id);
    const row = await this.db.tx((tx) => this.repo.findById(tx, orgId, found.id));
    if (!row) throw AppError.notFound('WeChat channel', uuid);
    return {
      channel: this.toResponse(row),
      checkError: ok ? null : clipError(row.lastError ?? 'token refresh failed'),
    };
  }

  /** Pause or resume. A paused channel still receives the handshake and pushes but ignores messages, and cannot send or broadcast. */
  async toggle(uuid: string): Promise<WechatChannel> {
    const { orgId } = RequestContextStore.require();
    const toggled = await this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, orgId, uuid, true);
      if (!row) throw AppError.notFound('WeChat channel', uuid);
      const next = await this.repo.setActive(tx, orgId, row.id, !row.active);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: row.id,
        action: 'update',
        delta: { active: { old: row.active, new: next.active } },
      });
      return next;
    });
    await this.syncChannel(orgId, toggled, toggled.active);
    return this.toResponse(toggled);
  }

  /** Disconnect: the channel and its broadcasts go; its inbox threads stay. Nothing to undo at WeChat (the address there is typed by hand). */
  async remove(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    const row = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, orgId, uuid, true);
      if (!found) throw AppError.notFound('WeChat channel', uuid);
      await this.repo.remove(tx, orgId, found.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: found.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'wechat.channel.disconnected',
        payload: { uuid: found.uuid, appId: found.appId },
      });
      return found;
    });
    await this.syncChannel(orgId, row, false);
  }
}
