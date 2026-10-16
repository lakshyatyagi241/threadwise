import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  WECHAT_API,
  WECHAT_TEXT_LIMIT,
  type WechatApi,
  type WechatMessage,
  type WechatResult,
} from '../../infra/providers/channel-wechat/wechat.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { QUEUES } from '../../infra/queue/queues';
import { WECHAT_LIST_MIN, type ConsentGateReason } from '@crm/contracts';
import { SendWindowService, scheduleWake } from '../compliance-center';
import { ConsentGate, consentSkipNote, countSkipReasons, gateRecipients } from '../contact-consent';
import type { WechatBroadcastJob } from './broadcasts.service';
import {
  BroadcastsRepository,
  type BroadcastRow,
  type RecipientRow,
} from './broadcasts.repository';
import { ChannelsRepository } from './channels.repository';
import { ChatInboxIngest } from './chat-inbox-ingest';
import { WechatTokenService } from './wechat-token.service';
import { clipError, clipText, tagIdOf } from './wechat-rules';

export type RunResult = 'skipped' | 'done' | 'failed' | 'held';

/** WeChat's answer to a mass send whose `clientmsgid` it has already accepted: the earlier call went through. */
const DUPLICATE_CLIENT_MSG_ID = 45065;

/** Longer than a mass send takes (WeChat answers in seconds), shorter than the 15 minutes after which a stuck send may be retried. */
const RUN_LOCK_SECONDS = 300;
const RELEASE_IF_OWNER =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

const NOT_CONNECTED = 'The WeChat channel for this broadcast is not connected/active.';

/**
 * Sends one WeChat broadcast, run by the `wechat-broadcast` worker job. The whole broadcast is ONE mass-send call (every follower, a tag,
 * or the picked OpenIDs), so there is no batch loop: the call is made once and the broadcast ends `done` (with WeChat's `msg_id`) or
 * `failed` (with WeChat's reason, ready for a retry). Only a list audience has recipients to mark sent and a thread to copy the text into.
 *
 * Consent (BL-141): every run asks the ConsentGate (purpose marketing, channel wechat) before the call. A picked list is screened person
 * by person: whoever the gate refuses is left out of the call and kept `blocked` with `Not messaged: consent (<reason>)`, and the rest is
 * sent (a list send needs two people, so with fewer left the broadcast fails with the reason and can be retried). A send to ALL followers
 * or to a TAG is resolved by WeChat, so a person cannot be left out of it: it is refused when the workspace requires a recorded consent
 * (nobody the account has never met can have one), or when any follower the account already knows is refused by the gate. The message
 * says so and points to the picked list.
 *
 * Quiet hours (BL-191): a mass send is one call to people WeChat resolves, so it cannot be split per contact. The whole broadcast is read
 * on the workspace's own clock (the zone chosen in Compliance center, else the workspace's): inside the quiet hours it stays `sending`
 * with `held_until`, and a delayed job makes the call at the opening. The `clientmsgid` guard is untouched.
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
    private readonly sendWindow: SendWindowService,
    private readonly gate: ConsentGate,
    @InjectQueue(QUEUES.WECHAT_BROADCAST) private readonly queue: Queue<WechatBroadcastJob>,
    @Inject(WECHAT_API) private readonly wechat: WechatApi,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * One run at a time per broadcast: a retry queued for a send that looked stuck must not make a second mass-send call while the first
   * job is still alive (a mass send spends the account's monthly allowance). Redis down: the run goes ahead, the `clientmsgid` still guards it.
   */
  async run(orgId: number, broadcastId: number): Promise<RunResult> {
    const key = `wechat:bcast:${orgId}:${broadcastId}`;
    const owner = randomUUID();
    const got = await this.redis.set(key, owner, 'EX', RUN_LOCK_SECONDS, 'NX').catch(() => 'OK');
    if (got !== 'OK') return 'skipped';
    try {
      return await this.runLocked(orgId, broadcastId);
    } finally {
      await this.redis.eval(RELEASE_IF_OWNER, 1, key, owner).catch(() => undefined);
    }
  }

  private async runLocked(orgId: number, broadcastId: number): Promise<RunResult> {
    const broadcast = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, broadcastId),
    );
    if (!broadcast || broadcast.status !== 'sending') return 'skipped';

    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.channels.findById(tx, orgId, broadcast.channelRowId),
    );
    if (!channel?.active) return this.fail(orgId, broadcast.id, NOT_CONNECTED);

    // Consent first (BL-141): a person the gate refuses is never merely held for the hours.
    const screen = await this.screen(orgId, broadcast);
    if (screen.refusal !== null) return this.fail(orgId, broadcast.id, screen.refusal);

    // Held, not denied: the call is made when the hours open. A mass send is marketing by nature.
    const window = await this.sendWindow.check(orgId, 'message', {});
    if (window.decision === 'hold') {
      await this.db.txAs({ orgId }, (tx) => this.repo.setHeld(tx, orgId, broadcast.id, window));
      await scheduleWake(
        this.queue,
        'send',
        { orgId, broadcastId: broadcast.id },
        broadcast.uuid,
        new Date(window.until),
        (err) =>
          this.logger.error(
            { orgId, broadcast: broadcast.uuid, err },
            'could not queue the wake-up of a WeChat broadcast held for the quiet hours',
          ),
        this.sendWindow.now(),
      );
      this.logger.log(
        { orgId, broadcast: broadcast.uuid, resumeAt: window.until },
        '[WECH] broadcast waits: held for the quiet hours',
      );
      return 'held';
    }
    if (broadcast.heldUntil !== null) {
      await this.db.txAs({ orgId }, (tx) => this.repo.setHeld(tx, orgId, broadcast.id, null));
    }

    const body = broadcast.body ? this.crypto.decrypt(broadcast.body) : '';
    const message: WechatMessage = {
      msgtype: 'text',
      text: { content: clipText(body, WECHAT_TEXT_LIMIT) },
    };

    const res = await this.massSend(orgId, broadcast, message, screen.openids);
    if (!res.ok && res.errcode !== DUPLICATE_CLIENT_MSG_ID) {
      return this.fail(orgId, broadcast.id, res.error ?? 'mass send failed');
    }

    const massMsgId = res.data.msg_id !== undefined ? String(res.data.msg_id) : null;
    // The people the call reached: for a picked list, whoever the consent check let through.
    const recipients = screen.recipients;
    await this.db.txAs({ orgId }, (tx) =>
      this.repo.markDone(
        tx,
        orgId,
        broadcast.id,
        massMsgId,
        broadcast.audience === 'list' ? recipients.map((r) => r.id) : undefined,
      ),
    );

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

  /**
   * The consent check of a run (BL-141). For a picked list: who may be messaged (`recipients`, `openids`), with the refused ones already
   * recorded `blocked`. For all followers or a tag: nothing to pick, only a `refusal` when the audience cannot be left clean.
   */
  private async screen(
    orgId: number,
    b: BroadcastRow,
  ): Promise<{ refusal: string | null; recipients: RecipientRow[]; openids: string[] }> {
    if (b.audience === 'list') return this.screenList(orgId, b);
    return { refusal: await this.screenOpenAudience(orgId, b), recipients: [], openids: [] };
  }

  private async screenList(
    orgId: number,
    b: BroadcastRow,
  ): Promise<{ refusal: string | null; recipients: RecipientRow[]; openids: string[] }> {
    const rows = await this.db.txAs({ orgId }, (tx) => this.repo.recipients(tx, orgId, b.id));
    const gated = await gateRecipients(this.gate, orgId, rows, 'wechat');
    if (gated.skipped.length > 0) {
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.markBlocked(
          tx,
          orgId,
          gated.skipped.map((s) => ({ id: s.row.id, note: consentSkipNote(s.reason) })),
        ),
      );
    }
    if (gated.go.length < WECHAT_LIST_MIN) {
      return {
        refusal: `Not sent: only ${gated.go.length} of ${rows.length} recipients can be messaged (consent: ${reasonList(gated.skipped.map((s) => s.reason))}); a WeChat list send needs ${WECHAT_LIST_MIN}.`,
        recipients: [],
        openids: [],
      };
    }
    return { refusal: null, recipients: gated.go, openids: gated.go.map((r) => r.openid) };
  }

  private async screenOpenAudience(orgId: number, b: BroadcastRow): Promise<string | null> {
    const what = b.audience === 'all' ? 'all followers' : 'a tag';
    // Nobody the account has never met can have a recorded consent: with the switch on, the call cannot be shown to be clean.
    const unknown = await this.gate.check(
      orgId,
      { type: 'anonymous' },
      'wechat',
      'marketing_messaging',
    );
    if (unknown.decision !== 'allow') {
      return `Not sent: consent (${unknown.reason}). A send to ${what} reaches people this workspace has no consent record for. Send to a picked list instead.`;
    }
    // The people the account knows: if the gate refuses any of them, WeChat would still message them.
    const ids = await this.db.txAs({ orgId }, (tx) =>
      this.repo.knownContactIds(tx, orgId, b.channelRowId),
    );
    if (ids.length === 0) return null;
    const verdict = await this.gate.checkMany(orgId, ids, 'wechat', 'marketing_messaging');
    const refused = [...verdict.decisions.values()].filter((d) => d.decision !== 'allow');
    if (refused.length === 0) return null;
    return `Not sent: ${refused.length} of ${ids.length} known followers cannot be messaged (consent: ${reasonList(refused.map((d) => d.reason))}) and a send to ${what} cannot leave them out. Send to a picked list instead.`;
  }

  private massSend(
    orgId: number,
    b: BroadcastRow,
    message: WechatMessage,
    openids: readonly string[],
  ): Promise<WechatResult<{ msg_id?: number | string }>> {
    // The broadcast's own id is WeChat's `clientmsgid`: the same broadcast sent twice is one mass send.
    if (b.audience === 'list') {
      return this.tokens.call(orgId, b.channelRowId, (token) =>
        this.wechat.massSend(token, [...openids], message, b.uuid),
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

/** `withdrawn 2, no_consent_recorded 1`: the gate's reason codes with how many each, for a message that has to stay short. */
function reasonList(reasons: readonly ConsentGateReason[]): string {
  return countSkipReasons(reasons.map((reason) => ({ reason })))
    .map((r) => `${r.reason} ${r.count}`)
    .join(', ');
}
