import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
  type GraphResult,
} from '../../infra/providers/channel-facebook/facebook.port';
import { MEDIA_URLS, type MediaUrls } from './_shims/tokens';
import {
  TOKEN_INVALID_MESSAGE,
  attachmentType,
  clipError,
  isTokenError,
  parseThreadKey,
} from './page-rules';
import { PagesRepository } from './pages.repository';

export interface ThreadReply {
  /** The thread key: `fb:<page>:<psid>` or `fb:<page>:post:<post>:<commenter>`. */
  rawJid: string;
  text: string;
  /** A stored file path (ours) or an absolute address, with the inbox's media type. */
  media?: { type: string | null; path: string } | null;
}

export interface SendOutcome {
  ok: boolean;
  providerMessageId: string | null;
  error: string | null;
}

const failed = (error: string): SendOutcome => ({ ok: false, providerMessageId: null, error });

/**
 * A reply in a Facebook thread (WD-FB-011). The team inbox calls this; the thread key names the Page and the person or post, so the
 * answer goes out through the Page the customer wrote to. A comment thread is answered in public under the latest comment of that
 * thread. Never throws: a refusal or a disconnected Page comes back as `ok = false` with the reason, and a refused token flags the
 * Page for reconnecting.
 */
@Injectable()
export class SenderService {
  constructor(
    private readonly db: DatabaseService,
    private readonly pages: PagesRepository,
    private readonly crypto: CryptoService,
    @Inject(FACEBOOK_GRAPH) private readonly graph: FacebookGraphFactory,
    @Inject(MEDIA_URLS) private readonly media: MediaUrls,
  ) {}

  async reply(orgId: number, r: ThreadReply): Promise<SendOutcome> {
    const target = parseThreadKey(r.rawJid);
    if (!target) return failed('Not a Facebook thread.');

    const page = await this.db.txAs({ orgId }, (tx) =>
      this.pages.findByPageId(tx, orgId, target.pageId),
    );
    if (!page || page.status !== 'connected') return failed('Facebook Page not connected');
    const api = this.graph.forPage(this.crypto.decrypt(page.accessToken ?? ''), page.pageId);

    const done = async <T>(res: GraphResult<T>, idOf: (d: T) => string): Promise<SendOutcome> => {
      if (res.ok)
        return {
          ok: true,
          providerMessageId: res.data ? idOf(res.data) || null : null,
          error: null,
        };
      if (isTokenError(res.code)) {
        await this.db.txAs({ orgId }, (tx) =>
          this.pages.markExpired(tx, orgId, page.id, clipError(res.error) ?? TOKEN_INVALID_MESSAGE),
        );
      }
      return failed(res.error ?? 'Facebook rejected the send.');
    };

    if (target.kind === 'comment') {
      // The latest comment in this thread, so the reply lands under that person's words; the post itself is the fallback.
      const latest = await this.latestCommentId(orgId, r.rawJid);
      return done(await api.replyComment(latest ?? target.postId, r.text), (d) => d.id);
    }

    if (r.media) {
      const url = this.media.publicUrl(r.media.path);
      if (!url) return failed('The file could not be reached.');
      const sent = await api.sendAttachment(target.psid, attachmentType(r.media.type), url);
      // Messenger cannot carry a file and text in one message: the text follows as its own bubble.
      if (sent.ok && r.text.trim() !== '') await api.sendText(target.psid, r.text);
      return done(sent, (d) => d.messageId);
    }
    return done(await api.sendText(target.psid, r.text), (d) => d.messageId);
  }

  private async latestCommentId(orgId: number, rawJid: string): Promise<string | null> {
    const res = await this.db.txAs({ orgId }, (tx) =>
      tx.execute(sql`
        SELECT m.meta -> 'facebook' ->> 'comment_id' AS comment_id
        FROM messages m JOIN conversations c ON c.org_id = m.org_id AND c.id = m.conversation_id
        WHERE c.org_id = ${orgId} AND c.channel = 'facebook' AND c.raw_jid = ${rawJid} AND m.direction = 'in'
        ORDER BY m.id DESC LIMIT 1`),
    );
    const id = (res.rows[0] as { comment_id: string | null } | undefined)?.comment_id;
    return id ? id : null;
  }
}
