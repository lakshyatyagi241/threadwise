// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AI_DRAFT_MAX_AGE_MS, AI_DRAFT_STORAGE_KEY, stashAiDraft, takeAiDraft } from './ai-draft';

const draft = {
  name: 'spring_sale',
  header: null,
  body: 'Hello',
  footer: null,
  buttons: [],
};

beforeEach(() => window.sessionStorage.clear());

describe('the wizard to new-template hand-off', () => {
  it('is read once and deleted', () => {
    stashAiDraft({ draft, language: 'en_US', metaCategory: 'MARKETING' }, 1_000);
    expect(window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY)).not.toBeNull();
    expect(takeAiDraft(2_000)).toEqual({ draft, language: 'en_US', metaCategory: 'MARKETING' });
    expect(window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY)).toBeNull();
    expect(takeAiDraft(2_000)).toBeNull();
  });

  it('ignores (and deletes) a draft that is too old', () => {
    stashAiDraft({ draft, language: 'en_US', metaCategory: 'UTILITY' }, 1_000);
    expect(takeAiDraft(1_000 + AI_DRAFT_MAX_AGE_MS + 1)).toBeNull();
    expect(window.sessionStorage.getItem(AI_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('ignores anything that is not a draft', () => {
    window.sessionStorage.setItem(AI_DRAFT_STORAGE_KEY, '{"draft":{"name":1},"at":1}');
    expect(takeAiDraft(2)).toBeNull();
    window.sessionStorage.setItem(AI_DRAFT_STORAGE_KEY, 'not json');
    expect(takeAiDraft(2)).toBeNull();
  });

  it('falls back to en_US and Marketing for values it does not know', () => {
    window.sessionStorage.setItem(
      AI_DRAFT_STORAGE_KEY,
      JSON.stringify({ draft, language: 'xx_YY', metaCategory: 'AUTHENTICATION', at: 5 }),
    );
    expect(takeAiDraft(6)).toMatchObject({ language: 'en_US', metaCategory: 'MARKETING' });
  });
});
