import { Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import type { ChannelRuntime, NormalisedInbound } from '../../infra/providers/chat-conversations';
import { ChatMediaStore, type StoredMedia } from '../../infra/providers/chat-conversations/media';
import { ContactsService } from '../crm';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { effectiveCapabilitiesOf } from './channel-capabilities';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelsRepository, type ChannelRow } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { ConversationLifecycleService } from './conversation-lifecycle.service';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';
import { InboundMessageHooks } from './inbound-hooks';
import { MediaFetchPublisher } from './media-fetch.publisher';
import { identityOfPeer, defaultTitle, normalizePeerKey } from './peer-key';
import {
  UNSUPPORTED_BODY,
  clampProviderTime,
  channelMetaOf,
  inboundMessageKind,
  previewOf,
} from './message-rules';
import { MessagesRepository, type MessageRow } from './messages.repository';

export type IngestOutcome =
  | {
      outcome: 'stored';
      conversationUuid: string;
      messageUuid: string;
      seq: number;
      createdConversation: boolean;
      reopenedFrom: string | null;
    }
  /** The provider message id was already in the ledger: nothing was stored (a redelivery, or a concurrent copy). */
  | { outcome: 'duplicate' }
  /** A reaction (applied to the message it answers, no new row) or a reaction whose target we never stored. */
  | { outcome: 'reaction'; applied: boolean }
  /** Nothing to attach the message to: the channel is gone or has no adapter here, or the sender has no usable key. */
  | { outcome: 'dropped'; reason: 'channel_missing' | 'invalid_peer' };

export interface IngestOptions {
  /** The queue will not try again: a failure to fetch the file must not lose the text (the message is stored without it). */
  finalAttempt?: boolean;
}

type InboundJob = {
  orgId: number;
  channelUuid: string;
  message: Omit<NormalisedInbound, 'providerTimestamp'> & { providerTimestamp: string };
};

/**
 * The inbound pipeline of the inbox (plan-inbox-chat.md 3.4): one provider message becomes one stored message on the right thread,
 * once, however many times and in whatever order the provider delivers it.
 *
 * ONE transaction per message holds everything that must be true together:
 *
 *   1. the thread is found or created under an advisory lock on (workspace, channel, peer) so two first messages from a new sender
 *      make one thread and one contact; its row is then locked for the rest of the transaction;
 *   2. a message id and row time are allocated first, because the ledger row that guards the delivery has to carry both;
 *   3. `message_ledger` `INSERT ... ON CONFLICT DO NOTHING`: no row back means this provider message id was already stored (a
 *      redelivery after the queue forgot the job, two concurrent deliveries) and the transaction ends there. The queue's job id is
 *      only a shortcut in front of this;
 *   4. the next `msg_seq` is taken from the locked row (gap-free per thread), the message is inserted, and the thread's unread count,
 *      activity stamps, 24 hour window and wait are updated; a resolved, closed or snoozed thread is reopened;
 *   5. conversation events, the audit row and the `conversation.created` / `conversation.reopened` outbox events are written.
 *
 * Realtime is published after the commit. An inbound message is never dropped for a business reason: when the contact cannot be
 * created (the plan's contact cap, a contact error) the thread simply has no contact and says so (`needs_contact`); a file that
 * cannot be fetched or is refused by the upload policy leaves the message without it.
 */
@Injectable()
export class InboundIngestService {
  private readonly logger = new Logger(InboundIngestService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly channelsRepo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly contacts: ContactsService,
    private readonly lifecycle: ConversationLifecycleService,
    private readonly media: ChatMediaStore,
    private readonly realtime: ChatRealtimePublisher,
    private readonly mediaFetch: MediaFetchPublisher,
    private readonly hooks: InboundMessageHooks,
  ) {}

  async ingest(job: InboundJob, options: IngestOptions = {}): Promise<IngestOutcome> {
    const { orgId } = job;
    const m = job.message;

    const found = await this.db.txAs({ orgId }, async (tx) => {
      const row = await this.channelsRepo.byUuid(tx, orgId, job.channelUuid);
      if (!row || !this.adapters.find(row.kind)) return null;
      return { row, runtime: await this.channels.runtime(tx, orgId, row) };
    });
    if (!found) return { outcome: 'dropped', reason: 'channel_missing' };
    const { row: channel, runtime } = found;

    const peerKey = normalizePeerKey(channel.kind, m.peerKey);
    if (!peerKey) return { outcome: 'dropped', reason: 'invalid_peer' };

    // A redelivery is the common duplicate: answer it before spending a file download on it. The ledger insert below stays the authority.
    if (await this.alreadyStored(orgId, channel.id, m.providerMessageId))
      return { outcome: 'duplicate' };

    const stored = await this.fetchMedia(orgId, runtime, m, options);

    let result: TxResult;
    try {
      result = await this.db.txAs({ orgId }, (tx) =>
        this.store(tx, orgId, channel, runtime, peerKey, m, stored),
      );
    } catch (err) {
      // A stored file whose message never committed is an orphan: remove it, then let the queue try again.
      if (stored.media) await this.media.remove(orgId, stored.media.key).catch(() => undefined);
      throw err;
    }

    if (result.outcome === 'duplicate' && stored.media) {
      await this.media.remove(orgId, stored.media.key).catch(() => undefined);
    }
    if (result.outcome === 'stored') {
      if (stored.pending) await this.enqueueMediaFetch(orgId, result.message.uuid);
      await this.realtime.messageStored(orgId, result.conv, result.message, result.changed, {
        unread: true,
      });
      await this.hooks.run({
        orgId,
        channelId: channel.id,
        conversationId: result.conv.id,
        contactId: result.conv.contactId,
        channelUuid: channel.uuid,
        channelKind: channel.kind,
        conversationUuid: result.conv.uuid,
        messageUuid: result.message.uuid,
        peerKey,
        peerName: result.conv.peerName,
        createdConversation: result.createdConversation,
        message: {
          kind: m.kind,
          body: result.message.body,
          meta: result.message.meta,
          location: m.location ?? null,
          mediaKey: result.message.mediaKey,
        },
      });
      return {
        outcome: 'stored',
        conversationUuid: result.conv.uuid,
        messageUuid: result.message.uuid,
        seq: result.message.seq,
        createdConversation: result.createdConversation,
        reopenedFrom: result.reopenedFrom,
      };
    }
    if (result.outcome === 'reaction') {
      if (result.applied && result.conversationUuid) {
        await this.realtime.threadChanged(orgId, result.conversationUuid, 'reaction');
      }
      return { outcome: 'reaction', applied: result.applied };
    }
    return { outcome: 'duplicate' };
  }

  // --- the transaction ---------------------------------------------------------------------------------------------------------

  private async store(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    runtime: ChannelRuntime,
    peerKey: string,
    m: InboundJob['message'],
    stored: FetchedMedia,
  ): Promise<TxResult> {
    await this.conversations.lockPeer(tx, orgId, channel.id, peerKey);
    let conv = await this.conversations.findForUpdate(tx, orgId, channel.id, peerKey);
    let createdConversation = false;
    const peerName = m.peerName?.trim() || null;

    if (!conv) {
      const link = await this.linkContact(tx, orgId, channel.kind, peerKey, peerName);
      conv = await this.conversations.insert(tx, orgId, {
        channelId: channel.id,
        peerKey,
        peerName,
        title: defaultTitle(channel.kind, peerKey, peerName),
        contactId: link.contactId,
        needsContact: link.needsContact,
      });
      createdConversation = true;
    } else {
      // A thread without a contact (the cap was reached, or the contact was deleted) tries again: the cap may have room now.
      const patch: { peerName?: string | null; contactId?: number | null; needsContact?: boolean } =
        {};
      if (conv.contactId === null) {
        const link = await this.linkContact(tx, orgId, channel.kind, peerKey, peerName);
        if (link.contactId !== null || link.needsContact !== conv.needsContact) {
          patch.contactId = link.contactId;
          patch.needsContact = link.needsContact;
        }
      }
      if (peerName && peerName !== conv.peerName) patch.peerName = peerName;
      if (Object.keys(patch).length > 0) {
        await this.conversations.syncPeer(tx, orgId, conv.id, patch);
        conv = { ...conv, ...patch } as ConversationRow;
      }
    }

    if (m.kind === 'reaction') return this.applyReaction(tx, orgId, channel, conv, m);

    const alloc = await this.messages.allocate(tx);
    const fresh = await this.messages.ledgerInsert(
      tx,
      orgId,
      channel.id,
      'provider_id',
      m.providerMessageId,
      {
        messageId: alloc.id,
        messageCreatedAt: alloc.createdAt,
        conversationId: conv.id,
      },
    );
    if (!fresh) return { outcome: 'duplicate' };

    const arrivedAt = new Date();
    const customerAt = clampProviderTime(new Date(m.providerTimestamp), arrivedAt);
    const windowHours = effectiveCapabilitiesOf(
      this.adapters.for(channel.kind),
      runtime,
    ).windowHours;

    const kind = inboundMessageKind(m);
    // An unsupported message may carry its own placeholder text ("[Poll message]"): the adapter knows what the customer sent.
    const body = m.kind === 'unsupported' ? (m.body ?? UNSUPPORTED_BODY) : (m.body ?? null);
    const replyTo = m.replyToProviderMessageId
      ? await this.replyTargetUuid(tx, orgId, channel.id, m.replyToProviderMessageId)
      : null;
    const meta: Record<string, unknown> = {};
    if (m.location?.name) meta.locationName = m.location.name;
    if (m.location?.address) meta.locationAddress = m.location.address;
    if (m.kind === 'unsupported') meta.unsupported = true;
    Object.assign(meta, channelMetaOf(m.meta));
    if (stored.error) meta.mediaError = stored.error;
    if (m.media && !stored.media) meta.mediaName = m.media.name ?? null;
    if (stored.pending && m.media) {
      // The file is copied by a `media-fetch` job after this transaction commits; everything that job needs is kept on the row.
      meta.mediaStatus = 'pending';
      meta.mediaGen = 1;
      meta.mediaFetch = {
        providerMediaId: m.media.providerMediaId,
        mediaKind: m.media.mediaKind,
        mime: m.media.mime,
        ...(m.media.sha256 ? { sha256: m.media.sha256 } : {}),
        ...(m.media.name ? { name: m.media.name } : {}),
        ...(m.media.sizeBytes !== undefined ? { sizeBytes: m.media.sizeBytes } : {}),
      };
    }

    const { row: after, reopenedFrom } = await this.conversations.applyInbound(tx, orgId, conv.id, {
      messageId: alloc.id,
      arrivedAt: alloc.createdAt,
      customerAt,
      preview: previewOf({ kind, body, locationName: m.location?.name }),
      windowHours,
      active: true,
    });

    await this.messages.insert(tx, orgId, {
      id: alloc.id,
      createdAt: alloc.createdAt,
      conversationId: conv.id,
      seq: after.msgSeq,
      direction: 'in',
      kind,
      senderKind: 'customer',
      body,
      media: stored.media,
      latitude: m.location?.latitude ?? null,
      longitude: m.location?.longitude ?? null,
      status: 'received',
      providerMessageId: m.providerMessageId,
      replyToMessageUuid: replyTo,
      meta,
      providerTs: customerAt,
    });

    if (createdConversation) await this.lifecycle.created(tx, orgId, channel, after, 'customer');
    if (reopenedFrom) await this.lifecycle.reopened(tx, orgId, channel, after, reopenedFrom);
    await this.conversations.touchChannel(tx, orgId, channel.id);

    const message = (await this.messages.byId(tx, orgId, alloc.id, alloc.createdAt))!;
    const changed = ['lastMessage', 'unread'];
    if (createdConversation) changed.push('created');
    if (reopenedFrom) changed.push('status');
    return { outcome: 'stored', conv: after, message, createdConversation, reopenedFrom, changed };
  }

  // --- pieces --------------------------------------------------------------------------------------------------------------------

  /**
   * Whose message is it. The contact step is best effort by design (an inbound message is never dropped): it runs in a savepoint, so
   * a failure inside it undoes only its own writes and the thread is created without a contact, flagged `needs_contact`.
   */
  private async linkContact(
    tx: Tx,
    orgId: number,
    channelKind: string,
    peerKey: string,
    name: string | null,
  ): Promise<{ contactId: number | null; needsContact: boolean }> {
    const identity = identityOfPeer(channelKind, peerKey);
    if (!identity) return { contactId: null, needsContact: false };
    try {
      return await tx.transaction(async (sp) => {
        const r = await this.contacts.resolveOrCreateByIdentity(sp as Tx, orgId, {
          kind: identity.kind,
          value: identity.value,
          name,
          source: 'inbox',
        });
        if (r.outcome === 'found' || r.outcome === 'created') {
          return { contactId: r.contactId, needsContact: false };
        }
        return { contactId: null, needsContact: r.outcome === 'quota_reached' };
      });
    } catch (err) {
      this.logger.warn(
        { orgId, err: (err as Error).message },
        'contact resolution failed; the message is kept on a thread without a contact',
      );
      return { contactId: null, needsContact: true };
    }
  }

  /** A reaction decorates the message it answers instead of adding a bubble; the ledger still makes its redelivery a no-op. */
  private async applyReaction(
    tx: Tx,
    orgId: number,
    channel: ChannelRow,
    conv: ConversationRow,
    m: InboundJob['message'],
  ): Promise<TxResult> {
    const target = m.replyToProviderMessageId
      ? await this.messages.ledgerFind(
          tx,
          orgId,
          channel.id,
          'provider_id',
          m.replyToProviderMessageId,
        )
      : null;
    if (!target) return { outcome: 'reaction', applied: false, conversationUuid: null };
    const fresh = await this.messages.ledgerInsert(
      tx,
      orgId,
      channel.id,
      'provider_id',
      m.providerMessageId,
      {
        messageId: target.messageId,
        messageCreatedAt: target.messageCreatedAt,
        conversationId: target.conversationId,
      },
    );
    if (!fresh) return { outcome: 'duplicate' };
    await this.messages.setReaction(tx, orgId, target, m.reactionEmoji?.trim() || null);
    return { outcome: 'reaction', applied: true, conversationUuid: conv.uuid };
  }

  private async replyTargetUuid(
    tx: Tx,
    orgId: number,
    channelId: number,
    providerMessageId: string,
  ): Promise<string | null> {
    const entry = await this.messages.ledgerFind(
      tx,
      orgId,
      channelId,
      'provider_id',
      providerMessageId,
    );
    if (!entry) return null;
    const row = await this.messages.byLedger(tx, orgId, entry);
    return row?.uuid ?? null;
  }

  private async alreadyStored(
    orgId: number,
    channelId: number,
    providerMessageId: string,
  ): Promise<boolean> {
    return this.db.txAs(
      { orgId },
      async (tx) =>
        (await this.messages.ledgerFind(tx, orgId, channelId, 'provider_id', providerMessageId)) !==
        null,
    );
  }

  /**
   * Puts the file's download on its queue, after the message committed. Best effort: if this fails (Redis down) the message stays
   * `pending` and the recovery sweep enqueues it, so an inbound message is never lost to a queue error.
   */
  private async enqueueMediaFetch(orgId: number, messageUuid: string): Promise<void> {
    try {
      await this.mediaFetch.enqueue(orgId, messageUuid, 1);
    } catch (err) {
      this.logger.warn(
        { orgId, err: (err as Error).message },
        'could not queue the file download; the recovery sweep will',
      );
    }
  }

  /**
   * Downloads and stores the file of a media message, outside the transaction (no connection is held across a network call). A file
   * the upload policy refuses is not an error to retry: the message is stored without it and says why. A download that failed is
   * retried by the queue, and on the last attempt the message is stored without the file rather than lost.
   */
  private async fetchMedia(
    orgId: number,
    runtime: ChannelRuntime,
    m: InboundJob['message'],
    options: IngestOptions,
  ): Promise<FetchedMedia> {
    if (m.kind !== 'media' || !m.media) return { media: null };
    const adapter = this.adapters.for(runtime.kind);
    // A provider whose files are copied in the background (WhatsApp Cloud): store the message now, the file follows.
    if (adapter.inboundMedia) return { media: null, pending: true };
    if (!adapter.fetchMedia) return { media: null, error: 'unsupported' };
    try {
      const file = await adapter.fetchMedia(runtime, m.media);
      const media = await this.media.storeInbound({
        orgId,
        buffer: file.bytes,
        declaredMime: file.mime || m.media.mime,
        filename: m.media.name,
      });
      return { media };
    } catch (err) {
      if (err instanceof AppError && err.code === ERROR_CODES.AUTH_UPLOAD_REJECTED) {
        return { media: null, error: 'rejected' };
      }
      if (options.finalAttempt) {
        this.logger.warn(
          { orgId, err: (err as Error).message },
          'inbound file could not be fetched; storing the message without it',
        );
        return { media: null, error: 'unavailable' };
      }
      throw err;
    }
  }
}

interface FetchedMedia {
  media: StoredMedia | null;
  error?: 'rejected' | 'unavailable' | 'unsupported';
  /** The file is fetched later by the `media-fetch` worker; the message is stored `pending`. */
  pending?: boolean;
}

type TxResult =
  | {
      outcome: 'stored';
      conv: ConversationRow;
      message: MessageRow;
      createdConversation: boolean;
      reopenedFrom: string | null;
      changed: string[];
    }
  | { outcome: 'duplicate' }
  | { outcome: 'reaction'; applied: boolean; conversationUuid: string | null };
