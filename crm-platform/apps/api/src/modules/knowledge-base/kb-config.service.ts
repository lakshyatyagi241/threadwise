import { Injectable } from '@nestjs/common';
import { KB_DEFAULT_EMBEDDING_MODEL, KB_EMBEDDING_MODELS } from '@crm/contracts';
import { PlatformSettingsService } from '../auth';

/**
 * The stored document keeps its old key: the platform operator's model choice made for the FAQ engine carries over, so the search
 * keeps the model the existing vectors were made with.
 */
export const KB_CONFIG_KEY = 'faq.config';

interface KbConfigDoc {
  engineEnabled?: boolean;
  embeddingModel?: string;
}

export interface KbConfig {
  /** Off: agents read their whole knowledge base as before (no search). Never shown to workspace users. */
  engineEnabled: boolean;
  embeddingModel: string;
}

/** The search's platform settings in one place: every reader (retriever, embedder, worker) goes through here. */
@Injectable()
export class KbConfigService {
  constructor(private readonly store: PlatformSettingsService) {}

  /**
   * The config read straight from the database, not from the 5 second snapshot the platform store keeps per process. For the worker:
   * it must not make vectors with a model the operator just replaced.
   */
  async getFresh(): Promise<KbConfig> {
    this.store.invalidate();
    return this.get();
  }

  async get(): Promise<KbConfig> {
    const doc = (await this.store.get<KbConfigDoc>(KB_CONFIG_KEY)) ?? {};
    const known = KB_EMBEDDING_MODELS.some((m) => m.id === doc.embeddingModel);
    return {
      engineEnabled: doc.engineEnabled ?? true,
      // A stored model that left the allow-list falls back to the default rather than breaking every search.
      embeddingModel: known ? (doc.embeddingModel as string) : KB_DEFAULT_EMBEDDING_MODEL,
    };
  }

  /** The dimension count of a model on the allow-list, or null for one that is not on it. */
  dimensionsOf(model: string): number | null {
    return KB_EMBEDDING_MODELS.find((m) => m.id === model)?.dimensions ?? null;
  }
}
