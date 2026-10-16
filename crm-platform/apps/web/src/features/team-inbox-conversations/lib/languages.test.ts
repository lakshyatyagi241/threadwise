import { describe, expect, it } from 'vitest';
import { languageChoices } from './languages';

describe('languageChoices', () => {
  it('lists the languages by name, in English for the AI', () => {
    const all = languageChoices('en', '');
    expect(all.length).toBeGreaterThan(50);
    expect(all.find((l) => l.code === 'ar')).toMatchObject({ label: 'Arabic', english: 'Arabic' });
  });
  it('finds a language by either its local or its English name', () => {
    expect(languageChoices('en', 'urd').map((l) => l.code)).toContain('ur');
    expect(languageChoices('de', 'spanisch').map((l) => l.code)).toEqual(['es']);
    expect(languageChoices('en', 'spanish').map((l) => l.code)).toEqual(['es']);
    expect(languageChoices('en', 'zzzz')).toEqual([]);
  });
});
