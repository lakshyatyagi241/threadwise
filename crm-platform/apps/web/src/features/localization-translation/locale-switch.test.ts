import { describe, expect, it, vi } from 'vitest';
import type { ActiveLanguage } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { hasChoice, switchLocale, triggerCode } from './locale-switch';

const lang = (code: string): ActiveLanguage => ({
  code,
  name: code,
  nativeName: null,
  direction: 'ltr',
});

describe('hasChoice', () => {
  it('shows the switcher only when more than one language is active', () => {
    expect(hasChoice([])).toBe(false);
    expect(hasChoice([lang('en')])).toBe(false);
    expect(hasChoice([lang('en'), lang('ar')])).toBe(true);
  });
});

describe('triggerCode', () => {
  it('is the current code in upper case, or the first active one when the locale is not active', () => {
    expect(triggerCode([lang('en'), lang('ar')], 'ar')).toBe('AR');
    expect(triggerCode([lang('en'), lang('ar')], 'zh-CN')).toBe('EN');
  });
});

describe('switchLocale', () => {
  const ok = () => Promise.resolve();

  it('saves a signed-in choice, then sets the cookie', async () => {
    const saveMine = vi.fn(ok);
    const setCookie = vi.fn(ok);
    expect(await switchLocale('ar', { saveMine, setCookie })).toBe('ok');
    expect(saveMine).toHaveBeenCalledWith('ar');
    expect(setCookie).toHaveBeenCalledWith('ar');
  });

  it('gives a guest (401) the cookie only', async () => {
    const setCookie = vi.fn(ok);
    const saveMine = () => Promise.reject(new ApiError(401, 'UNAUTHENTICATED', 'no'));
    expect(await switchLocale('de', { saveMine, setCookie })).toBe('ok');
    expect(setCookie).toHaveBeenCalledWith('de');
  });

  it('does nothing when the server refuses the language', async () => {
    const setCookie = vi.fn(ok);
    const saveMine = () => Promise.reject(new ApiError(422, 'I18N_LANGUAGE_NOT_AVAILABLE', 'no'));
    expect(await switchLocale('xx', { saveMine, setCookie })).toBe('failed');
    expect(setCookie).not.toHaveBeenCalled();
  });
});
