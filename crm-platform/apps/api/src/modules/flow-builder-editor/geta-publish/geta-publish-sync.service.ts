import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type FlowGetaSync,
  type GetaPublishStep,
  type GetaSyncState,
  type SetFlowGetaChatbotRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { FlowsRepository, type FlowRow } from '../flows.repository';
import { GetaPublishRepository, type SyncRow } from './geta-publish.repository';
import { GETA_SETTINGS_MODULE, GetaPublishSettingsService } from './geta-publish-settings.service';

/** The outbox event that asks the worker to push a flow. `publishVersion` makes a redelivery harmless. */
export const GETA_PUBLISH_REQUESTED = 'flow.geta_publish_requested';

type FlowRef = Pick<FlowRow, 'id' | 'uuid' | 'isPublished'>;

const conflict = (message: string): AppError =>
  new AppError(ERROR_CODES.FLB_GETA_NOT_RETRYABLE, message, HttpStatus.CONFLICT);

/**
 * The request side of Geta publishing: what happens inside the transaction of a publish, the read of a flow's remote state, the
 * retry and the per-flow record. The calls to Geta are never made here: a publish only writes the sync row and an outbox event
 * (the worker's `GetaPublishConsumer` makes the calls), so a console that is down cannot fail or slow the local publish.
 */
@Injectable()
export class GetaPublishSyncService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: GetaPublishRepository,
    private readonly flows: FlowsRepository,
    private readonly settings: GetaPublishSettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Called inside the publish transaction after the flow row is published. With credentials: a new publish version, the row
   * `pending`, and an outbox event in the same transaction. Without: the row (if any) starts over as `idle`, so the editor says
   * "set up Geta publishing" and not the state of an earlier publish.
   */
  async onPublished(tx: Tx, orgId: number, flow: FlowRef): Promise<void> {
    const prior = await this.repo.findSync(tx, orgId, flow.id);
    const configured = this.settings.hasEverything(
      await this.repo.findSettings(tx, orgId),
      prior?.chatbotOverrideEnc ?? null,
    );
    if (!configured) {
      if (prior) await this.repo.beginPublish(tx, orgId, flow.id, 'idle');
      return;
    }
    const sync = await this.repo.beginPublish(tx, orgId, flow.id, 'pending');
    await this.emit(tx, orgId, flow, sync.publishVersion, false);
  }

  /** The remote state shown next to the Published badge. */
  async status(tx: Tx, orgId: number, flow: FlowRef): Promise<FlowGetaSync> {
    const [sync, settings] = await Promise.all([
      this.repo.findSync(tx, orgId, flow.id),
      this.repo.findSettings(tx, orgId),
    ]);
    const override = sync?.chatbotOverrideEnc ?? null;
    const configured = this.settings.hasEverything(settings, override);
    const base = {
      configured,
      chatbotOverride: this.settings.summarize(override),
    };
    if (!sync || sync.state === 'idle') {
      const botId = this.settings.summarize(override ?? settings?.chatbotRecordEnc ?? null)?.botId;
      return {
        ...base,
        state: flow.isPublished && !configured ? 'not_configured' : 'none',
        step: null,
        failedStep: null,
        lastError: null,
        attemptedAt: sync?.attemptedAt?.toISOString() ?? null,
        botId: botId ?? null,
        publishVersion: sync ? sync.publishVersion : null,
      };
    }
    return {
      ...base,
      state: sync.state as GetaSyncState,
      step: sync.step,
      failedStep: sync.failedStep,
      lastError: sync.lastError,
      attemptedAt: sync.attemptedAt ? sync.attemptedAt.toISOString() : null,
      botId: sync.botId,
      publishVersion: sync.publishVersion,
    };
  }

  async get(uuid: string): Promise<FlowGetaSync> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      this.status(tx, ctx.orgId, await this.requireFlow(tx, ctx.orgId, uuid)),
    );
  }

  /**
   * Pushes again: from the step that failed (the configuration update is not repeated when it already succeeded for this publish),
   * or, for a published flow that was never pushed (credentials were added afterwards), as a new publish version.
   */
  async retry(uuid: string): Promise<FlowGetaSync> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const flow = await this.requireFlow(tx, ctx.orgId, uuid, true);
      if (!flow.isPublished) throw conflict('Publish the flow first.');
      const sync = await this.repo.findSync(tx, ctx.orgId, flow.id, true);
      const configured = this.settings.hasEverything(
        await this.repo.findSettings(tx, ctx.orgId),
        sync?.chatbotOverrideEnc ?? null,
      );
      if (!configured)
        throw new AppError(
          ERROR_CODES.FLB_GETA_NOT_CONFIGURED,
          'Set up Geta publishing in settings first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      if (sync && (sync.state === 'pending' || sync.state === 'live'))
        throw conflict(
          sync.state === 'live'
            ? 'This flow is already live on Geta.'
            : 'The push to Geta is already in progress.',
        );
      let version: number;
      if (sync && sync.state === 'failed') {
        const step: GetaPublishStep = sync.failedStep ?? 'configuration_update';
        await this.repo.resume(tx, ctx.orgId, sync.id, step);
        version = sync.publishVersion;
      } else {
        version = (await this.repo.beginPublish(tx, ctx.orgId, flow.id, 'pending')).publishVersion;
      }
      await this.emit(tx, ctx.orgId, flow, version, true);
      return this.status(tx, ctx.orgId, flow);
    });
  }

  /** Sets or removes this flow's own Geta chatbot record (it replaces the workspace one for this flow). */
  async setChatbot(uuid: string, input: SetFlowGetaChatbotRequest): Promise<FlowGetaSync> {
    const ctx = RequestContextStore.require();
    const sealed =
      input.chatbotRecord === null || input.chatbotRecord.trim() === ''
        ? null
        : this.settings.sealRecord(input.chatbotRecord);
    return this.db.tx(async (tx) => {
      const flow = await this.requireFlow(tx, ctx.orgId, uuid, true);
      const before = await this.repo.findSync(tx, ctx.orgId, flow.id);
      await this.repo.setOverride(tx, ctx.orgId, flow.id, sealed);
      await this.audit.record(tx, {
        module: GETA_SETTINGS_MODULE,
        recordId: flow.id,
        action: 'update',
        delta: {
          flowChatbotRecord: {
            old: before?.chatbotOverrideEnc ? 'set' : 'not set',
            new: sealed ? 'set' : 'not set',
          },
        },
      });
      return this.status(tx, ctx.orgId, flow);
    });
  }

  private async emit(
    tx: Tx,
    orgId: number,
    flow: FlowRef,
    publishVersion: number,
    retry: boolean,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      orgId,
      aggregateModule: 'flows',
      aggregateId: flow.id,
      eventType: GETA_PUBLISH_REQUESTED,
      payload: { uuid: flow.uuid, publishVersion, retry },
    });
  }

  private async requireFlow(tx: Tx, orgId: number, uuid: string, lock = false): Promise<FlowRow> {
    const row = await this.flows.findByUuid(tx, orgId, uuid, lock);
    if (!row) throw AppError.notFound('Flow', uuid);
    return row;
  }
}

export type { SyncRow };
