import { describe, expect, it } from 'vitest';
import { preferencesToApply } from './preferences';

describe('preferencesToApply', () => {
  const profile = { theme: 'dark' as const, locale: 'ar' };

  it('applies both when the browser has chosen neither', () => {
    expect(preferencesToApply('', profile)).toEqual({ theme: 'dark', locale: 'ar' });
    expect(preferencesToApply('_ga=1; other=2', profile)).toEqual({ theme: 'dark', locale: 'ar' });
  });

  it('never overrides a choice already made in this browser', () => {
    expect(preferencesToApply('crm_theme=light; NEXT_LOCALE=fr', profile)).toEqual({});
    expect(preferencesToApply('a=1; crm_theme=light', profile)).toEqual({ locale: 'ar' });
    expect(preferencesToApply('NEXT_LOCALE=en; a=1', profile)).toEqual({ theme: 'dark' });
  });

  it('maps paper and bright to the light mode', () => {
    expect(preferencesToApply('', { theme: 'paper', locale: null }).theme).toBe('light');
    expect(preferencesToApply('', { theme: 'bright', locale: null }).theme).toBe('light');
  });

  it('applies no language when the profile has none or an unsupported one', () => {
    expect(preferencesToApply('', { theme: 'paper', locale: null }).locale).toBeUndefined();
    expect(preferencesToApply('', { theme: 'paper', locale: 'xx' }).locale).toBeUndefined();
  });

  it('does not mistake a cookie whose name merely contains ours', () => {
    expect(preferencesToApply('my_crm_theme=dark', profile).theme).toBe('dark');
  });
});
