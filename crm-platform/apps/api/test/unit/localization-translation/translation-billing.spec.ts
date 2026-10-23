import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../../src/common/stable-usage-id';
import { translationUsageId } from '../../../src/modules/localization-translation/translation-billing';

const base = {
  orgId: 7,
  providerSlug: 'deepl',
  sourceLang: 'es',
  targetLang: 'en',
  textHash: fingerprint('Dónde está mi pedido'),
  at: new Date('2026-10-22T09:00:00.000Z'),
};

describe('translationUsageId', () => {
  it('is the same for the same translation on the same UTC day, however late in the day', () => {
    expect(translationUsageId(base)).toBe(
      translationUsageId({ ...base, at: new Date('2026-10-22T23:59:59.000Z') }),
    );
  });

  it('is a new id the next UTC day', () => {
    expect(translationUsageId(base)).not.toBe(
      translationUsageId({ ...base, at: new Date('2026-10-23T00:00:00.000Z') }),
    );
  });

  it('differs by workspace, provider, either language and text', () => {
    const id = translationUsageId(base);
    expect(translationUsageId({ ...base, orgId: 8 })).not.toBe(id);
    expect(translationUsageId({ ...base, providerSlug: 'google_cloud' })).not.toBe(id);
    expect(translationUsageId({ ...base, sourceLang: 'fr' })).not.toBe(id);
    expect(translationUsageId({ ...base, targetLang: 'de' })).not.toBe(id);
    expect(translationUsageId({ ...base, textHash: fingerprint('otra cosa') })).not.toBe(id);
  });

  it('starts with the provider and stays short', () => {
    const id = translationUsageId(base);
    expect(id).toMatch(/^deepl:[0-9a-f]{32}$/);
  });
});
