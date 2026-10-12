import { Injectable } from '@nestjs/common';
import { LSC_MODELS, LSC_PLATFORM_DEFAULTS, type LscPlatformConfig } from '@crm/contracts';
import { PlatformSettingsService } from '../auth';

export const LSC_CONFIG_KEY = 'lead_scoring.config';

/** What the operator saved; a missing field is the platform default, so a new knob never needs a data migration. */
export type LscConfigDoc = Partial<
  Omit<LscPlatformConfig, 'models'> & {
    _rv: number;
    _at: string;
  }
>;

/** The platform's lead scoring settings in one place: every reader (scorer, screens) goes through here. */
@Injectable()
export class LeadScoringConfigService {
  constructor(private readonly store: PlatformSettingsService) {}

  /** Read straight from the database, not the per-process snapshot: the worker must stop the moment the operator switches it off. */
  async getFresh(): Promise<LscPlatformConfig> {
    this.store.invalidate();
    return this.get();
  }

  async get(): Promise<LscPlatformConfig> {
    const doc = (await this.store.get<LscConfigDoc>(LSC_CONFIG_KEY)) ?? {};
    const d = LSC_PLATFORM_DEFAULTS;
    return {
      platformEnabled: doc.platformEnabled ?? d.platformEnabled,
      model: doc.model ?? d.model,
      scoresPerHour: doc.scoresPerHour ?? d.scoresPerHour,
      retentionDays: doc.retentionDays ?? d.retentionDays,
      models: LSC_MODELS,
    };
  }
}
