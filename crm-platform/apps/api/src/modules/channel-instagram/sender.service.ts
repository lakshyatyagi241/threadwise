import { Inject, Injectable } from '@nestjs/common';
import {
  INSTAGRAM_BRIDGE,
  type InstagramBridgeFactory,
} from '../../infra/providers/channel-instagram/instagram-bridge.port';
import { EngineConnectionService } from '../addons-extension-registry';
import { INSTAGRAM_MEDIA_URLS, type MediaUrls } from './_shims/tokens';
import {
  engineThreadId,
  noEngineThread,
  notConnected,
  sendFailure,
  shapeReply,
} from './reply-rules';

export interface ThreadReply {
  /** The thread key, `ig:<engine conversation id>`. */
  rawJid: string | null;
  text: string;
  /** A stored file path (ours) or an absolute address, with the inbox's media type. */
  media?: { type: string | null; path: string } | null;
  /** The template's buttons, as the inbox keeps them (`{text|title, value|url, type}`). */
  buttons?: readonly unknown[];
}

export interface SendOutcome {
  ok: boolean;
  /** The engine's message id; stored on the inbox row so the pull never shows our own send twice. */
  providerMessageId: string | null;
  error: string | null;
}

const failed = (error: string): SendOutcome => ({ ok: false, providerMessageId: null, error });

/**
 * A reply in an Instagram thread (WD-IG-010). The team inbox calls this for a message whose provider is `instagram`; the engine does
 * the Graph send. Never throws: a refusal, a thread with no engine id or an engine that is off comes back as `ok = false` with the
 * reason in words. Instagram's own 24 hour rule is enforced by the engine and shown as its error.
 */
@Injectable()
export class SenderService {
  constructor(
    private readonly engines: EngineConnectionService,
    @Inject(INSTAGRAM_BRIDGE) private readonly bridge: InstagramBridgeFactory,
    @Inject(INSTAGRAM_MEDIA_URLS) private readonly media: MediaUrls,
  ) {}

  async reply(r: ThreadReply): Promise<SendOutcome> {
    const conn = await this.engines.connection('instagram');
    const threadId = engineThreadId(r.rawJid);
    if (threadId === '') return failed(noEngineThread(conn.brand));
    if (conn.url === '' || conn.secret === '') return failed(notConnected(conn.brand));

    let media: { type: string | null; url: string } | null = null;
    if (r.media) {
      const url = this.media.publicUrl(r.media.path);
      if (url === null)
        return failed('That attachment has no public address the engine can fetch.');
      media = { type: r.media.type, url };
    }

    try {
      const res = await this.bridge
        .with(conn)
        .reply(threadId, shapeReply({ text: r.text, media, buttons: r.buttons }));
      if (res.ok) return { ok: true, providerMessageId: res.data.messageId, error: null };
      return failed(sendFailure(conn.brand, res.status, res.error));
    } catch (err) {
      return failed(sendFailure(conn.brand, null, (err as Error).message));
    }
  }
}
