import type { AiModelOption } from '@crm/contracts';
import { filterLanguages, pickAiModel, REWRITE_ACTIONS, TRANSLATE_LANGUAGES } from './ai-rewrite';

const model = (provider: string, value: string) =>
  ({ provider, value, providerName: provider, source: 'platform' }) as AiModelOption;

describe('pickAiModel', () => {
  it('takes the first model of a vendor the rewrite route can call', () => {
    expect(pickAiModel([model('openai', 'gpt-x'), model('anthropic', 'claude-x')])).toEqual({
      provider: 'openai',
      value: 'gpt-x',
    });
  });

  it('skips models of a vendor the route cannot call', () => {
    expect(pickAiModel([model('deepseek', 'd1'), model('gemini', 'g1')])).toEqual({
      provider: 'gemini',
      value: 'g1',
    });
  });

  it('has none while the list is missing, empty or only of other vendors', () => {
    expect(pickAiModel(undefined)).toBeNull();
    expect(pickAiModel([])).toBeNull();
    expect(pickAiModel([model('deepseek', 'd1')])).toBeNull();
  });
});

describe('languages', () => {
  it('lists them all when nothing is typed, in the order of the web list', () => {
    expect(filterLanguages('  ')).toBe(TRANSLATE_LANGUAGES);
    expect(TRANSLATE_LANGUAGES[0]).toBe('Afrikaans');
    expect(TRANSLATE_LANGUAGES).toHaveLength(59);
  });

  it('narrows by part of the name in any case', () => {
    expect(filterLanguages('GUJ')).toEqual(['Gujarati']);
    expect(filterLanguages('zzz')).toEqual([]);
  });

  it('only has names the API accepts (letters, spaces and a few marks)', () => {
    for (const l of TRANSLATE_LANGUAGES) expect(l).toMatch(/^[\p{L}\p{M} ()'.-]{2,60}$/u);
  });
});

describe('actions', () => {
  it('are the four the API knows', () => {
    expect(REWRITE_ACTIONS).toEqual(['condense', 'fix', 'positive', 'translate']);
  });
});
