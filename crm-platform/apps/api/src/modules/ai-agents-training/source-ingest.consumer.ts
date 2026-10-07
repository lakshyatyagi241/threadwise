import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import {
  TRAINING_URL_FETCHER,
  type TrainingUrlFetcher,
} from '../../infra/providers/ai-agents-training/training-url-fetcher.port';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../kernel/outbox/outbox-subscribers';
import { SOURCE_REQUESTED } from './source-events';
import { SourcesRepository } from './sources.repository';
import { isBinaryText, pageText, tokensEstimate } from './training-rules';

/**
 * Reads a URL knowledge entry (worker process). It reacts to `ai_training_source.requested`, fetches the page through the SSRF-safe
 * fetcher port and settles the entry: `ready` with the text and its token estimate, or `failed` with the reason the person sees.
 *
 * - A refusal or a dead page never throws out of `handle`: it is written to the entry (`failed`) and the event is done; the outbox's
 *   own retry is kept for failures of OUR database.
 * - Idempotent: only an entry still `processing` is settled, so a redelivered event, or one for an entry deleted meanwhile, does
 *   nothing the second time.
 * - The page is fetched with no transaction open: a slow host must not hold a database connection.
 */
@Injectable()
export class SourceIngestConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'aiag-source-ingest';
  readonly eventTypes = [SOURCE_REQUESTED] as const;
  private readonly logger = new Logger(SourceIngestConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly repo: SourcesRepository,
    @Inject(TRAINING_URL_FETCHER) private readonly fetcher: TrainingUrlFetcher,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const orgId = event.orgId;
    const sourceId = Number(event.aggregateId);
    if (!Number.isInteger(sourceId)) return;

    const source = await this.db.txAs({ orgId }, (tx) => this.repo.findById(tx, orgId, sourceId));
    if (!source || source.status !== 'processing' || source.kind !== 'url' || !source.url) return;

    const fetched = await this.fetcher.fetch(source.url);
    let outcome: Parameters<SourcesRepository['finish']>[3];
    if (!fetched.ok) {
      outcome = { status: 'failed', content: null, tokensEstimate: null, error: fetched.error };
    } else if (isBinaryText(fetched.body)) {
      outcome = {
        status: 'failed',
        content: null,
        tokensEstimate: null,
        error: 'fetched page contained no text',
      };
    } else {
      const text = pageText(fetched.body);
      outcome =
        text === ''
          ? {
              status: 'failed',
              content: null,
              tokensEstimate: null,
              error: 'fetched page contained no text',
            }
          : {
              status: 'ready',
              content: text,
              tokensEstimate: tokensEstimate(text.length),
              error: null,
            };
    }
    const settled = await this.db.txAs({ orgId }, (tx) =>
      this.repo.finish(tx, orgId, sourceId, outcome),
    );
    if (settled) this.logger.log({ orgId, status: outcome.status }, 'knowledge page read');
  }
}
