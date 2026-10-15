import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  LINE_API,
  type LineApiFactory,
  type LineResult,
  type LineSent,
} from '../../infra/providers/channel-line/line.port';
import { ChannelsRepository } from './channels.repository';
import { LineTokenService } from './line-token.service';
import { replyMessages } from './message-builders';
import { ReplyTokensRepository } from './reply-tokens.repository';

export interface ThreadReply {
  /** The channel that carried the thread (the inbox channel's handle) and the LINE user (or group, or room) id. */
  channelRowId: number;
  to: string;
  text: string;
  /** The file to send: a public address LINE fetches itself. */
  media?: { url: string; kind: 'image' | 'video' | 'audio' | 'document' | 'sticker' } | null;
}

export interface Outcome {
  ok: boolean;
  providerMessageId: string | null;
  error: string | null;
  /** The HTTP status LINE answered with, 0 when nothing came back. */
  status: number;
}

/** The reason a reply gives when the channel is gone. */
export const CHANNEL_NOT_CONNECTED = 'LINE channel not connected';

const failed = (error: string, status = 0): Outcome => ({
  ok: false,
  providerMessageId: null,
  error,
  status,
});

const outcomeOf = (res: LineResult<LineSent>): Outcome =>
  res.ok
    ? {
        ok: true,
        providerMessageId: res.data?.sentMessages?.[0]?.id ?? null,
        error: null,
        status: res.status,
      }
    : failed(res.error ?? 'LINE rejected the send.', res.status);

/**
 * A reply in a LINE thread. The team inbox calls this; it sends through the channel that carried the thread, so the customer sees the
 * answer from the account they wrote to. It prefers the free reply path (the reply token of the person's latest message, while it is
 * fresh) and pushes otherwise; a reply token LINE no longer accepts falls back to a push. Never throws: a LINE refusal or a removed
 * channel comes back as `ok = false` with the reason.
 */
@Injectable()
export class LineSenderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly channels: ChannelsRepository,
    private readonly tokens: LineTokenService,
    private readonly replyTokens: ReplyTokensRepository,
    @Inject(LINE_API) private readonly line: LineApiFactory,
  ) {}

  async reply(orgId: number, r: ThreadReply): Promise<Outcome> {
    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.channels.findById(tx, orgId, r.channelRowId),
    );
    if (!channel) return failed(CHANNEL_NOT_CONNECTED);
    if (r.to === '') return failed('LINE recipient missing');

    const messages = replyMessages(r.text, r.media ?? null);
    const api = this.line.forToken(await this.tokens.accessToken(orgId, channel));

    const replyToken = await this.db.txAs({ orgId }, (tx) =>
      this.replyTokens.takeFresh(tx, orgId, channel.id, r.to),
    );
    if (replyToken) {
      const viaReply = outcomeOf(await api.reply(replyToken, messages));
      if (viaReply.ok) return viaReply;
    }
    return outcomeOf(await api.push(r.to, messages));
  }
}
