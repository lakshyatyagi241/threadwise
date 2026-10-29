import { describe, expect, it } from 'vitest';
import { KB_DEFAULT_EMBEDDING_MODEL, KB_EMBEDDING_MODELS } from '@crm/contracts';
import type { PlatformSettingsService } from '../../../src/modules/auth';
import {
  KB_CONFIG_KEY,
  KbConfigService,
} from '../../../src/modules/knowledge-base/kb-config.service';

/** A platform store that answers with one stored document, as the real store does for KB_CONFIG_KEY. */
const configWith = (doc: Record<string, unknown> | undefined): KbConfigService => {
  const store = {
    get: async (key: string) => (key === KB_CONFIG_KEY ? doc : undefined),
    invalidate: () => undefined,
  };
  return new KbConfigService(store as unknown as PlatformSettingsService);
};

describe('KbConfigService.get reports a stored model that left the allow-list', () => {
  it('falls back to the default and names the replaced model', async () => {
    const config = await configWith({ embeddingModel: 'retired-model-x' }).get();
    expect(config.embeddingModel).toBe(KB_DEFAULT_EMBEDDING_MODEL);
    expect(config.replacedModel).toBe('retired-model-x');
  });

  it('reports nothing when the stored model is on the allow-list', async () => {
    const known = KB_EMBEDDING_MODELS[0]!.id;
    const config = await configWith({ embeddingModel: known }).get();
    expect(config.embeddingModel).toBe(known);
    expect(config.replacedModel).toBeUndefined();
  });

  it('reports nothing when no model is stored', async () => {
    const config = await configWith(undefined).get();
    expect(config.embeddingModel).toBe(KB_DEFAULT_EMBEDDING_MODEL);
    expect(config.replacedModel).toBeUndefined();
  });
});
