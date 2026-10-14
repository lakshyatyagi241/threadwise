import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WECHAT_API,
  WECHAT_TEXT_LIMIT,
  type WechatApi,
  type WechatMessage,
  type WechatResult,
} from '../../infra/providers/channel-wechat/wechat.port';
import { BroadcastsRepository, type BroadcastRow } from './broadcasts.repository';
import { ChannelsRepository } from './channels.repository';
import { ChatInboxIngest } from './chat-inbox-ingest';
import { WechatTokenService } from './wechat-token.service';
import { clipError, clipText, tagIdOf } from './wechat-rules';

export type RunResult = 'skipped' | 'done' | 'failed';

/** WeChat's answer to a mass send whose `clientmsgid` it has already accepted: the earlier call went through. */
const DUPLICATE_CLIENT_MSG_ID = 45065;

const NOT_CONNECTED = 'The WeChat channel for this broadcast is not connected/active.';

/**
 * Sends one WeChat broadcast, run by the `wechat-broadcast` worker job. The whole broadcast is ONE mass-send call (every follower, a tag,
 * or the picked OpenIDs), so there is no batch loop: the call is made once and the broadcast ends `done` (with WeChat's `msg_id`) or
 * `failed` (with WeChat's reason, ready for a retry). Only a list audience has recipients to mark sent and a thread to copy the text into.
 */
@Injectable()
export class BroadcastSenderService {
  private readonly logger = new Logger(BroadcastSenderService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: BroadcastsRepository,
    private readonly channels: ChannelsRepository,
    private readonly crypto: CryptoService,
    private readonly tokens: WechatTokenService,
    private readonly inbox: ChatInboxIngest,
    @Inject(WECHAT_API) private readonly wechat: WechatApi,
  ) {}

  async run(orgId: number, broadcastId: number): Promise<RunResult> {
    const broadcast = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, broadcastId),
    );
    if (!broadcast || broadcast.status !== 'sending') return 'skipped';

    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.channels.findById(tx, orgId, broadcast.channelRowId),
    );
    if (!channel?.active) return this.fail(orgId, broadcast.id, NOT_CONNECTED);

    const body = broadcast.body ? this.crypto.decrypt(broadcast.body) : '';
    const message: WechatMessage = {
      msgtype: 'text',
      text: { content: clipText(body, WECHAT_TEXT_LIMIT) },
    };

    const res = await this.massSend(orgId, broadcast, message);
    if (!res.ok && res.errcode !== DUPLICATE_CLIENT_MSG_ID) {
      return this.fail(orgId, broadcast.id, res.error ?? 'mass send failed');
    }

    const massMsgId = res.data.msg_id !== undefined ? String(res.data.msg_id) : null;
    const recipients = await this.db.txAs({ orgId }, async (tx) => {
      const rows =
        broadcast.audience === 'list' ? await this.repo.recipients(tx, orgId, broadcast.id) : [];
      await this.repo.markDone(tx, orgId, broadcast.id, massMsgId);
      return rows;
    });

    // The copy in each follower's thread. A failure to copy never fails the send (Reference).
    for (const r of recipients) {
      if (r.conversationId === null) continue;
      const conversationId = r.conversationId;
      try {
        await this.db.txAs({ orgId }, (tx) =>
          this.inbox.recordOutbound(tx, orgId, conversationId, { body }),
        );
      } catch (err) {
        this.logger.warn({ orgId, broadcast: broadcast.uuid, err }, 'broadcast mirror failed');
      }
    }
    return 'done';
  }

  private massSend(
    orgId: number,
    b: BroadcastRow,
    message: WechatMessage,
  ): Promise<WechatResult<{ msg_id?: number | string }>> {
    // The broadcast's own id is WeChat's `clientmsgid`: the same broadcast sent twice is one mass send.
    if (b.audience === 'list') {
      return this.db
        .txAs({ orgId }, (tx) => this.repo.recipients(tx, orgId, b.id))
        .then((rows) =>
          this.tokens.call(orgId, b.channelRowId, (token) =>
            this.wechat.massSend(
              token,
              rows.map((r) => r.openid),
              message,
              b.uuid,
            ),
          ),
        );
    }
    const filter =
      b.audience === 'all'
        ? ({ is_to_all: true } as const)
        : ({ is_to_all: false, tag_id: tagIdOf(b.tagId) } as const);
    return this.tokens.call(orgId, b.channelRowId, (token) =>
      this.wechat.massSendAll(token, filter, message, b.uuid),
    );
  }

  private async fail(orgId: number, id: number, reason: string): Promise<RunResult> {
    await this.db.txAs({ orgId }, (tx) =>
      this.repo.setStatus(tx, orgId, id, 'failed', { lastError: clipError(reason) }),
    );
    return 'failed';
  }
}
