import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  canonicalizeLocalPhone,
  type V1Message,
  type V1SendMessageInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../../common/context/request-context';
import { AppError } from '../../../../common/errors/app-error';
import { DatabaseService } from '../../../../infra/db/database.service';
import { ChannelError } from '../../../../infra/providers/chat-conversations';
import type { StoredMedia } from '../../../../infra/providers/chat-conversations/media';
import {
  CONVERSATIONS_FACADE,
  ChannelDispatcher,
  ChannelRegistryService,
  ChannelsFacade,
  normalizePeerKey,
  type ConversationsFacade,
  type EnqueueOutboundInput,
} from '../../../chat-conversations';
import { ContactResolverService, ContactsRepository, MergeTagService } from '../../../crm';
import { MediaIntakeService, type UploadedFile } from './media-intake.service';
import { MessagingReadService } from './messaging-read.service';
import { MessagingRepository } from './messaging.repository';
import { sendFailed, v1Error } from './messaging-errors';
import { SEND_CHANNEL_KINDS, resolveSender, type OtherChannel } from './sender-resolution';
import { digitsOf, hasCoordinates, missingMedia, reportedType, wantsMedia } from './send-plan';

/**
 * How long a send waits for the worker to take the message before it answers. Reference sent inside the request and answered `sent` or
 * `failed`; here the message is queued and a worker sends it, which normally takes well under a second. Waiting briefly keeps the answer
 * Reference clients read (`status: "sent"`); a slow channel answers `pending` and the client polls `GET /messages/{id}` as it always could.
 */
export const SETTLE_WAIT_MS = 3_000;
const SETTLE_POLL_MS = 100;

/** The text a location pin leaves in the thread (the inbox shows text lines; Reference kept the coordinates in their own columns). */
const pinText = (lat: number, lng: number): string => `📍 ${lat}, ${lng}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Refusals that stop a send before anything is stored, in Reference's `send_failed` words. */
const REFUSALS: Record<string, { reason: string; status?: number }> = {
  [ERROR_CODES.PLAN_LIMIT_REACHED]: { reason: 'out_of_credits', status: 402 },
  [ERROR_CODES.CHANNEL_DISCONNECTED]: { reason: 'channel_disconnected' },
  [ERROR_CODES.SERVICE_WINDOW_CLOSED]: { reason: 'service_window_closed' },
  [ERROR_CODES.CHANNEL_CAPABILITY_UNSUPPORTED]: { reason: 'channel_capability_unsupported' },
  [ERROR_CODES.AUTH_SEND_HALTED]: { reason: 'send_blocked' },
  [ERROR_CODES.AUTH_SEND_BLOCKED]: { reason: 'send_blocked' },
};

/**
 * `POST /messages` (TW-API-110, 118, 119): one WhatsApp message to one number, through the SAME pipeline the inbox sends with, so a send
 * from the API is guarded, queued, counted and receipted exactly like a send from the dashboard.
 *
 *  1. the sender is resolved (`sender-resolution.ts`) and must carry WhatsApp;
 *  2. a file is taken in (upload, URL or one of our own links) through the platform's media store;
 *  3. `{{merge tags}}` in the text are filled from the contact that owns the number (an unknown tag becomes empty, never raw braces);
 *  4. the number's thread is found, or opened (a contact is found or created for the number, as for every number the workspace messages);
 *  5. text and files are queued on that thread (`enqueueOutbound`); a location pin goes straight through the dispatcher, because the
 *     inbox's send has no location content, and is recorded on the thread afterwards.
 *
 * The answer is Reference's: `to` and `body` echo what was sent, the type is the one asked for or inferred.
 */
@Injectable()
export class MessageSendService {
  private readonly logger = new Logger(MessageSendService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MessagingRepository,
    private readonly reads: MessagingReadService,
    private readonly intake: MediaIntakeService,
    private readonly channelsFacade: ChannelsFacade,
    private readonly channels: ChannelRegistryService,
    private readonly dispatcher: ChannelDispatcher,
    private readonly contactResolver: ContactResolverService,
    private readonly contacts: ContactsRepository,
    private readonly merge: MergeTagService,
    @Inject(CONVERSATIONS_FACADE) private readonly conversations: ConversationsFacade,
  ) {}

  async send(input: V1SendMessageInput, file: UploadedFile | undefined): Promise<V1Message> {
    const orgId = RequestContextStore.orgId();

    if (missingMedia(input, Boolean(file))) {
      throw v1Error(
        'media_required',
        'Attach a `media` file (multipart) or provide a `media_url` when type is image, video, document or audio.',
      );
    }

    const digits = digitsOf(input.to);
    if (digits === '') throw sendFailed('Invalid recipient number.');

    const sender = await this.resolveSender(orgId, input.device_id ?? null);
    const peerKey = normalizePeerKey(sender.kind, digits);
    if (!peerKey) throw sendFailed('Invalid recipient number.');

    const pin = hasCoordinates(input);
    let media: StoredMedia | null = null;
    // A pin wins over any file (Reference's dispatcher checked the coordinates first), so a file sent with one is not stored at all.
    if (!pin && wantsMedia(input, Boolean(file))) {
      media = file ? await this.intake.fromFile(file) : await this.intake.fromUrl(input.media_url!);
    }

    const body = await this.withMergeTags(orgId, digits, input.text ?? '');
    if (body === '' && !media && !pin) throw sendFailed('empty_message');

    const messageUuid = pin
      ? await this.sendPin(
          orgId,
          sender.channelUuid,
          peerKey,
          digits,
          input.latitude!,
          input.longitude!,
        )
      : await this.queue(orgId, sender.channelUuid, peerKey, digits, media, body);

    const settled = pin ? await this.read(messageUuid) : await this.settle(messageUuid);
    return {
      ...settled,
      // Reference echoed the caller's own `to` and `text` and the type it asked for or inferred.
      to: input.to,
      body: input.text ?? null,
      type: reportedType(input, media),
    };
  }

  // --- the sender ---------------------------------------------------------------------------------------------------------------

  private async resolveSender(
    orgId: number,
    deviceId: string | null,
  ): Promise<{ channelUuid: string; kind: string }> {
    const { senders, others } = await this.db.tx(async (tx) => ({
      senders: await this.repo.senders(tx, orgId),
      others: (await this.channelsFacade.list(tx, orgId)).map((c): OtherChannel => ({
        uuid: c.uuid,
        kind: c.kind,
        connected: c.status === 'connected',
      })),
    }));
    const choice = resolveSender(senders, others, deviceId);
    if (choice.outcome === 'wrong_channel') throw sendFailed('wrong_channel');
    if (choice.outcome === 'unlinked' || choice.outcome === 'none')
      throw sendFailed('no_connected_device');
    if (!SEND_CHANNEL_KINDS.has(choice.kind)) throw sendFailed('wrong_channel');
    return { channelUuid: choice.channelUuid, kind: choice.kind };
  }

  // --- the text -----------------------------------------------------------------------------------------------------------------

  /** TW-CON-048: the recipient's contact, then workspace defaults, then the system tokens. Resolved before the empty check, as Reference did. */
  private async withMergeTags(orgId: number, digits: string, text: string): Promise<string> {
    const trimmed = text.trim();
    if (!trimmed.includes('{{')) return trimmed;
    const cc = await this.contactResolver.defaultCountryCode();
    const phone = canonicalizeLocalPhone(`+${digits}`, cc);
    return this.db.tx(async (tx) => {
      const contactId = phone
        ? await this.contacts.findByIdentity(tx, orgId, 'phone', phone.e164)
        : undefined;
      const contact =
        contactId === undefined ? undefined : await this.merge.contactFor(tx, orgId, contactId);
      const base = await this.merge.baseContext(tx, orgId);
      return this.merge.render(trimmed, contact, base).rendered.trim();
    });
  }

  // --- text and files: the inbox's own send -------------------------------------------------------------------------------------

  private async queue(
    orgId: number,
    channelUuid: string,
    peerKey: string,
    digits: string,
    media: StoredMedia | null,
    body: string,
  ): Promise<string> {
    const thread = await this.threadFor(orgId, channelUuid, peerKey, digits);
    const content: EnqueueOutboundInput['content'] = media
      ? {
          kind: 'media',
          media: {
            key: media.key,
            mime: media.mime,
            size: media.size,
            name: media.name,
            sha256: media.sha256,
          },
          ...(body ? { caption: body } : {}),
        }
      : { kind: 'text', body };
    try {
      const queued = await this.conversations.enqueueOutbound({
        conversationId: thread,
        // Reference had no idempotency: a retry sends again. The caller's `Idempotency-Key` header, when sent, is honoured by the route.
        clientMessageId: randomUUID(),
        content,
        sender: { kind: 'bot' },
      });
      return queued.message.id;
    } catch (err) {
      throw this.refusal(err);
    }
  }

  /** The thread of this number on this channel: the existing one, or a new one opened for the contact that owns the number. */
  private async threadFor(
    orgId: number,
    channelUuid: string,
    peerKey: string,
    digits: string,
  ): Promise<string> {
    const existing = await this.conversations.findThread(channelUuid, peerKey);
    if (existing) return existing.id;

    const link = await this.db.tx((tx) =>
      this.contactResolver.findOrCreateByPhone(tx, orgId, { phone: `+${digits}`, source: 'api' }),
    );
    if (link.outcome === 'skipped') {
      if (link.reason === 'plan_limit_reached') {
        throw new AppError(
          ERROR_CODES.PLAN_LIMIT_REACHED,
          'The workspace has reached its contacts limit.',
          402,
        );
      }
      if (link.reason === 'error') throw sendFailed('Failed to process message.', 500);
      throw sendFailed('Invalid recipient number.');
    }
    return (await this.conversations.openConversationFor(link.contactUuid, channelUuid)).id;
  }

  // --- a location pin -----------------------------------------------------------------------------------------------------------

  private async sendPin(
    orgId: number,
    channelUuid: string,
    peerKey: string,
    digits: string,
    latitude: number,
    longitude: number,
  ): Promise<string> {
    const { runtime, lastInboundAt } = await this.db.tx(async (tx) => ({
      runtime: await this.channels.runtime(
        tx,
        orgId,
        await this.channels.row(tx, orgId, channelUuid),
      ),
      lastInboundAt:
        (await this.conversations.findThread(channelUuid, peerKey))?.lastInboundAt ?? null,
    }));
    try {
      const sent = await this.dispatcher.send({
        channel: runtime,
        envelope: {
          to: peerKey,
          clientReference: `api:${randomUUID()}`,
          kind: 'location',
          location: { latitude, longitude },
        },
        lastInboundAt,
        source: 'api',
        // A location pin is a free-form reply: it only goes through while the window is open, so it is service.
        consent: { purpose: 'service_messaging' },
      });
      if (!sent.replayed) await this.dispatcher.scheduleReceipts(runtime, sent);
      const recorded = await this.conversations.recordOutbound({
        channelId: channelUuid,
        peerKey,
        source: 'bot',
        body: pinText(latitude, longitude),
        providerMessageId: sent.providerMessageId,
      });
      return recorded.messageId;
    } catch (err) {
      if (err instanceof ChannelError) throw sendFailed(err.code.toLowerCase());
      throw this.refusal(err);
    }
  }

  // --- the answer ---------------------------------------------------------------------------------------------------------------

  /** Waits (briefly) until the worker has taken the message off the queue, then reads it. */
  private async settle(uuid: string): Promise<V1Message> {
    const orgId = RequestContextStore.orgId();
    const deadline = Date.now() + SETTLE_WAIT_MS;
    for (;;) {
      const status = await this.db.tx((tx) => this.repo.statusOfMessage(tx, orgId, uuid));
      if ((status !== null && status !== 'queued') || Date.now() >= deadline) break;
      await sleep(SETTLE_POLL_MS);
    }
    return this.read(uuid);
  }

  private async read(uuid: string): Promise<V1Message> {
    const orgId = RequestContextStore.orgId();
    const row = await this.db.tx((tx) => this.repo.messageByUuid(tx, orgId, uuid));
    if (!row) {
      this.logger.error({ orgId, uuid }, 'a message that was just stored cannot be read');
      throw sendFailed('Failed to process message.', 500);
    }
    return this.reads.messageOf(row);
  }

  private refusal(err: unknown): unknown {
    if (!(err instanceof AppError)) return err;
    const known = REFUSALS[err.code];
    return known ? sendFailed(known.reason, known.status) : err;
  }
}
