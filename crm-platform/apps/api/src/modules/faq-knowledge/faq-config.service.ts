import { Injectable } from '@nestjs/common';
import {
  FAQ_EMBEDDING_MODELS,
  FAQ_PLATFORM_DEFAULTS,
  faqRecommendedThreshold,
  type FaqPlatformConfig,
} from '@crm/contracts';
import { PlatformSettingsService } from '../auth';

export const FAQ_CONFIG_KEY = 'faq.config';

/** What the operator saved; a missing field is the platform default, so a new knob never needs a data migration. */
export type FaqConfigDoc = Partial<
  Omit<FaqPlatformConfig, 'allowedModels' | 'defaultThresholdCustom'> & {
    _rv: number;
    _at: string;
  }
>;

/** The platform's FAQ settings in one place: every reader (matcher, embedder, screens) goes through here. */
@Injectable()
export class FaqConfigService {
  constructor(private readonly store: PlatformSettingsService) {}

  /**
   * The config read straight from the database, not from the 5 second snapshot the platform store keeps per process. For the places a
   * stale answer does harm: the worker must not make vectors with a model the operator just replaced, and a customer message must not
   * be dropped for five seconds after the engine was switched back on.
   */
  async getFresh(): Promise<FaqPlatformConfig> {
    this.store.invalidate();
    return this.get();
  }

  async get(): Promise<FaqPlatformConfig> {
    const doc = (await this.store.get<FaqConfigDoc>(FAQ_CONFIG_KEY)) ?? {};
    const d = FAQ_PLATFORM_DEFAULTS;
    const known = FAQ_EMBEDDING_MODELS.some((m) => m.id === doc.embeddingModel);
    // A stored model that left the allow-list falls back to the default rather than breaking every match.
    const embeddingModel = known ? (doc.embeddingModel as string) : d.embeddingModel;
    return {
      engineEnabled: doc.engineEnabled ?? d.engineEnabled,
      embeddingModel,
      generationModel: doc.generationModel ?? d.generationModel,
      // Scores are not comparable between models, so unless the operator fixed a number the default follows the model.
      defaultThreshold: doc.defaultThreshold ?? faqRecommendedThreshold(embeddingModel),
      defaultThresholdCustom: doc.defaultThreshold !== undefined,
      maxFaqs: doc.maxFaqs ?? d.maxFaqs,
      maxVariationsPerFaq: doc.maxVariationsPerFaq ?? d.maxVariationsPerFaq,
      semanticPerHour: doc.semanticPerHour ?? d.semanticPerHour,
      verifyEnabled: doc.verifyEnabled ?? d.verifyEnabled,
      verifyModel: doc.verifyModel ?? d.verifyModel,
      verifyPerHour: doc.verifyPerHour ?? d.verifyPerHour,
      allowedModels: FAQ_EMBEDDING_MODELS,
    };
  }

  /** The dimension count of a model on the allow-list, or null for one that is not on it. */
  dimensionsOf(model: string): number | null {
    return FAQ_EMBEDDING_MODELS.find((m) => m.id === model)?.dimensions ?? null;
  }
}
