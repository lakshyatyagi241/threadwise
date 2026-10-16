import { Inject, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { DatabaseService } from '../../../infra/db/database.service';
import type { InboundMedia, NormalisedInbound } from '../../../infra/providers/chat-conversations';
import {
  CONVERSATIONS_FACADE,
  ExternalChannelIngest,
  type ConversationsFacade,
  type ExternalAccount,
} from '../../chat-conversations';
import {
  CONTACT_LABEL,
  CONTACT_SOURCE,
  contactNameOf,
  isGenuineInbound,
  isPlaceholderTitle,
  previewOf,
  type Normalized,
} from '../ingest-rules';
import { ContactsService } from '../../crm';
import type { InstagramInboxIngest, IngestOutcome, ThreadRef } from './tokens';

/** The channel kind an Instagram account's threads live on. */
export const INSTAGRAM_KIND = 'instagram';

const MEDIA_DEFAULT_MIME: Record<InboundMedia['mediaKind'], string> = {
  image: 'image/jpeg',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  document: 'application/octet-stream',
  sticker: 'image/webp',
};

function mediaKindOf(type: string): InboundMedia['mediaKind'] {
  return type === 'image' || type === 'video' || type === 'audio' || type === 'sticker'
    ? type
    : 'document';
}

/** The account a thread belongs to: the engine's account id, else the part of the conversation id before the separator. */
function accountOf(n: Normalized): ExternalAccount {
  const id = n.accountId || (n.convId.split(/[_:]/)[0] ?? '') || 'unknown';
  return {
    kind: INSTAGRAM_KIND,
    externalId: id,
    name: n.accountUsername ? `@${n.accountUsername.replace(/^@+/, '')}` : id,
    displayAddress: n.accountUsername ? `@${n.accountUsername.replace(/^@+/, '')}` : null,
  };
}

/** The engine's message id; a message with none gets a stable one from its content, so a redelivery is still recognised. */
const messageIdOf = (n: Normalized): string =>
  n.providerMid !== ''
    ? n.providerMid
    : `ig-${createHash('sha256')
        .update(`${n.rawJid}|${n.direction}|${n.sentAt.toISOString()}|${n.text}|${n.mediaUrl}`)
        .digest('hex')
        .slice(0, 32)}`;

/**
 * The Instagram side of the inbox, over chat-conversations. A linked account is one `instagram` channel (the engine's account id is
 * its handle); a conversation is one thread on it, keyed by the engine's thread key. A customer's message goes through the shared
 * pipeline; a message the account itself sent (seen again by the pull) is recorded once as outbound. Both are deduped by the
 * engine's message id in the ledger, so the push and the pull showing the same message, or our own send coming back, store it once.
 *
 * Still ours, because the inbox cannot know it: the sender becomes a contact keyed by the sender id (an Instagram sender has no
 * phone), and a placeholder title is replaced by the real name once the engine gives one.
 */
@Injectable()
export class ChatInstagramIngest implements InstagramInboxIngest {
  constructor(
    private readonly db: DatabaseService,
    private readonly external: ExternalChannelIngest,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
    private readonly contacts: ContactsService,
  ) {}

  /** Keeps an account's inbox channel in step with the link (linked or not). */
  syncAccount(
    orgId: number,
    account: { accountId: string; username: string | null; connected: boolean },
  ): Promise<string> {
    const handle = account.username ? `@${account.username.replace(/^@+/, '')}` : null;
    return this.external.sync(
      orgId,
      {
        kind: INSTAGRAM_KIND,
        externalId: account.accountId,
        name: handle ?? account.accountId,
        displayAddress: handle,
      },
      account.connected,
    );
  }

  async record(orgId: number, n: Normalized): Promise<IngestOutcome> {
    const account = accountOf(n);
    const providerMessageId = messageIdOf(n);

    // Seen already (the push and the pull both deliver it, and our own send comes back): nothing is stored. A row stored before its
    // buttons were known, or one of our own sends, shows as plain text; the card is added to it.
    const prior = await this.db.txAs({ orgId }, (tx) =>
      this.ledgerEntry(tx, orgId, providerMessageId),
    );
    if (prior) {
      if (n.buttons) await this.graftButtons(orgId, prior, n.buttons);
      return {
        stored: false,
        conversationId: prior.conversationId,
        messageId: prior.messageId,
        contactId: null,
        newThread: false,
      };
    }

    let conversationUuid: string;
    let stored: boolean;
    let newThread = false;
    if (n.direction === 'in') {
      const message: NormalisedInbound = {
        providerMessageId,
        peerKey: n.rawJid,
        peerName: n.title,
        kind: n.mediaUrl ? 'media' : 'text',
        ...(n.text !== '' ? { body: n.text } : {}),
        ...(n.mediaUrl
          ? {
              media: {
                // The address the engine gave; the adapter downloads it, after the host check.
                providerMediaId: n.mediaUrl,
                mediaKind: mediaKindOf(n.type),
                mime: MEDIA_DEFAULT_MIME[mediaKindOf(n.type)],
              },
            }
          : {}),
        ...(n.buttons ? { meta: { buttons: n.buttons } } : {}),
        providerTimestamp: n.sentAt,
      };
      const out = await this.external.inbound(orgId, account, message);
      if (out.outcome !== 'stored') {
        return { stored: false, conversationId: 0, messageId: null, contactId: null, newThread };
      }
      conversationUuid = out.conversationUuid;
      stored = true;
      newThread = out.createdConversation;
    } else {
      // The account's own message, seen by the pull: shown as outbound, once.
      const channelUuid = await this.external.sync(orgId, account, true);
      const rec = await this.system(orgId, () =>
        this.conversations.recordOutbound({
          channelId: channelUuid,
          peerKey: n.rawJid,
          source: 'instagram',
          body: n.text !== '' ? n.text : previewOf('', n.type),
          providerMessageId,
        }),
      );
      conversationUuid = rec.thread.id;
      stored = true;
    }

    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, title, contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${conversationUuid}::uuid`);
      const conv = res.rows[0] as
        | { id: number | string; title: string | null; contact_id: number | string | null }
        | undefined;
      if (!conv) return { stored, conversationId: 0, messageId: null, contactId: null, newThread };
      const conversationId = Number(conv.id);
      const messageId = (await this.ledgerEntry(tx, orgId, providerMessageId))?.messageId ?? null;

      // The first message often carries only the sender's numeric id. A real name replaces that placeholder, never a title an
      // operator typed.
      if (n.resolvedHuman && isPlaceholderTitle(conv.title ?? '') && conv.title !== n.title) {
        await tx.execute(
          sql`UPDATE conversations SET title = ${n.title}, peer_name = ${n.title} WHERE org_id = ${orgId} AND id = ${conversationId}`,
        );
      }

      let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
      // The sender becomes a lead, keyed by the sender id (no phone). A test ping, a history message and our own send never do.
      if (isGenuineInbound(n) && n.igsid !== '') {
        // Through the contacts service: audit and the plan's contact cap apply, and no consent is granted by a first message. Over the
        // cap the thread simply has no contact (the message is kept).
        const r = await this.contacts.resolveOrCreateByIdentity(tx, orgId, {
          kind: 'channel_uid',
          channel: INSTAGRAM_KIND,
          value: n.igsid,
          name: contactNameOf(n) ?? CONTACT_LABEL,
          message: CONTACT_SOURCE,
          quiet: true,
        });
        if (r.outcome === 'found' || r.outcome === 'created') {
          if (n.avatar) {
            await tx.execute(sql`
              UPDATE contacts SET image_url = ${n.avatar}
              WHERE org_id = ${orgId} AND id = ${r.contactId} AND coalesce(image_url, '') = ''`);
          }
          if (contactId === null) {
            contactId = r.contactId;
            await tx.execute(
              sql`UPDATE conversations SET contact_id = ${r.contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`,
            );
          }
        }
      }
      return { stored, conversationId, messageId, contactId, newThread };
    });
  }

  /** The ledger entry of an engine message id: the authority on whether it was stored (the key is unique per channel). */
  private async ledgerEntry(
    tx: Tx,
    orgId: number,
    key: string,
  ): Promise<{ messageId: number; createdAt: string; conversationId: number } | null> {
    const res = await tx.execute(sql`
      SELECT l.message_id, l.message_created_at::text AS created_at, l.conversation_id
      FROM message_ledger l JOIN channels ch ON ch.org_id = l.org_id AND ch.id = l.channel_id
      WHERE l.org_id = ${orgId} AND ch.kind = ${INSTAGRAM_KIND} AND l.kind = 'provider_id' AND l.key = ${key}
      LIMIT 1`);
    const r = res.rows[0] as
      | { message_id: number | string; created_at: string; conversation_id: number | string }
      | undefined;
    return r
      ? {
          messageId: Number(r.message_id),
          createdAt: r.created_at,
          conversationId: Number(r.conversation_id),
        }
      : null;
  }

  private async graftButtons(
    orgId: number,
    entry: { messageId: number; createdAt: string },
    buttons: unknown,
  ): Promise<void> {
    await this.db.txAs({ orgId }, (tx) =>
      tx.execute(sql`
        UPDATE messages SET meta = meta || ${JSON.stringify({ buttons })}::jsonb
        WHERE org_id = ${orgId} AND id = ${entry.messageId} AND created_at = ${entry.createdAt}::timestamptz
          AND coalesce(jsonb_array_length(CASE WHEN jsonb_typeof(meta -> 'buttons') = 'array' THEN meta -> 'buttons' END), 0) = 0`),
    );
  }

  async threadClock(tx: Tx, orgId: number): Promise<Map<string, Date | null>> {
    const res = await tx.execute(sql`
      SELECT c.peer_key, c.last_message_at
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = ${INSTAGRAM_KIND}`);
    return new Map(
      (res.rows as Array<{ peer_key: string; last_message_at: Date | string | null }>).map((r) => [
        r.peer_key,
        r.last_message_at ? new Date(r.last_message_at) : null,
      ]),
    );
  }

  async findThread(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; channel: string | null; rawJid: string | null } | undefined> {
    const res = await tx.execute(sql`
      SELECT c.id, ch.kind AS channel, c.peer_key
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.uuid = ${uuid}::uuid`);
    const r = res.rows[0] as
      { id: number | string; channel: string | null; peer_key: string | null } | undefined;
    return r ? { id: Number(r.id), channel: r.channel, rawJid: r.peer_key } : undefined;
  }

  async findThreads(tx: Tx, orgId: number, uuids: string[]): Promise<ThreadRef[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.title, ch.kind AS channel, c.peer_key, c.contact_id
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.uuid IN (${sql.join(
        uuids.map((u) => sql`${u}::uuid`),
        sql`, `,
      )})`);
    return (
      res.rows as Array<{
        id: number | string;
        uuid: string;
        title: string | null;
        channel: string | null;
        peer_key: string | null;
        contact_id: number | string | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid,
      title: r.title ?? '',
      channel: r.channel,
      rawJid: r.peer_key,
      contactId: r.contact_id === null ? null : Number(r.contact_id),
    }));
  }

  async threadsOfAccount(
    tx: Tx,
    orgId: number,
    accountId: string,
    limit: number,
  ): Promise<Array<{ uuid: string; title: string; lastInboundAt: Date | null }>> {
    const res = await tx.execute(sql`
      SELECT c.uuid, c.title, c.last_inbound_at
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND ch.kind = ${INSTAGRAM_KIND} AND ch.external_id = ${accountId}
      ORDER BY c.last_inbound_at DESC NULLS LAST, c.id DESC LIMIT ${limit}`);
    return (
      res.rows as Array<{
        uuid: string;
        title: string | null;
        last_inbound_at: Date | string | null;
      }>
    ).map((r) => ({
      uuid: r.uuid,
      title: r.title ?? '',
      lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at) : null,
    }));
  }

  /** A message we sent into a thread, shown as outbound. The engine's id is the ledger key, so the pull never shows it again. */
  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string; providerMessageId: string | null; userId: number | null },
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.peer_key
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${conversationId}`);
    const row = res.rows[0] as { channel_uuid: string; peer_key: string } | undefined;
    if (!row) return;
    await this.system(orgId, () =>
      this.conversations.recordOutbound({
        channelId: row.channel_uuid,
        peerKey: row.peer_key,
        source: 'broadcast',
        body: m.body,
        ...(m.providerMessageId ? { providerMessageId: m.providerMessageId } : {}),
        senderUserId: m.userId,
      }),
    );
  }

  private system<T>(orgId: number, fn: () => Promise<T>): Promise<T> {
    return RequestContextStore.run(
      {
        requestId: `ig-ingest-${randomUUID()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      fn,
    );
  }
}
