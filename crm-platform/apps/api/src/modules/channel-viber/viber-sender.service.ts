import { Inject, Injectable } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  VIBER_API,
  type ViberApiFactory,
  type ViberMessage,
  type ViberResult,
  type ViberSendData,
} from '../../infra/providers/channel-viber/viber.port';
import { senderObject } from './channel-rules';
import { ChannelsRepository } from './channels.repository';
import { fileMessage, pictureMessage, textMessage, videoMessage } from './viber-message';

export interface ThreadReply {
  /** The channel that carried the thread (the inbox channel's handle) and the Viber user. */
  channelRowId: number;
  userId: string;
  text: string;
  /** The file to send: a public address Viber will fetch, with what Viber needs to know about it. */
  media?: {
    kind: 'image' | 'video' | 'audio' | 'document';
    url: string;
    size: number;
    name: string;
  } | null;
}

export interface SendOutcome {
  ok: boolean;
  /** Viber's message token: the id a later `delivered` or `seen` carries. */
  providerMessageId: string | null;
  error: string | null;
}

/** The reason a reply gives when the channel is gone. */
export const CHANNEL_NOT_CONNECTED = 'Viber channel not connected';

/** Viber's status 6: the user never opened a chat with the account (Reference's wording). */
export const NOT_SUBSCRIBED_STATUS = 6;
export const NOT_SUBSCRIBED_MESSAGE =
  'The Viber user must open a chat with you before you can message them.';

const failed = (error: string): SendOutcome => ({ ok: false, providerMessageId: null, error });

/** A picture carries the text as its caption; any other file is its own message, with the text first as a message of its own. */
function messageFor(r: ThreadReply): { first: ViberMessage | null; main: ViberMessage } {
  const m = r.media;
  if (!m) return { first: null, main: textMessage(r.text !== '' ? r.text : ' ') };
  if (m.kind === 'image') return { first: null, main: pictureMessage(m.url, r.text) };
  const main =
    m.kind === 'video' ? videoMessage(m.url, m.size) : fileMessage(m.url, m.size, m.name);
  return { first: r.text !== '' ? textMessage(r.text) : null, main };
}

/**
 * A reply in a Viber thread (TW-VIB-008, 009), ported from Reference's `dispatchViber`. The team inbox calls this; it sends through the
 * channel that carried the thread (read from the thread's channel handle), so the customer sees the answer from the account they wrote to.
 * Never throws: a Viber refusal or a disconnected channel comes back as `ok = false` with the reason.
 */
@Injectable()
export class ViberSenderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ChannelsRepository,
    private readonly crypto: CryptoService,
    @Inject(VIBER_API) private readonly viber: ViberApiFactory,
  ) {}

  async reply(orgId: number, r: ThreadReply): Promise<SendOutcome> {
    const channel = await this.db.txAs({ orgId }, (tx) =>
      this.repo.findById(tx, orgId, r.channelRowId),
    );
    if (!channel) return failed(CHANNEL_NOT_CONNECTED);
    if (r.userId === '') return failed('Viber recipient missing');

    const api = this.viber.forToken(
      this.crypto.decrypt(channel.authToken),
      senderObject(channel.name, channel.avatar),
    );
    const { first, main } = messageFor(r);
    if (first) await api.sendMessage(r.userId, first);

    const res: ViberResult<ViberSendData> = await api.sendMessage(r.userId, main);
    if (!res.ok) {
      return failed(
        res.status === NOT_SUBSCRIBED_STATUS
          ? NOT_SUBSCRIBED_MESSAGE
          : (res.error ?? 'viber send failed'),
      );
    }
    const token = res.data?.message_token;
    return { ok: true, providerMessageId: token === undefined ? null : String(token), error: null };
  }
}
