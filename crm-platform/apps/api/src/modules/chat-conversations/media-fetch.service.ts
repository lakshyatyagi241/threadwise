import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ERROR_CODES, type MessageResponse } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import type { ChannelRuntime } from '../../infra/providers/chat-conversations';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import {
  MEDIA_FAILURE,
  MediaFetchError,
  type InboundMediaFetcher,
} from '../../infra/providers/whatsapp/media';
import { ChannelAdapterRegistry } from './channel-adapter.registry';
import { ChannelRegistryService } from './channel-registry.service';
import { ChannelsRepository } from './channels.repository';
import { ChatRealtimePublisher } from './chat-realtime.publisher';
import { ConversationsRepository, type ConversationRow } from './conversations.repository';
import { mediaFetchRequestSchema, type MediaFetchRequest } from './media-fetch.job';
import { MediaFetchPublisher } from './media-fetch.publisher';
import { MessageViewService } from './message-view.service';
import { MessagesRepository, type MessageRow } from './messages.repository';

export type MediaFetchOutcome =
  /** The file was stored and the message updated. */
  | 'stored'
  /** Nothing to do: the message is finished, failed, on a newer generation, or another worker finished it first. */
  | 'skipped'
  | 'missing'
  /** The file could not be had and the message now says so (a permanent refusal, or the last attempt). */
  | 'failed';

export interface MediaFetchRunOptions {
  /** The generation the job was created for (see `mediaFetchJobSchema`). */
  generation: number;
  /** 1 on the first attempt of this run. */
  attempt: number;
  /** The queue will not try again: a retryable error ends the file `failed` instead of being rethrown. */
  finalAttempt: boolean;
}

interface Loaded {
  row: MessageRow;
  conv: ConversationRow;
  runtime: ChannelRuntime;
  fetcher: InboundMediaFetcher | undefined;
  request: MediaFetchRequest | null;
}

/**
 * The background half of an inbound media message (plan-inbox-chat.md Phase 2). Ingest stores the customer's message at once with
 * `meta.mediaStatus = 'pending'`; the `media-fetch` worker calls `run` to copy the file from the provider into the store and finish
 * the message, or to say it could not.
 *
 * Idempotent and kill-safe by construction: the work is decided by the message row, never by the job. `run` does nothing for a message
 * that is not pending (a duplicate job, a finished one, a failed one waiting for a Retry) or whose generation moved on; the final
 * write is one conditional UPDATE (`pending AND media_key IS NULL`), so two workers that both downloaded the file cannot both win and
 * the loser removes its own copy. A worker killed mid-download leaves the message pending (BullMQ's stalled-job recovery, or the
 * recovery sweep, runs it again) and a half-written spool file that the sweep deletes; a worker killed between storing the file and the
 * UPDATE leaves one orphan object in the store (a small leak, never a wrong message).
 *
 * Failure is data on the message, not an exception in a log: a retryable error (network, 5xx, a checksum mismatch) is rethrown to the
 * queue's backoff; a permanent one, or the last attempt, sets `mediaStatus = 'failed'` with a code and a reason, tells the open thread,
 * and keeps the request on the row so the agent's Retry can start over.
 */
@Injectable()
export class MediaFetchService {
  private readonly logger = new Logger(MediaFetchService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessagesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly channelsRepo: ChannelsRepository,
    private readonly channels: ChannelRegistryService,
    private readonly adapters: ChannelAdapterRegistry,
    private readonly media: ChatMediaStore,
    private readonly realtime: ChatRealtimePublisher,
    private readonly publisher: MediaFetchPublisher,
    private readonly view: MessageViewService,
  ) {}

  async run(
    orgId: number,
    messageUuid: string,
    options: MediaFetchRunOptions,
  ): Promise<MediaFetchOutcome> {
    const loaded = await this.load(orgId, messageUuid, options.generation);
    if (loaded === 'missing' || loaded === 'skipped') return loaded;
    const { row, conv, runtime, fetcher, request } = loaded;
    const ref = { id: row.id, createdAt: row.createdAtText };

    if (!fetcher || !request) {
      return this.fail(
        orgId,
        row,
        conv,
        new MediaFetchError(
          MEDIA_FAILURE.UNEXPECTED,
          'This message has no file request to follow up.',
          false,
        ),
        options,
      );
    }

    let stored;
    try {
      stored = await fetcher.fetchAndStore({
        channel: runtime,
        mediaId: request.providerMediaId,
        mediaKind: request.mediaKind,
        declaredMime: request.mime,
        sha256: request.sha256 ?? null,
        filename: request.name ?? null,
        ref: row.uuid,
      });
    } catch (err) {
      return this.fail(orgId, row, conv, err, options);
    }

    let won: boolean;
    try {
      won = await this.db.txAs({ orgId }, (tx) =>
        this.messages.markMediaStored(tx, orgId, ref, stored),
      );
    } catch (err) {
      // The file is stored but the message could not be told: the copy is an orphan, so remove it and let the queue try again.
      await this.media.remove(orgId, stored.key).catch(() => undefined);
      throw err;
    }
    if (!won) {
      await this.media.remove(orgId, stored.key).catch(() => undefined);
      return 'skipped';
    }

    await this.announce(orgId, row, conv);
    return 'stored';
  }

  /**
   * The agent's Retry on a message whose file failed (`POST /inbox/messages/:id/retry`). Returns null when the message is not an inbound
   * one (the caller then treats it as an outbound retry); refuses an inbound message that has no failed file.
   */
  async retryIfInbound(messageUuid: string): Promise<MessageResponse | null> {
    const ctx = RequestContextStore.require();
    const orgId = ctx.orgId;

    const done = await this.db.tx(async (tx) => {
      const found = await this.messages.byUuid(tx, orgId, messageUuid);
      if (!found || found.direction !== 'in') return null;
      const conv = (await this.conversations.byId(tx, orgId, found.conversationId, true))!;
      const ref = { id: found.id, createdAt: found.createdAtText };
      const requeued = await this.messages.requeueMedia(tx, orgId, ref);
      if (!requeued) {
        throw new AppError(
          ERROR_CODES.MESSAGE_NOT_RETRYABLE,
          'Only a message whose file failed to download can be retried',
          HttpStatus.CONFLICT,
        );
      }
      return {
        row: (await this.messages.byId(tx, orgId, ref.id, ref.createdAt))!,
        conv,
        generation: requeued.generation,
      };
    });
    if (!done) return null;

    await this.publisher.enqueue(orgId, done.row.uuid, done.generation);
    await this.announce(orgId, done.row, done.conv);
    return this.view.respond(done.row);
  }

  // --- stages --------------------------------------------------------------------------------------------------------------------

  private async load(
    orgId: number,
    messageUuid: string,
    generation: number,
  ): Promise<'missing' | 'skipped' | Loaded> {
    return this.db.txAs({ orgId }, async (tx) => {
      const row = await this.messages.byUuid(tx, orgId, messageUuid);
      if (!row || row.direction !== 'in') return 'missing' as const;
      if (row.mediaKey !== null || row.meta.mediaStatus !== 'pending') return 'skipped' as const;
      if (Number(row.meta.mediaGen ?? 1) !== generation) return 'skipped' as const;

      const conv = (await this.conversations.byId(tx, orgId, row.conversationId))!;
      const channel = (await this.channelsRepo.byId(tx, orgId, conv.channelId))!;
      const runtime = await this.channels.runtime(tx, orgId, channel);
      const parsed = mediaFetchRequestSchema.safeParse(row.meta.mediaFetch);
      return {
        row,
        conv,
        runtime,
        fetcher: this.adapters.find(channel.kind)?.inboundMedia,
        request: parsed.success ? parsed.data : null,
      };
    });
  }

  /**
   * What a failed fetch means. A retryable error goes back to the queue (backoff), unless this was the last attempt; anything else ends
   * the file `failed` with a code and reason (no stack, no token, no signed address: `MediaFetchError` messages are safe to show).
   */
  private async fail(
    orgId: number,
    row: MessageRow,
    conv: ConversationRow,
    err: unknown,
    options: MediaFetchRunOptions,
  ): Promise<MediaFetchOutcome> {
    const known = err instanceof MediaFetchError ? err : null;
    const retryable = known ? known.retryable : true;
    if (retryable && !options.finalAttempt) throw err;

    const code = known?.code ?? MEDIA_FAILURE.UNEXPECTED;
    const reason = (
      known
        ? retryable
          ? `${known.message} (gave up after ${options.attempt} attempts)`
          : known.message
        : 'The file could not be downloaded.'
    ).slice(0, 500);
    if (!known) {
      this.logger.error(
        { orgId, message: row.uuid, err: (err as Error).message },
        'media fetch crashed',
      );
    }

    const ref = { id: row.id, createdAt: row.createdAtText };
    const moved = await this.db.txAs({ orgId }, (tx) =>
      this.messages.markMediaFailed(tx, orgId, ref, { code, reason, attempts: options.attempt }),
    );
    if (!moved) return 'skipped';
    this.logger.warn({ orgId, message: row.uuid, code }, 'inbound media failed');
    await this.announce(orgId, row, conv);
    return 'failed';
  }

  /** Tells the open thread (and the list) that this message changed: the client fetches the page again and gets the file's link. */
  private async announce(orgId: number, row: MessageRow, conv: ConversationRow): Promise<void> {
    const fresh = await this.db.txAs({ orgId }, async (tx) => ({
      message: await this.messages.byId(tx, orgId, row.id, row.createdAtText),
      conv: await this.conversations.byId(tx, orgId, conv.id),
    }));
    if (!fresh.message || !fresh.conv) return;
    await this.realtime.messageUpdated(orgId, fresh.conv, fresh.message, ['media']);
  }
}
