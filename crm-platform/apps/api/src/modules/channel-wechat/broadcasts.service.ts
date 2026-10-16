import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  ERROR_CODES,
  WECHAT_LIST_MIN,
  type CreateWechatBroadcastInput,
  type WechatBroadcast,
  type WechatBroadcastCompose,
  type WechatBroadcastList,
  type WechatChat,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { BroadcastsRepository, type BroadcastRow } from './broadcasts.repository';
import { ChannelsRepository } from './channels.repository';
import { WechatAvailabilityService } from './wechat-availability.service';
import { STALE_SENDING_MINUTES } from './wechat-rules';

const MODULE_KEY = 'wechat_broadcasts';
const LIST_LIMIT = 50;
/** Reference listed the 1000 newest threads of a channel. */
const AUDIENCE_LIMIT = 1000;

export interface WechatBroadcastJob {
  orgId: number;
  broadcastId: number;
}

const refuse = (
  code: keyof typeof ERROR_CODES,
  message: string,
  status = HttpStatus.UNPROCESSABLE_ENTITY,
) => new AppError(ERROR_CODES[code], message, status);

const staleSending = (r: BroadcastRow, now = Date.now()): boolean =>
  r.status === 'sending' && r.updatedAt.getTime() < now - STALE_SENDING_MINUTES * 60_000;

/**
 * WeChat broadcasts (WECH): the followers a channel can reach, composing a draft with a frozen recipient list, and the operator's send,
 * retry and delete. WeChat's mass send is ONE call (all followers, a tag, or a list of at least two OpenIDs), so there is no batch loop
 * to pause: `BroadcastSenderService`, run by a worker job, makes the call and ends the broadcast `done` or `failed`.
 *
 * Differences from Reference: the call runs in a queue job, not inside the request that pressed Send; a draft cannot be paused (WeChat
 * cannot take a mass send back once it is made); the broadcast's id is passed to WeChat as `clientmsgid`, so a job that died after WeChat
 * accepted the call and is retried does not send twice.
 */
@Injectable()
export class BroadcastsService {
  private readonly logger = new Logger(BroadcastsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BroadcastsRepository,
    private readonly channels: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @InjectQueue(QUEUES.WECHAT_BROADCAST) private readonly queue: Queue<WechatBroadcastJob>,
    private readonly availability: WechatAvailabilityService,
  ) {}

  private toResponse(r: BroadcastRow): WechatBroadcast {
    return {
      id: r.uuid,
      name: r.name,
      channelId: r.channelUuid,
      channelName: r.channelName,
      audience: r.audience,
      tagId: r.tagId,
      massMsgId: r.massMsgId,
      status: r.status as WechatBroadcast['status'],
      total: r.total,
      sent: r.sent,
      failed: r.failed,
      lastError: r.lastError,
      canRetry: r.status === 'failed' || staleSending(r),
      startedAt: r.startedAt?.toISOString() ?? null,
      finishedAt: r.finishedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** The followers a channel carries: the audience of a picked-users broadcast (newest 1000). */
  async chats(channelUuid: string): Promise<{ data: WechatChat[] }> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const channel = await this.channels.findByUuid(tx, orgId, channelUuid);
      if (!channel) throw AppError.notFound('WeChat channel', channelUuid);
      const rows = await this.repo.chats(tx, orgId, channel.id, AUDIENCE_LIMIT);
      return {
        data: rows.map((c) => ({
          openid: c.openid,
          title: c.title,
          lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
        })),
      };
    });
  }

  /** What the compose page opens with. */
  async compose(): Promise<WechatBroadcastCompose> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const channels = await this.channels.list(tx, orgId);
      const templates = await this.repo.templates(tx, orgId);
      return {
        channels: channels.map((c) => ({
          id: c.uuid,
          accountName: c.accountName,
          appId: c.appId,
          active: c.active,
        })),
        templates: templates.map((t) => ({ id: t.uuid, name: t.name, body: t.body })),
      };
    });
  }

  /** The 50 newest broadcasts. */
  async list(): Promise<WechatBroadcastList> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, orgId, LIST_LIMIT);
      return { data: rows.map((r) => this.toResponse(r)) };
    });
  }

  async create(input: CreateWechatBroadcastInput): Promise<WechatBroadcast> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      if (!(await this.availability.forOrg(tx, ctx.orgId)).available) {
        throw WechatAvailabilityService.refused();
      }
      const channel = await this.channels.findByUuid(tx, ctx.orgId, input.channelId);
      if (!channel) throw AppError.notFound('WeChat channel', input.channelId);

      const template = input.templateId
        ? (await this.repo.templates(tx, ctx.orgId)).find((t) => t.uuid === input.templateId)
        : undefined;
      if (input.templateId && !template) throw AppError.notFound('Template', input.templateId);

      // Forged ids are dropped: only followers this channel really carries can be picked.
      let picked: Array<{ openid: string; title: string; conversationId: number }> = [];
      if (input.audience === 'list') {
        const audience = new Map(
          (await this.repo.chats(tx, ctx.orgId, channel.id, AUDIENCE_LIMIT)).map((c) => [
            c.openid,
            c,
          ]),
        );
        picked = [...new Set(input.openids ?? [])]
          .map((id) => audience.get(id))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
          .map((c) => ({ openid: c.openid, title: c.title, conversationId: c.conversationId }));
        if (picked.length < WECHAT_LIST_MIN) {
          throw refuse(
            'WECH_TOO_FEW_RECIPIENTS',
            'A WeChat OpenID broadcast needs at least 2 recipients from the list.',
          );
        }
      }

      const id = await this.repo.insert(tx, ctx.orgId, {
        channelRowId: channel.id,
        userId: ctx.userId,
        name: input.name,
        templateId: template?.id ?? null,
        body: this.crypto.encrypt(input.body),
        audience: input.audience,
        tagId: input.audience === 'tag' ? (input.tagId ?? '') : null,
        total: picked.length,
      });
      await this.repo.insertRecipients(tx, ctx.orgId, id, picked);
      const row = await this.repo.findById(tx, ctx.orgId, id);
      if (!row) throw AppError.notFound('WeChat broadcast', String(id));
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'wechat.broadcast.created',
        payload: { uuid: row.uuid, audience: input.audience, total: picked.length },
      });
      return this.toResponse(row);
    });
  }

  /** Send: draft (or a failed one) to sending; the worker makes the mass-send call. Already sending is returned as it is. */
  start(uuid: string): Promise<WechatBroadcast> {
    return this.queueSend(uuid, 'started');
  }

  /** Retry: the same call again for a failed broadcast (or one stuck in sending because its worker died). */
  retry(uuid: string): Promise<WechatBroadcast> {
    return this.queueSend(uuid, 'retry_requested');
  }

  private async queueSend(
    uuid: string,
    event: 'started' | 'retry_requested',
  ): Promise<WechatBroadcast> {
    const ctx = RequestContextStore.require();
    const { row, version } = await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('WeChat broadcast', uuid);
      if (found.status === 'done') {
        throw refuse('WECH_ALREADY_SENT', 'This broadcast was already sent.', HttpStatus.CONFLICT);
      }
      if (found.status === 'sending' && !(event === 'retry_requested' && staleSending(found))) {
        if (event === 'retry_requested') {
          throw refuse(
            'WECH_NOT_RETRYABLE',
            'This broadcast is still sending.',
            HttpStatus.CONFLICT,
          );
        }
        return { row: found, version: null };
      }
      if (event === 'retry_requested' && found.status === 'draft') {
        throw refuse('WECH_NOT_RETRYABLE', 'This broadcast has not failed.', HttpStatus.CONFLICT);
      }
      if (!(await this.availability.forOrg(tx, ctx.orgId)).available) {
        throw WechatAvailabilityService.refused();
      }
      const channel = await this.channels.findById(tx, ctx.orgId, found.channelRowId);
      if (!channel?.active) {
        throw refuse(
          'WECH_CHANNEL_UNAVAILABLE',
          'The WeChat channel for this broadcast is not connected/active.',
        );
      }
      const next = await this.repo.setStatus(tx, ctx.orgId, found.id, 'sending', {
        markStarted: true,
      });
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: found.id,
        action: 'update',
        delta: { status: { old: found.status, new: 'sending' } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: `wechat.broadcast.${event}`,
        payload: { uuid: found.uuid, audience: found.audience },
      });
      const fresh = await this.repo.findById(tx, ctx.orgId, found.id);
      return { row: fresh ?? found, version: next };
    });

    if (version !== null) await this.enqueue(ctx.orgId, row, version);
    return this.toResponse(row);
  }

  /** Any status, including sending: a job that is mid-run finds nothing afterwards and stops. */
  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const found = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
      if (!found) throw AppError.notFound('WeChat broadcast', uuid);
      await this.repo.remove(tx, ctx.orgId, found.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: found.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: found.id,
        eventType: 'wechat.broadcast.deleted',
        payload: { uuid: found.uuid, status: found.status },
      });
    });
  }

  /** The row version names the job, so a retry queues a fresh run instead of colliding with the earlier one. One attempt only: a mass send is never repeated by the queue. */
  private async enqueue(orgId: number, row: BroadcastRow, version: number): Promise<void> {
    try {
      await this.queue.add(
        'send',
        { orgId, broadcastId: row.id },
        { jobId: `${row.uuid}-${version}`, attempts: 1, removeOnComplete: 100, removeOnFail: 100 },
      );
    } catch (err) {
      // No job means nothing would ever send it: put it back so the operator can press Send again.
      this.logger.error({ orgId, broadcast: row.uuid, err }, 'could not queue wechat broadcast');
      await this.db.txAs({ orgId }, (tx) => this.repo.setStatus(tx, orgId, row.id, 'draft'));
      throw refuse(
        'WECH_CHANNEL_UNAVAILABLE',
        'The send queue is unavailable. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
