import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import type { InboundMedia, NormalisedInbound } from '../../../infra/providers/chat-conversations';
import {
  CONVERSATIONS_FACADE,
  ExternalChannelIngest,
  type ConversationsFacade,
} from '../../chat-conversations';
import { ContactsService } from '../../crm';
import type { InboundInput, InboundRecorded, InboxIngest } from './tokens';

/** The placeholder a thread carries until Meta tells us a real name. */
export const PLACEHOLDER_NAME = 'Facebook user';

/** The channel kind a Page's threads live on. */
export const FACEBOOK_KIND = 'facebook';

const NOT_STORED: InboundRecorded = {
  stored: false,
  conversationId: 0,
  contactId: null,
  newThread: false,
};

const MEDIA_DEFAULT_MIME: Record<InboundMedia['mediaKind'], string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

/** Messenger names an attachment `image`, `video`, `audio` or `file`; the inbox has no `file`, it is a document. */
function mediaKindOf(type: string | null): InboundMedia['mediaKind'] {
  return type === 'image' || type === 'video' || type === 'audio' ? type : 'document';
}

/**
 * The Facebook side of the inbox, over chat-conversations. A Page is one `facebook` channel (created on its first message, kept in
 * step by `syncPage`); a Messenger conversation or a post-and-commenter pair is one thread on it, keyed by the thread key, so the
 * unique key `(workspace, channel, peer)` does the finding and creating that the old SQL did by hand. A message goes through the
 * shared pipeline (ledger dedup on Meta's id, gap-free sequence, unread, 24 hour window, realtime).
 *
 * Still ours, because the inbox cannot know it: a DM sender becomes a lead keyed by the Messenger id (no phone), as in Reference. A
 * commenter never does (TW-FB-009 rule 6).
 */
@Injectable()
export class ChatInboxIngest implements InboxIngest {
  constructor(
    private readonly db: DatabaseService,
    private readonly external: ExternalChannelIngest,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
    private readonly contacts: ContactsService,
  ) {}

  /** Keeps the Page's inbox channel in step with the Page (connected or not). */
  syncPage(
    orgId: number,
    page: { pageId: string; name: string; connected: boolean },
  ): Promise<string> {
    return this.external.sync(
      orgId,
      { kind: FACEBOOK_KIND, externalId: page.pageId, name: page.name, displayAddress: null },
      page.connected,
    );
  }

  async recordInbound(orgId: number, m: InboundInput): Promise<InboundRecorded> {
    const message: NormalisedInbound = {
      providerMessageId: m.dedup,
      peerKey: m.rawJid,
      ...(m.title !== PLACEHOLDER_NAME ? { peerName: m.title } : {}),
      kind: m.mediaUrl ? 'media' : 'text',
      ...(m.body !== '' ? { body: m.body } : {}),
      ...(m.mediaUrl
        ? {
            media: {
              // The address Meta gave; the adapter downloads it, after the host check.
              providerMediaId: m.mediaUrl,
              mediaKind: mediaKindOf(m.mediaType),
              mime: MEDIA_DEFAULT_MIME[mediaKindOf(m.mediaType)],
            },
          }
        : {}),
      providerTimestamp: m.at ?? new Date(),
    };
    const out = await this.external.inbound(
      orgId,
      {
        kind: FACEBOOK_KIND,
        externalId: m.pageId,
        name: m.pageName,
        displayAddress: null,
      },
      message,
    );
    if (out.outcome !== 'stored') return NOT_STORED;
    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${out.conversationUuid}::uuid`,
      );
      const conv = res.rows[0] as
        { id: number | string; contact_id: number | string | null } | undefined;
      if (!conv) return NOT_STORED;
      const conversationId = Number(conv.id);
      let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
      if (m.kind === 'dm' && m.senderId !== '') {
        // Through the contacts service: audit and the plan's contact cap apply, and no consent is granted by a first message. Over the
        // cap the thread simply has no contact (the message is kept).
        const r = await this.contacts.resolveOrCreateByIdentity(tx, orgId, {
          kind: 'channel_uid',
          channel: FACEBOOK_KIND,
          value: m.senderId,
          name: m.title,
          message: 'Source: Facebook DM',
          quiet: true,
        });
        if ((r.outcome === 'found' || r.outcome === 'created') && contactId === null) {
          contactId = r.contactId;
          await tx.execute(
            sql`UPDATE conversations SET contact_id = ${r.contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`,
          );
        }
      }
      return { stored: true, conversationId, contactId, newThread: out.createdConversation };
    });
  }

  /** Has Meta's id already been stored? The ledger is the authority (it is what makes a late duplicate a no-op). */
  async alreadyStored(tx: Tx, orgId: number, dedup: string): Promise<boolean> {
    if (dedup === '') return false;
    const res = await tx.execute(sql`
      SELECT 1 FROM message_ledger l JOIN channels ch ON ch.org_id = l.org_id AND ch.id = l.channel_id
      WHERE l.org_id = ${orgId} AND ch.kind = ${FACEBOOK_KIND} AND l.kind = 'provider_id' AND l.key = ${dedup}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async applyProfile(
    tx: Tx,
    orgId: number,
    conversationId: number,
    contactId: number | null,
    p: { name: string; avatarUrl: string | null },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE conversations SET title = ${p.name}, peer_name = ${p.name},
             routing_meta = coalesce(routing_meta, '{}'::jsonb) || ${JSON.stringify({ fb_avatar: p.avatarUrl ?? '' })}::jsonb
      WHERE org_id = ${orgId} AND id = ${conversationId}`);
    if (contactId !== null) {
      await tx.execute(sql`
        UPDATE contacts SET name = ${p.name}, image_url = coalesce(nullif(image_url, ''), ${p.avatarUrl})
        WHERE org_id = ${orgId} AND id = ${contactId} AND coalesce(name, '') IN ('', ${PLACEHOLDER_NAME})`);
    }
  }

  /** A broadcast copy in the thread, shown as outbound from the broadcast. Leaves unread alone. */
  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; broadcastUuid: string },
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.peer_key
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${conversationId}`);
    const row = res.rows[0] as { channel_uuid: string; peer_key: string } | undefined;
    if (!row) return;
    await RequestContextStore.run(
      {
        requestId: `fb-broadcast-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () =>
        this.conversations.recordOutbound({
          channelId: row.channel_uuid,
          peerKey: row.peer_key,
          source: 'broadcast',
          body: m.body,
          ...(m.providerMessageId ? { providerMessageId: m.providerMessageId } : {}),
        }),
    );
  }

  async lastInboundAt(tx: Tx, orgId: number, conversationId: number): Promise<Date | null> {
    const res = await tx.execute(
      sql`SELECT last_inbound_at FROM conversations WHERE org_id = ${orgId} AND id = ${conversationId}`,
    );
    const v = (res.rows[0] as { last_inbound_at: Date | string | null } | undefined)
      ?.last_inbound_at;
    return v ? new Date(v) : null;
  }
}
