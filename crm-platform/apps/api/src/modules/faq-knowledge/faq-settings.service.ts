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
}

export const SETTINGS_MODULE_KEY = 'faq_settings';

/** The workspace's switch and matching knobs; a workspace that never saved runs on the platform defaults, switched off. */
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
    tx?: Tx,
    opts: { fresh?: boolean } = {},
  ): Promise<EffectiveSettings & { engineEnabled: boolean }> {
    const cfg = opts.fresh ? await this.config.getFresh() : await this.config.get();
    const row = tx
      ? await this.logs.getSettings(tx, orgId)
      : await this.db.txAs({ orgId, userId: null }, (t) => this.logs.getSettings(t, orgId));
    return {
      engineEnabled: cfg.engineEnabled,
      enabled: row?.enabled ?? false,
      threshold: row?.threshold ?? cfg.defaultThreshold,
      minMargin: row?.minMargin ?? 0,
      logQueries: row?.logQueries ?? true,
    };
  }

  async get(): Promise<FaqSettings> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    const { row, usage } = await this.db.tx(async (tx) => ({
      row: await this.logs.getSettings(tx, orgId),
      usage: await this.faqs.usage(tx, orgId),
    }));
    return {
      enabled: row?.enabled ?? false,
      threshold: row?.threshold ?? cfg.defaultThreshold,
      minMargin: row?.minMargin ?? 0,
      logQueries: row?.logQueries ?? true,
      isDefault: row === null,
      engineEnabled: cfg.engineEnabled,
      embeddingModel: cfg.embeddingModel,
      recommendedThreshold: faqRecommendedThreshold(cfg.embeddingModel),
      tunedForModel: row?.tunedModel ?? null,
      // Only a workspace that saved has a number tuned for some model; one that never saved follows the platform default.
      modelChanged: row !== null && row.tunedModel !== cfg.embeddingModel,
      limits: { maxFaqs: cfg.maxFaqs, maxVariationsPerFaq: cfg.maxVariationsPerFaq },
      usage,
      rowVersion: row?.rowVersion ?? null,
      updatedAt: row ? row.updatedAt.toISOString() : null,
    };
  }

  async update(input: UpdateFaqSettingsInput): Promise<FaqSettings> {
    const orgId = RequestContextStore.orgId();
    const cfg = await this.config.get();
    await this.db.tx(async (tx) => {
      const before = await this.logs.getSettings(tx, orgId);
      // The first save has no version; once a row exists a save without one is a stale form (it never read the row).
      if (before && input.rowVersion === undefined)
        throw AppError.rowVersionConflict('FAQ settings');
      if (!before && input.rowVersion !== undefined)
        throw AppError.rowVersionConflict('FAQ settings');
      const ok = await this.logs.saveSettings(
        tx,
        orgId,
        {
          enabled: input.enabled,
          threshold: input.threshold,
          minMargin: input.minMargin,
          logQueries: input.logQueries,
          // Saving is the owner's confirmation that the numbers suit the model in force now.
          tunedModel: cfg.embeddingModel,
        },
        input.rowVersion,
      );
      if (!ok) throw AppError.rowVersionConflict('FAQ settings');
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const was = before ?? { enabled: false, threshold: null, minMargin: null, logQueries: true };
      for (const k of ['enabled', 'threshold', 'minMargin', 'logQueries'] as const) {
        if (was[k] !== input[k]) delta[k] = { old: was[k], new: input[k] };
      }
      await this.audit.record(tx, {
        module: SETTINGS_MODULE_KEY,
        recordId: orgId,
        action: before ? 'update' : 'insert',
        delta: Object.keys(delta).length ? delta : undefined,
      });
      await this.outbox.emit(tx, {
        aggregateModule: SETTINGS_MODULE_KEY,
        aggregateId: orgId,
        eventType: 'faq.settings_changed',
        payload: { enabled: input.enabled },
      });
    });
    return this.get();
  }
}
