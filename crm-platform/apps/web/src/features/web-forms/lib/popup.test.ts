import { describe, expect, it } from 'vitest';
import { DEFAULT_POPUP, clampWhole, popupButtonSnippet, popupSnippet, POPUP_LIMITS } from './popup';

const base = {
  key: 'aB3dE5gH7jK9mN1pQ3sT5v',
  scriptUrl: 'https://api.example.com/form-embed/aB3dE5gH7jK9mN1pQ3sT5v/embed.js',
  title: 'Contact us',
};

describe('popup options', () => {
  it('holds a number to its limits and falls back for what is not a number', () => {
    expect(clampWhole(9999, POPUP_LIMITS.delay)).toBe(600);
    expect(clampWhole(-4, POPUP_LIMITS.delay)).toBe(0);
    expect(clampWhole('12', POPUP_LIMITS.delay)).toBe(12);
    expect(clampWhole('', POPUP_LIMITS.delay)).toBe(5);
    expect(clampWhole('soon', POPUP_LIMITS.scroll)).toBe(50);
    expect(clampWhole(2, POPUP_LIMITS.scroll)).toBe(5);
  });
});

describe('popup snippet', () => {
  it('writes only the options the trigger uses, then the loader', () => {
    const delay = popupSnippet({
      ...base,
      options: { ...DEFAULT_POPUP, trigger: 'delay', delay: 8 },
    });
    expect(delay).toContain('data-forms-mode="popup"');
    expect(delay).toContain('data-forms-delay="8"');
    expect(delay).not.toContain('data-forms-scroll');
    expect(delay).toContain(`<script src="${base.scriptUrl}" async></script>`);
    const down = popupSnippet({
      ...base,
      options: { ...DEFAULT_POPUP, trigger: 'scroll_down', scroll: 70 },
    });
    expect(down).toContain('data-forms-scroll="70"');
    expect(down).not.toContain('data-forms-delay');
    const up = popupSnippet({ ...base, options: { ...DEFAULT_POPUP, trigger: 'scroll_up' } });
    expect(up).toContain('data-forms-trigger="scroll_up"');
    expect(up).not.toMatch(/data-forms-(delay|scroll)=/);
  });
  it('clamps numbers and escapes anything that could leave the attribute', () => {
    const s = popupSnippet({
      ...base,
      title: 'A "quoted" <b>name</b>',
      options: { ...DEFAULT_POPUP, delay: 99999, days: -1 },
    });
    expect(s).toContain('data-forms-delay="600"');
    expect(s).toContain('data-forms-days="0"');
    expect(s).toContain('data-forms-title="A &quot;quoted&quot; &lt;b&gt;name&lt;/b&gt;"');
    expect(s).not.toContain('<b>');
  });
  it('the click button carries the form key', () => {
    expect(popupButtonSnippet(base.key)).toBe(
      `<button type="button" data-forms-open="${base.key}">Open form</button>`,
    );
  });
});
