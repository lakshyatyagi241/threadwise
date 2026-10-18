import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { UnrecoverableError, type Queue } from 'bullmq';
import { CryptoService } from '../../common/crypto/crypto.service';
import { openJson, sealJson } from '../../common/crypto/sealed-json';
import { QUEUES } from '../../infra/queue/queues';

export type WebhookRetryHandler = (payload: never) => Promise<void>;

export interface WebhookRetryJob {
  channel: string;
  /** The payload as JSON, sealed with the credentials key (AES-256-GCM): Redis never holds the message text (ASYNC-075/079). */
  sealed: string;
}

/**
 * A durable second chance for an inbound webhook event that could not be stored (ASYNC-011/017/018).
 *
 * The channel webhooks (Telegram, Viber, LINE, Facebook) store a message inline. When that fails after the request was authenticated,
 * the channel hands the event to {@link defer} and still answers 200: the event is kept in the `webhook-retry` queue and retried with
 * backoff for about 40 minutes, then kept as a failed job an operator can replay. If {@link defer} itself fails (Redis is down) nothing
 * was kept, so the webhook must answer 503 and let the provider redeliver.
 *
 * A channel registers one handler (by name) that re-runs the part of its ingest that failed; it must be safe to run twice, as the inbox
 * writes already are. Registered handlers live in the worker process through the same module graph the HTTP app uses.
 */
@Injectable()
export class WebhookRetryService {
  private readonly handlers = new Map<string, WebhookRetryHandler>();

  constructor(
    @InjectQueue(QUEUES.WEBHOOK_RETRY) private readonly queue: Queue<WebhookRetryJob>,
    private readonly crypto: CryptoService,
  ) {}

  register<P>(channel: string, handler: (payload: P) => Promise<void>): void {
    this.handlers.set(channel, handler as WebhookRetryHandler);
  }

  async defer(channel: string, payload: unknown): Promise<void> {
    await this.queue.add('retry', {
      channel,
      sealed: sealJson(this.crypto, payload),
    });
  }

  async run(channel: string, sealed: string): Promise<void> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new UnrecoverableError(`No webhook retry handler for "${channel}"`);
    let payload: unknown;
    try {
      payload = openJson(this.crypto, sealed);
    } catch {
      // A blob that does not open (a rotated-away key, a corrupt value) opens no better on the next attempt.
      throw new UnrecoverableError('Webhook retry payload could not be opened');
    }
    await handler(payload as never);
  }
}
