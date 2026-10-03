import { Injectable, Logger } from '@nestjs/common';
import type { ChannelStatus } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { WabaConnectService, type ResolvedWabaConnection } from '../whatsapp-cloud-api-waba';
import { CHANNELS_MODULE } from './channel-registry.service';
import { normalizeSettings } from './channel-settings';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';

export const WHATSAPP_CHANNEL_KIND = 'whatsapp_cloud';

const DIGITS = /^\d{5,32}$/;

export interface EnsureOptions {
  /** Create the channel when the connection has none (a connection just made, or the first inbound message). */
  create: boolean;
  /**
   * The connection was (re)connected just now: its channel comes back to what the connection says (`connected`), whatever the channel
   * was (a refused token that was replaced, a channel somebody switched off), and the last error is cleared.
   */
  revive?: boolean;
}

const nameOf = (c: ResolvedWabaConnection): string =>
  (c.label?.trim() || c.phoneNumber?.trim() || 'WhatsApp').slice(0, 120);

/**
 * Keeps the inbox's WhatsApp channels in step with the numbers connected in the WABA domain. A number is connected, re-tokened and removed
 * under WhatsApp numbers (`wa_provider_configs`); the inbox needs a `channels` row per number because a conversation, a send and a receipt
 * all name a channel. The row carries no credentials: `channels.waba_config_id` points at the connection that does.
 *
 * It runs in three places, all idempotent: when the connection says it was connected, disconnected or removed (an outbox consumer in the
 * worker); when the first message of a number arrives (the inbound sink, so a number connected before this existed still gets its channel);
 * and in the migration that introduced the link. A channel somebody created for the same phone number before it was linked is adopted, not
 * duplicated.
 */
@Injectable()
export class WabaChannelLinkService {
  private readonly logger = new Logger(WabaChannelLinkService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly waba: WabaConnectService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly realtime: ChatRealtimePublisher,
  ) {}

  /**
   * The channel of a connection, found or (when `create`) made, brought in step with the connection. Null when there is nothing to
   * show: the connection is gone, has no phone number id, or its number is held by another workspace.
   */
  async ensure(orgId: number, configId: number, opts: EnsureOptions): Promise<ChannelRow | null> {
    const run = () => this.ensureInContext(orgId, configId, opts);
    return RequestContextStore.peek()
      ? run()
      : RequestContextStore.run(
          {
            requestId: `waba-link-${configId}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          run,
        );
  }

  /** The channel of a connection, without creating or changing anything. */
  async find(orgId: number, configId: number): Promise<ChannelRow | null> {
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.byWabaConfig(tx, orgId, configId),
    );
  }

  /**
   * A connection was deleted: the database detached its channel (the link column went to null), and a WhatsApp channel with no link has no
   * credentials, so it is shown as disconnected instead of waiting for its first failed send to say so.
   */
  async connectionRemoved(orgId: number): Promise<number> {
    const moved = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.repo.disconnectUnlinked(tx, orgId, WHATSAPP_CHANNEL_KIND),
    );
    for (const row of moved)
      await this.realtime.channelStatus(orgId, row.uuid, 'disconnected', null, null);
    return moved.length;
  }

  // --- internals ---------------------------------------------------------------------------------------------------------------

  private async ensureInContext(
    orgId: number,
    configId: number,
    opts: EnsureOptions,
  ): Promise<ChannelRow | null> {
    const done = await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const cfg = await this.waba.resolveConnection(tx, orgId, { id: configId });
      if (!cfg) return null;
      const desired: ChannelStatus = cfg.status === 'connected' ? 'connected' : 'disconnected';
      const display = cfg.phoneNumber?.trim() ? cfg.phoneNumber.trim().slice(0, 40) : null;
      const account = cfg.wabaId && DIGITS.test(cfg.wabaId) ? cfg.wabaId : null;

      let row = await this.repo.byWabaConfig(tx, orgId, configId);
      let created = false;
      let before: ChannelRow | null = row;

      if (!row) {
        if (!opts.create || !cfg.phoneNumberId || !DIGITS.test(cfg.phoneNumberId)) return null;
        const existing = await this.repo.byExternal(
          tx,
          orgId,
          WHATSAPP_CHANNEL_KIND,
          cfg.phoneNumberId,
        );
        if (existing) {
          // The same number already has a channel here (it was made before the link, or its old connection was replaced).
          if (desired !== 'connected') return null;
          before = existing;
          row = await this.repo.syncWaba(tx, orgId, existing.id, {
            wabaConfigId: configId,
            status: 'connected',
            displayAddress: existing.displayAddress ?? display,
            businessAccountId: account ?? existing.businessAccountId,
            clearLastError: true,
          });
        } else {
          row = await this.repo.insert(tx, orgId, {
            kind: WHATSAPP_CHANNEL_KIND,
            name: nameOf(cfg),
            status: desired,
            externalId: cfg.phoneNumberId,
            displayAddress: display,
            businessAccountId: account,
            wabaConfigId: configId,
            credentialsEnc: null,
            credentialHints: {},
            webhookTokenHash: null,
            settings: normalizeSettings(WHATSAPP_CHANNEL_KIND, {}),
            createdBy: null,
          });
          if (row) {
            created = true;
            before = null;
          } else {
            // No row back: either a concurrent first message made this very channel a moment ago (the unique keys held), or another
            // workspace holds the number (the first to connect it does). Only the first is ours to use.
            row = await this.repo.byWabaConfig(tx, orgId, configId);
          }
        }
      } else {
        const patch: Parameters<ChannelsRepository['syncWaba']>[3] = {};
        if (opts.revive) {
          if (row.status !== desired) patch.status = desired;
          if (desired === 'connected' && row.lastError) patch.clearLastError = true;
        } else if (desired === 'disconnected' && row.status !== 'disconnected') {
          patch.status = 'disconnected';
        }
        if (row.displayAddress === null && display) patch.displayAddress = display;
        if (account && row.businessAccountId !== account) patch.businessAccountId = account;
        if (Object.keys(patch).length > 0)
          row = (await this.repo.syncWaba(tx, orgId, row.id, patch)) ?? row;
      }
      if (!row) return null;

      if (created) {
        await this.audit.record(tx, {
          module: CHANNELS_MODULE,
          recordId: row.id,
          action: 'insert',
        });
        await this.outbox.emit(tx, {
          aggregateModule: CHANNELS_MODULE,
          aggregateId: row.id,
          eventType: 'channel.created',
          payload: { uuid: row.uuid, kind: row.kind, name: row.name },
        });
      }
      const from = before?.status ?? null;
      if (from !== null && from !== row.status) {
        await this.audit.record(tx, {
          module: CHANNELS_MODULE,
          recordId: row.id,
          action: 'update',
          delta: { status: { old: from, new: row.status } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: CHANNELS_MODULE,
          aggregateId: row.id,
          eventType: 'channel.status_changed',
          payload: { uuid: row.uuid, kind: row.kind, from, to: row.status, code: null },
        });
      }
      return { row, from };
    });
    if (!done) return null;
    if (done.from !== null && done.from !== done.row.status) {
      await this.realtime.channelStatus(orgId, done.row.uuid, done.row.status, null, null);
      this.logger.log(
        { orgId, channel: done.row.uuid, from: done.from, to: done.row.status },
        'whatsapp channel status synced',
      );
    }
    return done.row;
  }
}
