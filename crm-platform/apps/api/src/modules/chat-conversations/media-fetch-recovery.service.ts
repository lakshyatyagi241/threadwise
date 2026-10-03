import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DatabaseService } from '../../infra/db/database.service';
import { ChatMediaStore } from '../../infra/providers/chat-conversations/media';
import { MediaFetchPublisher } from './media-fetch.publisher';
import { MessagesRepository } from './messages.repository';

/** A file is overdue when its message has been pending this long: a download plus every backoff normally ends well before. */
const OVERDUE_SECONDS = 15 * 60;
/** Older than this is not recovered: Meta's media ids expire after about 30 days, and a message this old is for the Retry button. */
const MAX_AGE_HOURS = 48;
const BATCH = 200;
/** A spool file untouched for this long belongs to a worker that died mid-download. */
const SPOOL_STALE_MS = 60 * 60_000;

/**
 * Recovery for inbound files whose job was lost: the process died between the message's commit and the enqueue, Redis lost the job, or
 * the job ran out of attempts without the service recording the failure (a crash loop). Every minute it looks for messages still
 * `pending` after 15 minutes (the partial index `idx_messages_media_pending` serves it) and puts them on the queue again. It also deletes
 * spool files that no live download is writing.
 *
 * Safe to run on every worker and to repeat: the job id is fixed per message and generation, so a live job is left alone, and the work
 * is idempotent. Runs privileged (it spans every workspace by definition). Imported by WorkersModule only.
 */
@Injectable()
export class MediaFetchRecoveryService {
  private readonly logger = new Logger(MediaFetchRecoveryService.name);
  private readonly messages = new MessagesRepository();
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly publisher: MediaFetchPublisher,
    private readonly media: ChatMediaStore,
  ) {}

  @Interval(60_000)
  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sweep();
      if (n > 0) this.logger.log({ requeued: n }, 'recovered pending media downloads');
      await this.media.sweepSpool(SPOOL_STALE_MS);
    } catch (err) {
      this.logger.error({ err }, 'media fetch recovery failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. Returns how many messages were put back on the queue. */
  async sweep(overdueSeconds = OVERDUE_SECONDS): Promise<number> {
    const stale = await this.db.privileged((tx) =>
      this.messages.stalePendingMedia(tx, overdueSeconds, MAX_AGE_HOURS, BATCH),
    );
    let requeued = 0;
    for (const m of stale) {
      if (await this.publisher.requeue(m.orgId, m.uuid, m.generation)) requeued += 1;
    }
    return requeued;
  }
}
