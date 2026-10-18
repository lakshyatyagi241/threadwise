import { Injectable } from '@nestjs/common';
import {
  faqRecommendedThreshold,
  type FaqSettings,
  type UpdateFaqSettingsInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { FaqConfigService } from './faq-config.service';
import { FaqLogRepository } from './faq-log.repository';
import { FaqRepository } from './faq.repository';

export interface EffectiveSettings {
  enabled: boolean;
  threshold: number;
  minMargin: number;
  logQueries: boolean;
  verifyMode: 'off' | 'borderline';
  verifyBand: number;
  fallbackMessage: string | null;
}

export const SETTINGS_MODULE_KEY = 'faq_settings';

/** One flow's switch and matching knobs; a flow that never saved runs on the platform defaults, switched on. */
@Injectable()
export class FaqSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: FaqConfigService,
    private readonly logs: FaqLogRepository,
    private readonly faqs: FaqRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** What the matcher and the inbound listener use: the saved row, else defaults. Works with or without a request context. */
  async effective(
    orgId: number,
    flowId: number,
    tx?: Tx,
    opts: { fresh?: boolean } = {},
  ): Promise<EffectiveSettings & { engineEnabled: boolean }> {
    const cfg = opts.fresh ? await this.config.getFresh() : await this.config.get();
    const row = tx
      ? await this.logs.getSettings(tx, orgId, flowId)
      : await this.db.txAs({ orgId, userId: null }, (t) => this.logs.getSettings(t, orgId, flowId));
    return {
      engineEnabled: cfg.engineEnabled,
      enabled: row?.enabled ?? true,
      threshold: row?.threshold ?? cfg.defaultThreshold,
      minMargin: row?.minMargin ?? 0,
      logQueries: row?.logQueries ?? true,
      verifyMode: row?.verifyMode ?? 'off',
      verifyBand: row?.verifyBand ?? 0.1,
      fallbackMessage: row?.fallbackMessage ?? null,
    };
  }

  async get(flowUuid: string): Promise<FaqSettings> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    const { row, usage } = await this.db.tx(async (tx) => {
      const flow = await this.faqs.requireFlow(tx, orgId, flowUuid);
      return {
        row: await this.logs.getSettings(tx, orgId, flow.id),
        usage: await this.faqs.usage(tx, orgId, flow.id),
      };
    });
    return {
      enabled: row?.enabled ?? true,
      threshold: row?.threshold ?? cfg.defaultThreshold,
      minMargin: row?.minMargin ?? 0,
      logQueries: row?.logQueries ?? true,
      verifyMode: row?.verifyMode ?? 'off',
      verifyBand: row?.verifyBand ?? 0.1,
      fallbackMessage: row?.fallbackMessage ?? null,
      verifyAvailable: cfg.verifyEnabled,
      verifyModel: cfg.verifyModel,
      isDefault: row === null,
      engineEnabled: cfg.engineEnabled,
      embeddingModel: cfg.embeddingModel,
      recommendedThreshold: faqRecommendedThreshold(cfg.embeddingModel),
      tunedForModel: row?.tunedModel ?? null,
      // Only a flow that saved has a number tuned for some model; one that never saved follows the platform default.
      modelChanged: row !== null && row.tunedModel !== cfg.embeddingModel,
      limits: { maxFaqs: cfg.maxFaqs, maxVariationsPerFaq: cfg.maxVariationsPerFaq },
      usage,
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  async update(flowUuid: string, input: UpdateFaqSettingsInput): Promise<FaqSettings> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    await this.db.tx(async (tx) => {
      const flow = await this.faqs.requireFlow(tx, orgId, flowUuid);
      const before = await this.logs.getSettings(tx, orgId, flow.id);
      // The first save has no version; once a row exists a save without one is a stale form (it never read the row).
      if (before && input.rowVersion === undefined)
        throw AppError.rowVersionConflict('FAQ settings');
      if (!before && input.rowVersion !== undefined)
        throw AppError.rowVersionConflict('FAQ settings');
      const ok = await this.logs.saveSettings(
        tx,
        orgId,
        flow.id,
        {
          enabled: input.enabled,
          threshold: input.threshold,
          minMargin: input.minMargin,
          logQueries: input.logQueries,
          // A client that does not know the check yet keeps what is saved.
          verifyMode: input.verifyMode ?? before?.verifyMode ?? 'off',
          verifyBand: input.verifyBand ?? before?.verifyBand ?? 0.1,
          // Absent keeps the saved text; null removes it.
          fallbackMessage:
            input.fallbackMessage === undefined
              ? (before?.fallbackMessage ?? null)
              : input.fallbackMessage,
          // Saving is the owner's confirmation that the numbers suit the model in force now.
          tunedModel: cfg.embeddingModel,
        },
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('FAQ settings');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const was = before ?? {
        enabled: true,
        threshold: null,
        minMargin: null,
        logQueries: true,
        verifyMode: 'off',
        verifyBand: 0.1,
        fallbackMessage: null,
      };
      for (const k of ['enabled', 'threshold', 'minMargin', 'logQueries'] as const) {
        if (was[k] !== input[k]) delta[k] = { old: was[k], new: input[k] };
      }
      for (const k of ['verifyMode', 'verifyBand', 'fallbackMessage'] as const) {
        if (input[k] !== undefined && was[k] !== input[k])
          delta[k] = { old: was[k], new: input[k] };
      }
      await this.audit.record(tx, {
        module: SETTINGS_MODULE_KEY,
        recordId: flow.id,
        action: before ? 'update' : 'insert',
        delta: Object.keys(delta).length ? delta : undefined,
      });
      await this.outbox.emit(tx, {
        aggregateModule: SETTINGS_MODULE_KEY,
        aggregateId: flow.id,
        eventType: 'faq.settings_changed',
        payload: { flowId: flowUuid, enabled: input.enabled },
      });
    });
    return this.get(flowUuid);
  }
}
