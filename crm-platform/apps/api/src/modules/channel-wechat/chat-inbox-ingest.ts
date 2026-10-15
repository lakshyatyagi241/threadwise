import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import type { InboundMedia, NormalisedInbound } from '../../infra/providers/chat-conversations';
import {
  CONVERSATIONS_FACADE,
  ExternalChannelIngest,
  type ConversationsFacade,
  type ExternalAccount,
} from '../chat-conversations';
import type { InboundMediaType, WechatInbound } from './wechat-rules';
import { inboundKey } from './wechat-rules';

/** The channel kind an Official Account's threads live on. */
export const WECHAT_KIND = 'wechat';

/** What a thread and a contact are called until WeChat tells us the follower's nickname (Reference). */
export const THREAD_PLACEHOLDER = 'WeChat';
export const CONTACT_PLACEHOLDER = 'WeChat user';

const MEDIA_KIND: Record<InboundMediaType, InboundMedia['mediaKind']> = {
  image: 'image',
  audio: 'audio',
  video: 'video',
};
const MEDIA_MIME: Record<InboundMediaType, string> = {
  image: 'image/jpeg',
  audio: 'audio/amr',
  video: 'video/mp4',
};

export interface InboundRecorded {
  /** False when WeChat's message was already stored (a redelivery). */
  stored: boolean;
  conversationId: number;
  contactId: number | null;
  /** The thread (and so, in practice, the contact) was created by this message. */
  newThread: boolean;
}

const NOT_STORED: InboundRecorded = {
  stored: false,
  conversationId: 0,
  contactId: null,
  newThread: false,
};

/**
 * The WeChat side of the inbox, over chat-conversations. An Official Account is one `wechat` channel (its handle the channel's row id);
 * each follower (OpenID) is the peer of one perpetual thread on it. A message goes through the shared pipeline (ledger dedup on the
 * MsgId, gap-free sequence, unread, reopen, realtime). Still ours, because the inbox cannot know it: the follower becomes a contact keyed
 * by OpenID (no phone number).
 */
@Injectable()
export class ChatInboxIngest {
  constructor(
    private readonly db: DatabaseService,
    private readonly external: ExternalChannelIngest,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  private account(channel: {
    id: number;
    accountName: string | null;
    wxId: string | null;
    appId: string | null;
  }): ExternalAccount {
    return {
      kind: WECHAT_KIND,
      externalId: String(channel.id),
      name: (channel.accountName || 'WeChat').slice(0, 120),
      displayAddress: channel.wxId || channel.appId,
    };
  }

  /** Keeps a channel's inbox channel in step with it (connected, paused or gone). */
  syncChannel(
    orgId: number,
    channel: { id: number; accountName: string | null; wxId: string | null; appId: string | null },
    connected: boolean,
  ): Promise<string> {
    return this.external.sync(orgId, this.account(channel), connected);
  }

  async recordInbound(
    orgId: number,
    channel: { id: number; accountName: string | null; wxId: string | null; appId: string | null },
    i: WechatInbound,
  ): Promise<InboundRecorded> {
    const kind = i.location !== null ? 'location' : i.media ? 'media' : 'text';
    // The shared pipeline writes the peer name it is given on every message: a thread that has already learnt its follower's nickname
    // is given that back, so the next message does not turn it into the placeholder again.
    const known = await this.db.txAs({ orgId }, (tx) =>
      tx.execute(sql`
        SELECT c.peer_name FROM conversations c
        JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
        WHERE c.org_id = ${orgId} AND ch.kind = ${WECHAT_KIND} AND ch.external_id = ${String(channel.id)}
          AND c.peer_key = ${i.openid}`),
    );
    const message: NormalisedInbound = {
      providerMessageId: inboundKey(i) ?? `wx-${randomUUID()}`,
      peerKey: i.openid,
      peerName:
        (known.rows[0] as { peer_name: string | null } | undefined)?.peer_name ||
        THREAD_PLACEHOLDER,
      kind: isUnsupported(i) ? 'unsupported' : kind,
      ...(i.text !== '' ? { body: i.text } : {}),
      ...(i.media
        ? {
            media: {
              // WeChat's media id; the adapter downloads it with the channel's own access token.
              providerMediaId: i.media.id,
              mediaKind: MEDIA_KIND[i.media.type],
              mime: MEDIA_MIME[i.media.type],
              ...(i.msgType === 'voice' ? { voice: true } : {}),
            },
          }
        : {}),
      ...(i.location
        ? {
            location: {
              latitude: i.location.latitude,
              longitude: i.location.longitude,
              ...(i.location.label ? { name: i.location.label } : {}),
            },
          }
        : {}),
      meta: {
        wechat: Object.fromEntries(
          Object.entries({
            openid: i.openid,
            msg_id: i.msgId,
            msg_type: i.msgType,
            event: i.event,
            event_key: i.eventKey,
          }).filter(([, v]) => v !== null && v !== ''),
        ),
      },
      providerTimestamp: new Date(),
    };
    const out = await this.external.inbound(orgId, this.account(channel), message);
    if (out.outcome !== 'stored') return NOT_STORED;

    return this.db.txAs({ orgId }, async (tx) => {
      const res = await tx.execute(
        sql`SELECT id, contact_id FROM conversations WHERE org_id = ${orgId} AND uuid = ${out.conversationUuid}::uuid`,
      );
      const conv = res.rows[0] as
        { id: number | string; contact_id: number | string | null } | undefined;
      if (!conv) return NOT_STORED;
      const conversationId = Number(conv.id);

      // The follower is one contact per organization, keyed by OpenID (no phone number).
      let contactId = conv.contact_id === null ? null : Number(conv.contact_id);
      if (contactId === null) {
        const c = await tx.execute(sql`
          INSERT INTO contacts (org_id, name, channel, channel_uid, message)
          VALUES (${orgId}, ${CONTACT_PLACEHOLDER}, ${WECHAT_KIND}, ${i.openid}, 'Source: WeChat')
          ON CONFLICT (org_id, channel, channel_uid) WHERE channel IS NOT NULL AND channel_uid IS NOT NULL
          DO UPDATE SET name = contacts.name
          RETURNING id`);
        contactId = Number((c.rows[0] as { id: number | string }).id);
        await tx.execute(
          sql`UPDATE conversations SET contact_id = ${contactId} WHERE org_id = ${orgId} AND id = ${conversationId}`,
        );
      }
      return { stored: true, conversationId, contactId, newThread: out.createdConversation };
    });
  }

  /**
   * The follower's nickname and photo, learnt after the message was stored. Only a name nobody has changed is replaced, and a photo
   * only fills an empty one: an agent's edit always wins.
   */
  async setProfile(
    orgId: number,
    conversationId: number,
    contactId: number | null,
    p: { nickname: string | null; avatarUrl: string | null },
  ): Promise<void> {
    await this.db.txAs({ orgId }, async (tx) => {
      if (p.nickname) {
        await tx.execute(sql`
          UPDATE conversations SET title = ${p.nickname}, peer_name = ${p.nickname}
          WHERE org_id = ${orgId} AND id = ${conversationId} AND title = ${THREAD_PLACEHOLDER}`);
      }
      if (contactId === null) return;
      if (p.nickname) {
        await tx.execute(sql`
          UPDATE contacts SET name = ${p.nickname}
          WHERE org_id = ${orgId} AND id = ${contactId} AND name = ${CONTACT_PLACEHOLDER}`);
      }
      if (p.avatarUrl) {
        await tx.execute(sql`
          UPDATE contacts SET image_url = ${p.avatarUrl}
          WHERE org_id = ${orgId} AND id = ${contactId} AND coalesce(image_url, '') = ''`);
      }
    });
  }

  /** A broadcast copy in the thread, shown as outbound from the broadcast. Leaves unread alone. */
  async recordOutbound(
    tx: Tx,
    orgId: number,
    conversationId: number,
    m: { body: string },
  ): Promise<void> {
    const res = await tx.execute(sql`
      SELECT ch.uuid AS channel_uuid, c.peer_key
      FROM conversations c JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      WHERE c.org_id = ${orgId} AND c.id = ${conversationId}`);
    const row = res.rows[0] as { channel_uuid: string; peer_key: string } | undefined;
    if (!row) return;
    await RequestContextStore.run(
      {
        requestId: `wechat-broadcast-${randomUUID()}`,
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
        }),
    );
  }
}

/** A message type this channel has no rendering for: stored with its `[type]` placeholder as an unsupported message. */
function isUnsupported(i: WechatInbound): boolean {
  return (
    i.kind === 'message' &&
    !['text', 'image', 'voice', 'video', 'shortvideo', 'location', 'link'].includes(i.msgType)
  );
}
