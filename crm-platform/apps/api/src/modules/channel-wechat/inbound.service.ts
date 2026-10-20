import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { WECHAT_API, type WechatApi } from '../../infra/providers/channel-wechat/wechat.port';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { incrWithTtl } from '../../infra/redis/counter';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { ChatInboxIngest } from './chat-inbox-ingest';
import { WechatTokenService } from './wechat-token.service';
import {
  classify,
  decryptSafeMode,
  msgSignatureMatches,
  parseXml,
  signatureMatches,
  timestampFresh,
} from './wechat-rules';

/** The routing token is 48 alphanumerics; anything else is not ours and costs no lookup. */
const TOKEN_SHAPE = /^[A-Za-z0-9]{8,128}$/;

/** WeChat's own throttle in Reference was 240 requests a minute per address; the same cap per channel here stops a flood. */
const HITS_PER_MINUTE = 240;

/** The first message from a follower is where the nickname and photo are asked for, with a short timeout: they are optional. */
const PROFILE_TIMEOUT_MS = 5_000;

/** What the webhook answers: WeChat reads only the status and, for the handshake, the body. */
export interface Reply {
  status: number;
  body: string;
}
/** `success` tells WeChat "no passive reply": answers are sent afterwards as customer-service messages. */
const SUCCESS: Reply = { status: HttpStatus.OK, body: 'success' };
const FORBIDDEN: Reply = { status: HttpStatus.FORBIDDEN, body: '' };

export interface WechatQuery {
  signature?: string;
  msg_signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
}

/** An echostr is a short random string (a longer one is an encrypted one, still well under this). */
const ECHOSTR_MAX = 4096;

/**
 * The public WeChat webhook (WECH): one address per Official Account that answers both the URL check (GET) and the messages (POST).
 *
 * Every request proves itself with `signature` = sha1 of the sorted token, timestamp and nonce, on GET and POST alike. An account in
 * safe mode also encrypts the message (`<Encrypt>`, AES) and signs it a second time (`msg_signature`). WeChat redelivers anything that
 * is not answered within five seconds, so a good request is always answered `success` and a redelivered message is stored once (its
 * MsgId is the ledger key). The tenant is found through a narrow SECURITY DEFINER lookup; from there on everything runs under that
 * organization's context.
 */
@Injectable()
export class InboundService {
  private readonly logger = new Logger(InboundService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly crypto: CryptoService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(WECHAT_API) private readonly wechat: WechatApi,
    private readonly tokens: WechatTokenService,
    private readonly inbox: ChatInboxIngest,
  ) {}

  private async resolve(
    token: string,
  ): Promise<{ orgId: number; channel: ChannelRow } | undefined> {
    const found = await this.db.primary.execute(sql`SELECT * FROM wech_channel_lookup(${token})`);
    const hit = found.rows[0] as
      { channel_org_id: number | string; channel_row_id: number | string } | undefined;
    if (!hit) return undefined;
    const orgId = Number(hit.channel_org_id);
    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, Number(hit.channel_row_id)),
    );
    return channel ? { orgId, channel } : undefined;
  }

  /** GET: WeChat checks the address when the person saves it in the console. The echo is returned only for a valid signature. */
  async verify(token: string, q: WechatQuery): Promise<Reply> {
    if (!TOKEN_SHAPE.test(token)) return SUCCESS;
    await this.rateLimit(token);
    const hit = await this.resolve(token);
    if (!hit) return SUCCESS;
    const { channel } = hit;
    if (!timestampFresh(q.timestamp ?? '')) return this.refuse(channel);
    const secret = this.crypto.decrypt(channel.verifyToken);
    const echostr = (q.echostr ?? '').slice(0, ECHOSTR_MAX);
    const ts = q.timestamp ?? '';
    const nonce = q.nonce ?? '';

    // A safe-mode account sends the echo encrypted and signed with `msg_signature`: the plain text is what WeChat expects back.
    if (channel.encMode === 'safe' && channel.encodingAesKey && q.msg_signature) {
      if (!msgSignatureMatches(secret, q.msg_signature, ts, nonce, echostr))
        return this.refuse(channel);
      const plain = decryptSafeMode(
        this.crypto.decrypt(channel.encodingAesKey),
        echostr,
        channel.appId ?? '',
      );
      return plain === null ? this.refuse(channel) : { status: HttpStatus.OK, body: plain };
    }
    if (!signatureMatches(secret, q.signature ?? '', ts, nonce)) return this.refuse(channel);
    return { status: HttpStatus.OK, body: echostr };
  }

  private refuse(channel: ChannelRow): Reply {
    this.logger.warn({ channel: channel.id }, 'wechat inbound signature mismatch');
    return FORBIDDEN;
  }

  /** POST: one inbound message or event as XML. */
  async receive(token: string, q: WechatQuery, rawXml: string): Promise<Reply> {
    if (!TOKEN_SHAPE.test(token)) return SUCCESS;
    await this.rateLimit(token);
    const hit = await this.resolve(token);
    if (!hit) return SUCCESS;
    const { orgId, channel } = hit;

    const secret = this.crypto.decrypt(channel.verifyToken);
    const ts = q.timestamp ?? '';
    const nonce = q.nonce ?? '';
    if (!timestampFresh(ts) || !signatureMatches(secret, q.signature ?? '', ts, nonce)) {
      return this.refuse(channel);
    }
    if (!channel.active) return SUCCESS;

    let data = parseXml(rawXml);
    // A safe-mode account only ever sends encrypted packets: a plain one is not WeChat's and is not trusted.
    if (channel.encMode === 'safe' && !data.Encrypt) return SUCCESS;
    // Safe mode: the message is inside `<Encrypt>`, signed once more; only a valid one is decrypted.
    if (channel.encMode === 'safe' && data.Encrypt) {
      if (!msgSignatureMatches(secret, q.msg_signature ?? '', ts, nonce, data.Encrypt)) {
        return this.refuse(channel);
      }
      const inner = channel.encodingAesKey
        ? decryptSafeMode(
            this.crypto.decrypt(channel.encodingAesKey),
            data.Encrypt,
            channel.appId ?? '',
          )
        : null;
      if (inner === null) {
        this.logger.warn({ orgId, channel: channel.id }, 'wechat safe-mode decrypt failed');
        return SUCCESS;
      }
      data = parseXml(inner);
    }

    try {
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.touchInbound(tx, orgId, channel.id, data.ToUserName?.trim() || null),
      );
      await this.store(orgId, channel, data);
    } catch (err) {
      // WeChat must still get its answer: the failure is logged, not retried into a loop.
      this.logger.error({ err, orgId, channel: channel.id }, 'wechat ingest failed');
    }
    return SUCCESS;
  }

  /** Writes a message or a follow into the inbox. An unfollow and the events nobody reads are acknowledged and nothing more (Reference). */
  private async store(
    orgId: number,
    channel: ChannelRow,
    data: Record<string, string>,
  ): Promise<void> {
    const inbound = classify(data);
    if (!inbound) return;
    if (inbound.kind === 'unsubscribe') {
      this.logger.log({ orgId, channel: channel.id }, 'wechat unsubscribe');
      return;
    }
    if (inbound.kind === 'ignored') return;

    const recorded = await this.inbox.recordInbound(orgId, channel, inbound);
    // A redelivered message is stored once.
    if (!recorded.stored) return;

    if (recorded.newThread) {
      // The nickname and photo come after the answer's work is done; WeChat's 2021 privacy change often leaves them empty.
      void this.learnProfile(orgId, channel, inbound.openid, recorded).catch(() => undefined);
    }
  }

  private async learnProfile(
    orgId: number,
    channel: ChannelRow,
    openid: string,
    recorded: { conversationId: number; contactId: number | null },
  ): Promise<void> {
    const res = await Promise.race([
      this.tokens.call(orgId, channel.id, (t) => this.wechat.getUserInfo(t, openid)),
      new Promise<null>((r) => setTimeout(() => r(null), PROFILE_TIMEOUT_MS)),
    ]);
    if (!res?.ok) return;
    await this.inbox.setProfile(orgId, recorded.conversationId, recorded.contactId, {
      nickname: res.data.nickname?.trim() || null,
      avatarUrl: res.data.headimgurl?.trim() || null,
    });
  }

  private async rateLimit(token: string): Promise<void> {
    try {
      const key = `wechat_hits:${token}:${Math.floor(Date.now() / 60_000)}`;
      const n = await incrWithTtl(this.redis, key, 120);
      if (n > HITS_PER_MINUTE) {
        throw new AppError(
          ERROR_CODES.RATE_LIMITED,
          'Too many requests',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      // Redis down: the webhook keeps working, unthrottled.
    }
  }
}
