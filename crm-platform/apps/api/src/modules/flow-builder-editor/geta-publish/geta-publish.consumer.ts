import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { GetaPublishStep } from '@crm/contracts';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  BOT_PUBLISH_PORT,
  BotPublishError,
  STEP_LABEL,
  sanitizeRemoteText,
  type BotPublishPort,
} from '../../../infra/providers/flow-builder-editor/bot-publish.port';
import {
  OutboxSubscriberRegistry,
  type OutboxEvent,
  type OutboxSubscriber,
} from '../../../kernel/outbox/outbox-subscribers';
import { recordForUpdate } from './geta-record';
import { GetaPublishRepository } from './geta-publish.repository';
import { GetaPublishSettingsService, type PushMaterial } from './geta-publish-settings.service';
import { GETA_PUBLISH_REQUESTED } from './geta-publish-sync.service';

interface Claim {
  syncId: number;
  version: number;
  startAt: GetaPublishStep;
  material: PushMaterial;
}

/**
 * Pushes a published flow's bot live on the Geta console (worker process). It reacts to `flow.geta_publish_requested` and makes
 * the two calls through BOT_PUBLISH_PORT, in order: the configuration update, then publish-bot. The flow is `live` only when both
 * answered 2xx.
 *
 * - A remote failure never throws out of `handle`: it is written to the sync row (`failed`, the step, a sanitised message) and the
 *   event is done, so the user sees it and presses Retry; the outbox's own retry is kept for failures of OUR database.
 * - Idempotent per publish version: an event for an older version, or for a row that is no longer `pending` (already live, already
 *   failed, delivered twice), does nothing. A later publish of the flow supersedes a push still running: the old run's writes match
 *   no row.
 * - Resumes: when the configuration update already succeeded for this version, the run starts at publish-bot.
 * - Secrets are decrypted for the length of the run, never logged, and never reach the error text (`sanitizeRemoteText`).
 */
@Injectable()
export class GetaPublishConsumer implements OutboxSubscriber, OnModuleInit {
  readonly name = 'flb-geta-publish';
  readonly eventTypes = [GETA_PUBLISH_REQUESTED] as const;
  private readonly logger = new Logger(GetaPublishConsumer.name);

  constructor(
    private readonly registry: OutboxSubscriberRegistry,
    private readonly db: DatabaseService,
    private readonly repo: GetaPublishRepository,
    private readonly settings: GetaPublishSettingsService,
    @Inject(BOT_PUBLISH_PORT) private readonly port: BotPublishPort,
  ) {}

  /** Tests may replace it; production reads the system clock. */
  now: () => Date = () => new Date();

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handle(event: OutboxEvent): Promise<void> {
    const orgId = event.orgId;
    const flowId = Number(event.aggregateId);
    const version = Number(event.payload.publishVersion);
    if (!Number.isInteger(flowId) || !Number.isInteger(version)) return;

    const claim = await this.claim(orgId, flowId, version);
    if (!claim) return;

    const { credentials, record, botId } = claim.material;
    const secrets = [credentials.authorization, credentials.getaHost];
    let step: GetaPublishStep = claim.startAt;
    try {
      if (claim.startAt === 'configuration_update') {
        await this.port.updateChatbotConfiguration(credentials, {
          chatbotId: record.id,
          chatbot: recordForUpdate(record, this.now()),
        });
        await this.db.txAs({ orgId }, (tx) =>
          this.repo.markConfigurationDone(tx, orgId, claim.syncId, version),
        );
        step = 'publish_bot';
      }
      await this.port.publishBot(credentials, { botId });
      await this.db.txAs({ orgId }, (tx) => this.repo.markLive(tx, orgId, claim.syncId, version));
      this.logger.log({ orgId, flowId, version }, 'flow is live on the Geta console');
    } catch (err) {
      const failedStep = err instanceof BotPublishError ? err.step : step;
      const message =
        err instanceof BotPublishError
          ? err.message
          : `Unexpected error (${STEP_LABEL[failedStep]}): ${sanitizeRemoteText(
              err instanceof Error ? err.message : String(err),
              secrets,
              120,
            )}`;
      await this.db.txAs({ orgId }, (tx) =>
        this.repo.markFailed(tx, orgId, claim.syncId, version, failedStep, message),
      );
      this.logger.warn(
        {
          orgId,
          flowId,
          version,
          step: failedStep,
          status: (err as BotPublishError).detail?.status,
        },
        'publish to the Geta console failed',
      );
    }
  }

  /** Decides in one transaction whether there is anything to do, and what the credentials are. */
  private async claim(orgId: number, flowId: number, version: number): Promise<Claim | null> {
    return this.db.txAs({ orgId }, async (tx) => {
      const sync = await this.repo.findSync(tx, orgId, flowId, true);
      // Stale (a newer publish exists), delivered twice, or already settled: nothing to do.
      if (!sync || sync.publishVersion !== version || sync.state !== 'pending') return null;
      const loaded = await this.settings.material(tx, orgId, sync.chatbotOverrideEnc);
      const startAt: GetaPublishStep =
        sync.configurationUpdatedVersion === version ? 'publish_bot' : 'configuration_update';
      if (!loaded.ok) {
        await this.repo.markFailed(
          tx,
          orgId,
          sync.id,
          version,
          startAt,
          loaded.reason === 'not_configured'
            ? 'Geta publishing is no longer set up for this workspace.'
            : 'The stored Geta credentials could not be read. Save them again in settings.',
        );
        return null;
      }
      await this.repo.markRunning(tx, orgId, sync.id, version, startAt, loaded.material.botId);
      return { syncId: sync.id, version, startAt, material: loaded.material };
    });
  }
}
