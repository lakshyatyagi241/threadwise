import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ConnectLineChannelInput,
  type ConnectLineChannelResponse,
  type LineChannelListResponse,
  type LineChannelResponse,
  type SaveLineRotationInput,
} from '@crm/contracts';
import { tokenColumns, tokenOf } from '../../common/crypto/secret-columns';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { LINE_API, type LineApiFactory } from '../../infra/providers/channel-line/line.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ChatInboxIngest } from './_shims/chat-inbox-ingest';
import {
  clipError,
  isNumericChannelId,
  randomToken,
  webhookRefusedMessage,
  webhookUrl,
} from './channel-rules';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { LineTokenService } from './line-token.service';
import { rotationConfigured } from './rotation-rules';

const MODULE_KEY = 'line_channels';

/**
 * Connecting and managing LINE channels.
 *
 * Connect follows Reference's order: LINE proves the token (bot info), the channel is saved (a re-pasted account, matched on its LINE
 * basic id, updates the same row and keeps its routing token), then the webhook is registered. A refused webhook does not lose the
 * channel: it stays saved with the reason on it ("needs attention") and the answer says how to fix it. The access token, the channel
 * secret and the rotation key are encrypted at rest and never returned.
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
    @Inject(LINE_API) private readonly line: LineApiFactory,
    private readonly inbox: ChatInboxIngest,
    private readonly tokens: LineTokenService,
  ) {}

  /** Keeps the channel's inbox channel in step with the channel. Best effort: the channel itself is already saved. */
  private async syncChannel(orgId: number, channel: ChannelRow, connected: boolean): Promise<void> {
    try {
      await this.inbox.syncChannel(orgId, channel, connected);
    } catch (err) {
      this.logger.warn({ err, orgId, channel: channel.id }, 'line inbox channel not synced');
    }
  }

  private url(row: ChannelRow): string {
    return webhookUrl(
      this.config.get('APP_URL', { infer: true }),
      tokenOf(this.crypto, { enc: row.webhookTokenEnc, plain: row.webhookToken }),
    );
  }

  /** What the API shows of a channel: never a token, a secret or the key, only whether rotation is on. */
  toResponse(row: ChannelRow): LineChannelResponse {
    const rotation = rotationConfigured(row.assertionKid, row.assertionPrivateKey);
    return {
      id: row.uuid,
      lineChannelId: row.lineChannelId,
      basicId: row.basicId,
      displayName: row.displayName,
      pictureUrl: row.pictureUrl,
      active: row.active,
      connectedAt: row.connectedAt?.toISOString() ?? null,
      lastInboundAt: row.lastInboundAt?.toISOString() ?? null,
      lastError: row.lastError,
      assertionKid: row.assertionKid,
      rotationEnabled: rotation,
      rotationExpiresAt: rotation ? (row.rotatingTokenExpiresAt?.toISOString() ?? null) : null,
      webhookUrl: this.url(row),
      rowVersion: row.rowVersion,
    };
  }

  async list(): Promise<LineChannelListResponse> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.list(tx, orgId));
    return { data: rows.map((r) => this.toResponse(r)) };
  }

  async connect(input: ConnectLineChannelInput): Promise<ConnectLineChannelResponse> {
    const ctx = RequestContextStore.require();

    const accessToken = input.channelAccessToken.trim();
    const secret = input.channelSecret.trim();
    const info = await this.line.forToken(accessToken).botInfo();
    if (!info.ok) {
      throw new AppError(
        ERROR_CODES.LINE_TOKEN_REJECTED,
        `LINE rejected that channel access token: ${info.error ?? ''}`.trim(),
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const data = info.data ?? {};
    const basicId = data.basicId ?? '';

    const saved = await this.db.tx(async (tx) => {
      const existing =
        basicId === '' ? undefined : await this.repo.findByBasicId(tx, ctx.orgId, basicId);
      const values = {
        connectedBy: ctx.userId,
        channelAccessToken: this.crypto.encrypt(accessToken),
        channelSecret: this.crypto.encrypt(secret),
        lineChannelId: data.userId ?? '',
        basicId,
        displayName: data.displayName || 'LINE',
        pictureUrl: data.pictureUrl ?? '',
      };
      const row = existing
        ? await this.repo.reconnect(tx, ctx.orgId, existing.id, values)
        : await this.repo.insert(tx, ctx.orgId, {
            ...values,
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
        eventType: 'line.channel.connected',
        payload: { uuid: row.uuid, basicId: row.basicId, reconnected: Boolean(existing) },
      });
      return row;
    });

    // Registered after the row exists: the URL carries the routing token.
    const hook = await this.line.forToken(accessToken).setWebhookEndpoint(this.url(saved));
    const row = await this.db.tx((tx) =>
      this.repo.setError(tx, ctx.orgId, saved.id, hook.ok ? null : clipError(hook.error)),
    );
    await this.syncChannel(ctx.orgId, row, row.active);
    this.logger.log(
      { orgId: ctx.orgId, channel: row.displayName, webhook: hook.ok },
      'line channel connected',
    );
    return {
      ...this.toResponse(row),
      webhookError: hook.ok ? null : webhookRefusedMessage(hook.error ?? ''),
    };
  }

  /** "Re-hook": registers the webhook again with the stored token (the rotated one when rotation is on). */
  async retryWebhook(uuid: string): Promise<ConnectLineChannelResponse> {
    const ctx = RequestContextStore.require();
    const channel = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!channel) throw AppError.notFound('LINE channel', uuid);

    const token = await this.tokens.accessToken(ctx.orgId, channel);
    const hook = await this.line.forToken(token).setWebhookEndpoint(this.url(channel));
    const row = await this.db.tx((tx) =>
      this.repo.setError(tx, ctx.orgId, channel.id, hook.ok ? null : clipError(hook.error)),
    );
    return {
      ...this.toResponse(row),
      webhookError: hook.ok ? null : `LINE refused the webhook: ${hook.error ?? ''}`.trim(),
    };
  }

  /** Pause or resume delivery. A paused channel still receives pushes but ignores them, and cannot start a broadcast. */
  async toggle(uuid: string): Promise<LineChannelResponse> {
    const ctx = RequestContextStore.require();
    const toggled = await this.db.tx(async (tx) => {
      const channel = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!channel) throw AppError.notFound('LINE channel', uuid);
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

  /**
   * Token rotation. The operator pastes the Assertion Signing Key (an RSA private key) and its key id from the LINE console; both are
   * saved (the key encrypted) and the first v2.1 token is minted at once, so a wrong key shows now. Blank fields turn rotation off and
   * go back to the pasted long-lived token. Like Reference, a key that could not mint stays saved, with the reason on the channel.
   */
  async saveRotation(uuid: string, input: SaveLineRotationInput): Promise<LineChannelResponse> {
    const ctx = RequestContextStore.require();
    const kid = (input.assertionKid ?? '').trim();
    const key = (input.assertionPrivateKey ?? '').trim();

    const saved = await this.db.tx(async (tx) => {
      const channel = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!channel) throw AppError.notFound('LINE channel', uuid);
      if (kid === '' || key === '') {
        const row = await this.repo.setRotation(tx, ctx.orgId, channel.id, {
          kid: null,
          privateKey: null,
        });
        await this.audit.record(tx, { module: MODULE_KEY, recordId: channel.id, action: 'update' });
        return { row, turnedOff: true };
      }
      const channelId =
        input.channelId ??
        (isNumericChannelId(channel.lineChannelId) ? channel.lineChannelId : null);
      if (!channelId) {
        throw new AppError(
          ERROR_CODES.LINE_ROTATION_FAILED,
          'This channel has no numeric Channel ID yet: enter the Channel ID shown in the LINE console.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const row = await this.repo.setRotation(tx, ctx.orgId, channel.id, {
        kid,
        privateKey: this.crypto.encrypt(key),
        channelId,
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: channel.id, action: 'update' });
      return { row, turnedOff: false };
    });
    if (saved.turnedOff) return this.toResponse(saved.row);

    const minted = await this.tokens.mint(ctx.orgId, saved.row);
    if (!minted.ok) {
      throw new AppError(
        ERROR_CODES.LINE_ROTATION_FAILED,
        `Could not mint a v2.1 token: ${minted.error || 'check the key and the kid.'}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const fresh = await this.db.tx((tx) => this.repo.findById(tx, ctx.orgId, saved.row.id));
    return this.toResponse(fresh ?? saved.row);
  }

  /** Disconnect: the channel is removed (LINE has no call to delete a webhook endpoint). Its inbox threads stay. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const channel = await this.db.tx((tx) => this.repo.findByUuid(tx, ctx.orgId, uuid));
    if (!channel) throw AppError.notFound('LINE channel', uuid);

    await this.db.tx(async (tx) => {
      await this.repo.remove(tx, ctx.orgId, channel.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: channel.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: channel.id,
        eventType: 'line.channel.disconnected',
        payload: { uuid: channel.uuid, basicId: channel.basicId },
      });
    });
    await this.syncChannel(ctx.orgId, channel, false);
  }
}
