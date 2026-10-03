import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  canonicalizePhone,
  type ListMessagesQuery,
  type MessageListResponse,
  type MessageResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { ConversationLifecycleService } from './conversation-lifecycle.service';
import type {
  ConversationsFacade,
  EnqueueOutboundInput,
  EnqueueOutboundResult,
  RecordOutboundInput,
  ThreadRef,
} from './conversations.facade';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';
import { defaultTitle, isPhoneChannel, normalizePeerKey } from './peer-key';
import { MediaFetchService } from './media-fetch.service';
import { previewOf } from './message-rules';
import { MessageViewService } from './message-view.service';
import { MessagesRepository } from './messages.repository';
import { OutboundService, conversationNotFound } from './outbound.service';

/** Where a message recorded by another domain came from, as the sender kind the thread shows. */
const senderKindOfSource = (source: string): 'broadcast' | 'bot' | 'system' => {
  if (source === 'broadcast' || source === 'campaign') return 'broadcast';
  if (source === 'flow' || source === 'auto_reply' || source === 'ai' || source === 'bot')
    return 'bot';
  return 'system';
};

/**
 * `ConversationsFacade`: the door the rest of the platform uses (see the interface for the contract). It runs under the caller's
 * workspace (the ambient request context), opens its own transactions, and speaks uuids. The sending, retry and reading logic lives in
 * the services it delegates to; this class adds the thread lookups and the recorder other domains use for messages they sent
 * themselves (a broadcast, an appointment reminder, a flow).
 */
@Injectable()
export class ConversationsService implements ConversationsFacade {
  constructor(
    private readonly db: DatabaseService,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly channelsRepo: ChannelsRepository,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly realtime: ChatRealtimePublisher,
    private readonly outbound: OutboundService,
    private readonly view: MessageViewService,
    private readonly mediaFetch: MediaFetchService,
  ) {}

  // --- threads -------------------------------------------------------------------------------------------------------------------

  async findThread(channelId: string, peerKey: string): Promise<ThreadRef | null> {
    const orgId = RequestContextStore.orgId();
    return this.db.tx(async (tx) => {
      const channel = await this.channelsRepo.byUuid(tx, orgId, channelId);
      if (!channel) return null;
      const key = normalizePeerKey(channel.kind, peerKey);
      if (!key) return null;
      const conv = await this.conversations.byPeer(tx, orgId, channel.id, key);
      return conv ? this.ref(conv, channel) : null;
    });
  }

  async openConversationFor(contactId: string, channelId: string): Promise<ThreadRef> {
    const orgId = RequestContextStore.orgId();
    const created = await this.db.tx(async (tx) => {
      const channel = await this.channelOrThrow(tx, orgId, channelId);
      const contact = await this.conversations.contactIdByUuid(tx, orgId, contactId);
      if (contact === null) throw AppError.notFound('Contact', contactId);

      const existing = await this.conversations.byContactAndChannel(tx, orgId, channel.id, contact);
      if (existing) return { conv: existing, channel, created: false };

      if (!isPhoneChannel(channel.kind)) {
        throw new AppError(
          ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED,
          'This channel cannot start a conversation with a contact',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const info = await this.conversations.contactPhone(tx, orgId, contact);
      const phone = canonicalizePhone({ number: info?.phone });
      if (!phone) {
        throw AppError.validation('The contact has no phone number to message', [
          { path: 'contactId', message: 'no phone number' },
        ]);
      }
      return this.findOrCreate(tx, orgId, channel, phone.digits, {
        contactId: contact,
        peerName: info?.name ?? null,
      });
    });
    if (created.created) {
      await this.realtime.conversationChanged(orgId, created.conv, ['created']);
    }
    return this.ref(created.conv, created.channel);
  }

  async recordOutbound(
    input: RecordOutboundInput,
  ): Promise<{ messageId: string; thread: ThreadRef }> {
    const orgId = RequestContextStore.orgId();
    const done = await this.db.tx(async (tx) => {
      const channel = await this.channelOrThrow(tx, orgId, input.channelId);
      const peerKey = normalizePeerKey(channel.kind, input.peerKey);
      if (!peerKey) throw AppError.validation('peerKey is not usable on this channel');
      const contact = input.contactId
        ? await this.conversations.contactIdByUuid(tx, orgId, input.contactId)
        : null;

      // A repeated call with the same provider id is a no-op: the existing message comes back.
      if (input.providerMessageId) {
        const seen = await this.messages.ledgerFind(
          tx,
          orgId,
          channel.id,
          'provider_id',
          input.providerMessageId,
        );
        if (seen) {
          const row = (await this.messages.byLedger(tx, orgId, seen))!;
          const conv = (await this.conversations.byId(tx, orgId, seen.conversationId))!;
          return { row, conv, channel, fresh: false as const, createdConversation: false };
        }
      }

      const found = await this.findOrCreate(tx, orgId, channel, peerKey, {
        contactId: contact,
        peerName: null,
      });
      const conv = found.conv;
      const alloc = await this.messages.allocate(tx);
      if (input.providerMessageId) {
        const fresh = await this.messages.ledgerInsert(
          tx,
          orgId,
          channel.id,
          'provider_id',
          input.providerMessageId,
          { messageId: alloc.id, messageCreatedAt: alloc.createdAt, conversationId: conv.id },
        );
        if (!fresh) {
          // A concurrent identical call won: report its message.
          const seen = (await this.messages.ledgerFind(
            tx,
            orgId,
            channel.id,
            'provider_id',
            input.providerMessageId,
          ))!;
          return {
            row: (await this.messages.byLedger(tx, orgId, seen))!,
            conv,
            channel,
            fresh: false as const,
            createdConversation: false,
          };
        }
      }

      const after = await this.conversations.applyOutboundQueued(tx, orgId, conv.id, {
        messageId: alloc.id,
        arrivedAt: alloc.createdAt,
        preview: previewOf({ kind: 'text', body: input.body }),
        // A line on the customer's side is not something the business sent.
        ...(input.direction === 'in' ? {} : { sentAt: new Date() }),
      });
      await this.messages.insert(tx, orgId, {
        id: alloc.id,
        createdAt: alloc.createdAt,
        conversationId: conv.id,
        seq: after.msgSeq,
        direction: input.direction ?? 'out',
        kind: input.kind ?? 'text',
        senderKind:
          input.kind === 'system'
            ? 'system'
            : input.senderUserId
              ? 'agent'
              : senderKindOfSource(input.source),
        senderUserId: input.senderUserId ?? null,
        body: input.body,
        // The provider already took it: the other domain sent it, this only records it in the thread.
        status: input.direction === 'in' ? 'received' : 'sent',
        providerMessageId: input.providerMessageId ?? null,
        meta: { source: input.source, ...(input.meta ?? {}) },
        providerTs: new Date(),
        ...(input.direction === 'in' ? {} : { sentAt: new Date() }),
      });
      await this.messages.insertEvent(
        tx,
        orgId,
        { id: alloc.id, createdAt: alloc.createdAt },
        'sent',
        {
          source: input.source,
        },
      );
      if (found.created) await this.lifecycle.created(tx, orgId, channel, after, 'system');
      const row = (await this.messages.byId(tx, orgId, alloc.id, alloc.createdAt))!;
      return {
        row,
        conv: after,
        channel,
        fresh: true as const,
        createdConversation: found.created,
      };
    });

    if (done.fresh) {
      await this.realtime.messageStored(
        orgId,
        done.conv,
        done.row,
        done.createdConversation ? ['lastMessage', 'created'] : ['lastMessage'],
      );
    }
    return { messageId: done.row.uuid, thread: this.ref(done.conv, done.channel) };
  }

  // --- the inbox's sending, retry and reading ------------------------------------------------------------------------------------

  enqueueOutbound(input: EnqueueOutboundInput): Promise<EnqueueOutboundResult> {
    return this.outbound.enqueue(input);
  }

  async retryOutbound(messageId: string): Promise<MessageResponse> {
    // One Retry button for both directions: on a customer's message it starts the failed file download again.
    const inbound = await this.mediaFetch.retryIfInbound(messageId);
    return inbound ?? this.outbound.retry(messageId);
  }

  async listMessages(
    conversationId: string,
    query: ListMessagesQuery,
  ): Promise<MessageListResponse> {
    const orgId = RequestContextStore.orgId();
    const done = await this.db.tx(async (tx) => {
      const conv = await this.conversations.byUuid(tx, orgId, conversationId);
      if (!conv) throw conversationNotFound(conversationId);
      const page = await this.messages.thread(tx, orgId, conv.id, {
        limit: query.limit,
        before: query.before,
        afterSeq: query.afterSeq,
      });
      const first = page.rows[0];
      const last = page.rows[page.rows.length - 1];
      const afterMode = query.afterSeq !== undefined;
      const hasMoreBefore = afterMode
        ? first !== undefined && (await this.messages.hasOlder(tx, orgId, conv.id, first.seq))
        : page.hasMore;
      const hasMoreAfter = afterMode
        ? page.hasMore
        : last !== undefined && (await this.messages.hasNewer(tx, orgId, conv.id, last.seq));
      return { rows: page.rows, hasMoreBefore, hasMoreAfter };
    });
    return {
      data: this.view.respondMany(done.rows),
      page: {
        hasMoreBefore: done.hasMoreBefore,
        hasMoreAfter: done.hasMoreAfter,
        limit: query.limit,
      },
    };
  }

  async markRead(conversationId: string, upToSeq: number): Promise<{ unreadCount: number }> {
    const orgId = RequestContextStore.orgId();
    const done = await this.db.tx(async (tx) => {
      const conv = await this.conversations.byUuid(tx, orgId, conversationId, true);
      if (!conv) throw conversationNotFound(conversationId);
      const unread = await this.conversations.setUnreadAfter(tx, orgId, conv.id, upToSeq);
      const after = (await this.conversations.byId(tx, orgId, conv.id))!;
      return { before: conv.unreadCount, unread, after };
    });
    if (done.unread !== done.before) {
      await this.realtime.conversationChanged(orgId, done.after, ['unread'], { unread: true });
    }
    return { unreadCount: done.unread };
  }

  // --- helpers -------------------------------------------------------------------------------------------------------------------

  /** The thread of (channel, peer): found, or created with the lifecycle records. Holds the thread's row lock until the transaction ends. */
  private async findOrCreate(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    peerKey: string,
    opts: { contactId: number | null; peerName: string | null },
  ): Promise<{ conv: ConversationRow; channel: ChannelRow; created: boolean }> {
    await this.conversations.lockPeer(tx, orgId, channel.id, peerKey);
    const existing = await this.conversations.findForUpdate(tx, orgId, channel.id, peerKey);
    if (existing) {
      if (existing.contactId === null && opts.contactId !== null) {
        await this.conversations.syncPeer(tx, orgId, existing.id, {
          contactId: opts.contactId,
          needsContact: false,
        });
        return {
          conv: { ...existing, contactId: opts.contactId, needsContact: false },
          channel,
          created: false,
        };
      }
      return { conv: existing, channel, created: false };
    }
    const contactName =
      opts.peerName ??
      (opts.contactId !== null
        ? ((await this.conversations.contactPhone(tx, orgId, opts.contactId))?.name ?? null)
        : null);
    const conv = await this.conversations.insert(tx, orgId, {
      channelId: channel.id,
      peerKey,
      peerName: opts.peerName,
      title: defaultTitle(channel.kind, peerKey, contactName),
      contactId: opts.contactId,
      needsContact: false,
    });
    await this.lifecycle.created(tx, orgId, channel, conv, 'system');
    return { conv, channel, created: true };
  }

  private async channelOrThrow(tx: Tx, orgId: number, channelId: string): Promise<ChannelRow> {
    const channel = await this.channelsRepo.byUuid(tx, orgId, channelId);
    if (!channel) throw AppError.notFound('Channel', channelId);
    return channel;
  }

  private ref(conv: ConversationRow, channel: ChannelRow): ThreadRef {
    return {
      id: conv.uuid,
      channelId: channel.uuid,
      peerKey: conv.peerKey,
      lastInboundAt: conv.lastInboundAt,
    };
  }
}
