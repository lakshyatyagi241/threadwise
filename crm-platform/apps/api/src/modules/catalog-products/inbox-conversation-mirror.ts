import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { formatProductMoney } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  CONVERSATIONS_FACADE,
  normalizePeerKey,
  type ConversationsFacade,
} from '../chat-conversations';
import type { CatalogSendMirrorInput, ConversationMirror } from './_shims/tokens';

/** The channel kind WhatsApp numbers are connected as in the conversation core. */
const WHATSAPP_CHANNEL_KIND = 'whatsapp_cloud';

/**
 * What the thread shows when the operator typed no message: the first product, how many there are, or the link. Reference wrote an
 * empty body and let the inbox draw the tiles; here the body is never blank so the thread preview and any client that does not
 * know the catalog bubble still say what was sent (recorded as intended in the parity file).
 */
export function catalogMirrorBody(
  input: Pick<CatalogSendMirrorInput, 'mode' | 'body' | 'products'>,
): string {
  const typed = (input.body ?? '').trim();
  if (typed !== '') return typed;
  if (input.mode === 'link') return 'Catalog link';
  const [first] = input.products;
  if (!first) return 'Catalog';
  return input.mode === 'spm' || input.products.length === 1
    ? first.name
    : `${first.name} and ${input.products.length - 1} more`;
}

/**
 * Shows a catalog message in the recipient's inbox thread (TW-CAT-015 rule 13, TW-CAT-023, TW-CAT-031): the thread of that number
 * on a WhatsApp channel, created on the first connected WhatsApp channel when the number has none (Reference's find-or-create), an
 * outbound message from the sending user with the catalog summary in `meta`.
 *
 * It goes through the conversation core's own recorder (`ConversationsFacade.recordOutbound`: find-or-create under the thread lock,
 * seq, ledger idempotency by the provider's message id, lifecycle events, realtime), then marks the stored row as the catalog
 * bubble. ARCHITECTURE-FORCED DIFFERENCE: `messages.kind` has no `catalog` value (a CHECK the chat domain owns), so the row is
 * `kind = interactive` with `meta.type = 'catalog'`, `meta.mode` and the product summaries in `meta.products`.
 *
 * Called after the provider accepted the message, outside any transaction, and it never throws: a mirror problem must not turn a
 * delivered message into a failed send (the send log, `cat_catalog_sends`, is written regardless). No channel to mirror on is not
 * an error: a workspace that sends only through a bridge session has no thread to show it in.
 */
@Injectable()
export class InboxConversationMirror implements ConversationMirror {
  private readonly logger = new Logger(InboxConversationMirror.name);

  constructor(
    private readonly db: DatabaseService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async mirrorCatalogSend(input: CatalogSendMirrorInput): Promise<void> {
    try {
      const peerKey = normalizePeerKey(WHATSAPP_CHANNEL_KIND, input.recipientDigits);
      if (!peerKey) return;
      const channelId = await this.channelFor(input.orgId, peerKey);
      if (!channelId) return;

      const run = async () => {
        const body = catalogMirrorBody(input);
        const done = await this.conversations.recordOutbound({
          channelId,
          peerKey,
          source: 'catalog',
          body,
          ...(input.messageId ? { providerMessageId: input.messageId } : {}),
        });
        await this.markAsCatalog(input, done.messageId);
      };
      // The sender's own request context is there for an HTTP send; a caller without one (a job) gets a system one.
      if (RequestContextStore.peek()?.orgId === input.orgId) await run();
      else
        await RequestContextStore.run(
          {
            requestId: randomUUID(),
            orgId: input.orgId,
            actorType: 'system',
            actorId: null,
            userId: input.userId,
          },
          run,
        );
    } catch (err) {
      this.logger.warn(
        { orgId: input.orgId, err: err instanceof Error ? err.message : 'failed' },
        'catalog inbox mirror failed',
      );
    }
  }

  /**
   * The channel the number's thread lives on: the WhatsApp channel that already has a thread with this peer (a connected one
   * first), else the oldest connected WhatsApp channel, else none. Returns the channel's uuid, which is what the facade takes.
   */
  private channelFor(orgId: number, peerKey: string): Promise<string | null> {
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const existing = (
        await tx.execute(sql`
          SELECT ch.uuid FROM conversations c
          JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
          WHERE c.org_id = ${orgId} AND c.peer_key = ${peerKey} AND ch.kind = ${WHATSAPP_CHANNEL_KIND}
          ORDER BY (ch.status = 'connected') DESC, c.last_message_at DESC NULLS LAST, c.id
          LIMIT 1`)
      ).rows[0] as { uuid: string } | undefined;
      if (existing) return existing.uuid;
      const first = (
        await tx.execute(sql`
          SELECT uuid FROM channels
          WHERE org_id = ${orgId} AND kind = ${WHATSAPP_CHANNEL_KIND} AND status = 'connected'
          ORDER BY id LIMIT 1`)
      ).rows[0] as { uuid: string } | undefined;
      return first?.uuid ?? null;
    });
  }

  /** Turns the stored text row into the catalog bubble: kind, who sent it, and what was sent. */
  private async markAsCatalog(input: CatalogSendMirrorInput, messageUuid: string): Promise<void> {
    const share = input.source === 'product_share';
    const meta = {
      // A product share is a plain message (image URL and caption); only a catalog send is the catalog bubble.
      ...(share ? { source: 'product_share' } : { type: 'catalog', mode: input.mode }),
      provider: input.provider,
      ...(input.messageId ? { wa_message_id: input.messageId } : {}),
      products: input.products.map((p) => ({
        id: p.id,
        name: p.name,
        image_url: p.imageUrl,
        price_minor: p.priceMinor,
        currency: p.currency,
        price_display: formatProductMoney(p.priceMinor, p.currency),
        retailer_id: p.retailerId,
      })),
    };
    await this.db.txAs({ orgId: input.orgId, userId: input.userId }, async (tx) => {
      await tx.execute(sql`
        UPDATE messages
           SET kind = ${share ? 'text' : 'interactive'},
               sender_kind = ${input.userId === null ? 'system' : 'agent'},
               sender_user_id = ${input.userId},
               meta = meta || ${JSON.stringify(meta)}::jsonb
         WHERE org_id = ${input.orgId} AND uuid = ${messageUuid}::uuid`);
    });
  }
}
