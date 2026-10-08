import { describe, expect, it } from 'vitest';
import type { PlatformAiKeyItem } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { draftFromItem, isDirty, parseModelList, toUpdateBody } from './card-draft';
import { errorKind } from './errors';
import { barPercent, compactNumber, dollars, maxOf, shortDay } from './format';

const item = (over: Partial<PlatformAiKeyItem> = {}): PlatformAiKeyItem => ({
  id: '00000000-0000-4000-8000-000000000001',
  provider: 'openai',
  name: 'OpenAI',
  group: 'llm',
  isActive: true,
  hasKey: true,
  keyUnreadable: false,
  keyLast4: 'ABCD',
  defaultModel: 'gpt-5.4-mini',
  sortOrder: 1,
  maxTokens: 4096,
  supportsMaxTokens: true,
  keyHint: 'Find at platform.openai.com/api-keys',
  textExtra: {
    key: 'organization',
    label: 'Organization ID',
    hint: 'Optional. e.g. org-xxxxxxxxxxxx',
    value: '',
  },
  extraModels: ['gpt-4o'],
  modelChoices: ['gpt-5.4-mini', 'gpt-4o'],
  rowVersion: 3,
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});

describe('provider card draft (TW-AIADM-002, 003)', () => {
  it('starts from the stored values with an empty key field (the secret is never shown)', () => {
    expect(draftFromItem(item())).toEqual({
      apiKey: '',
      defaultModel: 'gpt-5.4-mini',
      sortOrder: '1',
      maxTokens: '4096',
      extraModels: 'gpt-4o',
      textExtra: '',
    });
  });

  it('sends the optional text field (Organization ID) only when it changed, and never on a card without one', () => {
    const i = item();
    expect(toUpdateBody(i, { ...draftFromItem(i), textExtra: ' org-1 ' })).toEqual({
      body: { rowVersion: 3, textExtra: 'org-1' },
    });
    const bare = item({ textExtra: null });
    expect(toUpdateBody(bare, { ...draftFromItem(bare), textExtra: 'x' })).toEqual({
      body: { rowVersion: 3 },
    });
  });

  it('sends nothing but the row version when nothing changed', () => {
    const i = item();
    expect(toUpdateBody(i, draftFromItem(i))).toEqual({ body: { rowVersion: 3 } });
    expect(isDirty(i, draftFromItem(i))).toBe(false);
  });

  it('leaves a blank key out, so the saved key is kept, and sends a typed one trimmed', () => {
    const i = item();
    const typed = { ...draftFromItem(i), apiKey: '  sk-new  ' };
    expect(toUpdateBody(i, typed)).toEqual({ body: { rowVersion: 3, apiKey: 'sk-new' } });
    expect(isDirty(i, typed)).toBe(true);
  });

  it('sends only the fields that changed', () => {
    const i = item();
    const d = { ...draftFromItem(i), defaultModel: 'gpt-4.1', sortOrder: '7' };
    expect(toUpdateBody(i, d)).toEqual({
      body: { rowVersion: 3, defaultModel: 'gpt-4.1', sortOrder: 7 },
    });
  });

  it('clears the ceiling with null and refuses a non-numeric or zero one', () => {
    const i = item();
    expect(toUpdateBody(i, { ...draftFromItem(i), maxTokens: '' })).toEqual({
      body: { rowVersion: 3, maxTokens: null },
    });
    expect(toUpdateBody(i, { ...draftFromItem(i), maxTokens: 'lots' })).toEqual({
      error: 'maxTokens',
    });
    expect(toUpdateBody(i, { ...draftFromItem(i), maxTokens: '0' })).toEqual({
      error: 'maxTokens',
    });
    expect(toUpdateBody(i, { ...draftFromItem(i), maxTokens: '2048' })).toEqual({
      body: { rowVersion: 3, maxTokens: 2048 },
    });
  });

  it('never sends a ceiling for a vendor that has no such field', () => {
    const i = item({ provider: 'deepseek', supportsMaxTokens: false, maxTokens: null });
    expect(toUpdateBody(i, { ...draftFromItem(i), maxTokens: '99' })).toEqual({
      body: { rowVersion: 3 },
    });
  });

  it('refuses a bad order and an over-long model id before it reaches the server', () => {
    const i = item();
    expect(toUpdateBody(i, { ...draftFromItem(i), sortOrder: '-1' })).toEqual({
      error: 'sortOrder',
    });
    expect(toUpdateBody(i, { ...draftFromItem(i), sortOrder: '40000' })).toEqual({
      error: 'sortOrder',
    });
    expect(toUpdateBody(i, { ...draftFromItem(i), defaultModel: 'm'.repeat(81) })).toEqual({
      error: 'defaultModel',
    });
  });

  it('cannot blank the default model (Reference could not either)', () => {
    const i = item();
    expect(toUpdateBody(i, { ...draftFromItem(i), defaultModel: '' })).toEqual({
      body: { rowVersion: 3 },
    });
  });

  it('turns the extra models text into a clean list and sends it only when it changed', () => {
    expect(parseModelList(' a, b ,, a\nc ')).toEqual(['a', 'b', 'c']);
    const i = item();
    expect(toUpdateBody(i, { ...draftFromItem(i), extraModels: 'gpt-4o, gpt-4.1' })).toEqual({
      body: { rowVersion: 3, extraModels: ['gpt-4o', 'gpt-4.1'] },
    });
    expect(toUpdateBody(i, { ...draftFromItem(i), extraModels: '' })).toEqual({
      body: { rowVersion: 3, extraModels: [] },
    });
  });
});

describe('error kinds', () => {
  const api = (status: number, code: string) => new ApiError(status, code, 'x');
  it('maps the codes and statuses the screens care about', () => {
    expect(errorKind(api(409, 'ROW_VERSION_CONFLICT'))).toBe('conflict');
    expect(errorKind(api(422, 'AIADM_KEY_REQUIRED'))).toBe('keyRequired');
    expect(errorKind(api(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(errorKind(api(404, 'NOT_FOUND'))).toBe('notFound');
    expect(errorKind(api(422, 'VALIDATION_FAILED'))).toBe('validation');
    expect(errorKind(api(500, 'INTERNAL'))).toBe('unexpected');
    expect(errorKind(api(400, 'X'))).toBe('request');
    expect(errorKind(new TypeError('fetch failed'))).toBe('network');
  });
});

describe('display helpers', () => {
  it('draws bars relative to the largest, with a sliver for anything non-zero', () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(maxOf([3, 9, 4])).toBe(9);
    expect(maxOf([])).toBe(0);
  });
  it('formats numbers, days and dollars for a locale', () => {
    expect(compactNumber(1_250_000, 'en')).toBe('1.3M');
    expect(compactNumber(950, 'en')).toBe('950');
    expect(shortDay('2026-10-02', 'en')).toBe('Oct 2');
    expect(shortDay('nonsense', 'en')).toBe('nonsense');
    expect(dollars('12.50', 'en')).toBe('$12.50');
    expect(dollars('bad', 'en')).toBe('$0.00');
  });
});
