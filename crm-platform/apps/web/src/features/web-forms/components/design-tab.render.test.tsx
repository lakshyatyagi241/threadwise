import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { blankDefinition } from '../lib/builder-model';
import { DEFAULT_THEME, THEME_PRESETS, applyPreset, presetOf } from '../lib/theme';
import type { Definition, ThemeTokens } from '../lib/types';
import type { BuilderTabProps } from './builder-types';
import { DesignTab, readImage, withTheme } from './design-tab';
import { PreviewFrame } from './preview-frame';

/**
 * These render to static HTML with the real English and Arabic messages (this package's tests have no browser or DOM): they prove the
 * text is complete, that the draft decides what each control shows, and that read-only mode locks everything. Typing and clicking
 * are not simulated here; the rules they rely on (what a colour or address may be, what a preset writes) are tested as plain functions.
 */

const COPY = { title: 'Form', submitLabel: 'Send', successMessage: 'Thanks' };

function draftWith(theme: Partial<ThemeTokens>, locale: 'en' | 'ar' = 'en'): Definition {
  const d = blankDefinition(COPY, locale);
  return { ...d, theme: { ...d.theme, ...theme } };
}

function props(draft: Definition, canEdit = true): BuilderTabProps {
  return { draft, canEdit, setDraft: vi.fn() } as unknown as BuilderTabProps;
}

function render(node: ReactElement, locale: 'en' | 'ar' = 'en'): string {
  const problems: string[] = [];
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: loadMessages(locale),
      timeZone: 'UTC',
      onError: (e: { message: string }) => {
        problems.push(e.message);
      },
      getMessageFallback: ({ key }: { key: string }) => `[[${key}]]`,
      children: createElement('div', { dir: locale === 'ar' ? 'rtl' : 'ltr' }, node),
    }),
  );
  if (problems.length > 0) throw new Error(`Missing or broken messages:\n${problems.join('\n')}`);
  return html;
}

describe('Design tab render', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`renders every control with complete messages in ${locale}`, () => {
      const html = render(<DesignTab {...props(draftWith({}, locale))} />, locale);
      expect(html).not.toContain('[[');
      expect(html).toContain('<iframe');
      for (const k of [
        'primary',
        'background',
        'surface',
        'text',
        'mutedText',
        'border',
        'error',
      ]) {
        expect(html).toContain('-c-' + k);
      }
      // The renderer does not implement floating labels, so the tab must not offer them.
      expect(html).not.toContain('value="floating"');
      expect(html).toContain('value="left"');
    });
  }

  it('marks the preset the theme still equals, and says Custom otherwise', () => {
    const on = render(<DesignTab {...props(draftWith(applyPreset(DEFAULT_THEME, 'ocean')))} />);
    const ocean = [...on.matchAll(/<input[^>]*value="ocean"[^>]*>/g)].map((m) => m[0]);
    expect(ocean).toHaveLength(1);
    expect(ocean[0]).toContain('checked=""');
    expect(on).not.toContain('preset-custom');
    const custom = render(<DesignTab {...props(draftWith({ primary: '#123456' }))} />);
    expect(custom).toContain('preset-custom');
  });

  it('flags an invalid colour and an invalid image address on the input', () => {
    const html = render(
      <DesignTab {...props(draftWith({ primary: '#12', logo: 'http://x.test/a.png' }))} />,
    );
    const invalid = [...html.matchAll(/<input[^>]*aria-invalid="true"[^>]*>/g)].map((m) => m[0]);
    expect(invalid.some((i) => i.includes('value="#12"'))).toBe(true);
    expect(invalid.some((i) => i.includes('value="http://x.test/a.png"'))).toBe(true);
  });

  it('warns about a low-contrast pair with its ratio, and stays quiet for a good one', () => {
    const bad = render(
      <DesignTab {...props(draftWith({ text: '#cccccc', surface: '#ffffff' }))} />,
    );
    expect(bad).toContain('contrast-warning');
    expect(bad).toMatch(/1\.6\d:1/);
    expect(render(<DesignTab {...props(draftWith({}))} />)).not.toContain('contrast-warning');
  });

  it('shows the cover image field only for the split layout', () => {
    expect(render(<DesignTab {...props(draftWith({}))} />)).not.toContain('-cover');
    expect(render(<DesignTab {...props(draftWith({ layout: 'split' }))} />)).toContain('-cover');
  });

  it('read-only mode disables the controls and says why', () => {
    const open = render(<DesignTab {...props(draftWith({}))} />);
    const locked = render(<DesignTab {...props(draftWith({}), false)} />);
    expect(open).not.toMatch(/<button[^>]*disabled=""/);
    expect(locked).toMatch(/<button[^>]*disabled=""/);
    expect(locked).toMatch(/<input[^>]*type="text"[^>]*disabled=""/);
    expect(locked).toMatch(/<select[^>]*disabled=""/);
    expect(locked).toContain('You can look at the design but not change it.');
  });

  it('explains the disabled dark preview switch while the mode is light', () => {
    const light = render(<DesignTab {...props(draftWith({ mode: 'light' }))} />);
    const auto = render(<DesignTab {...props(draftWith({ mode: 'auto' }))} />);
    expect(light).toContain('there is no dark version');
    expect(auto).not.toContain('there is no dark version');
  });
});

describe('Design tab rules', () => {
  it('picking a preset writes that preset primary and keeps layout settings', () => {
    for (const key of Object.keys(THEME_PRESETS) as Array<keyof typeof THEME_PRESETS>) {
      const next = applyPreset({ ...DEFAULT_THEME, layout: 'split', maxWidth: 700 }, key);
      expect(next.primary).toBe({ ...DEFAULT_THEME, ...THEME_PRESETS[key] }.primary);
      expect(next.layout).toBe('split');
      expect(next.maxWidth).toBe(700);
      expect(presetOf(next)).toBe(key);
    }
  });

  it('withTheme replaces only the given tokens', () => {
    const d = draftWith({});
    const next = withTheme(d, { radius: 'pill' });
    expect(next.theme.radius).toBe('pill');
    expect(next.theme.primary).toBe(d.theme.primary);
    expect(next.steps).toBe(d.steps);
  });

  it('an image address is empty, https, or refused', () => {
    expect(readImage('')).toEqual({ value: null });
    expect(readImage('  ')).toEqual({ value: null });
    expect(readImage('https://cdn.test/a.png')).toEqual({ value: 'https://cdn.test/a.png' });
    expect(readImage('http://cdn.test/a.png')).toBeNull();
    expect(readImage('javascript:alert(1)')).toBeNull();
    expect(readImage('https://cdn.test/a b.png')).toBeNull();
  });
});

describe('PreviewFrame', () => {
  const form = draftWith({}) as unknown as Parameters<typeof PreviewFrame>[0]['form'];

  it('renders a titled iframe whose width follows the device', () => {
    const mobile = render(<PreviewFrame form={form} device="mobile" />);
    const desktop = render(<PreviewFrame form={form} device="desktop" />);
    expect(mobile).toMatch(/<iframe[^>]*title="Live preview of the form"/);
    expect(mobile).toContain('w-[390px]');
    expect(mobile).toContain('data-device="mobile"');
    expect(desktop).toContain('data-device="desktop"');
    expect(desktop).not.toContain('w-[390px]');
  });

  it('titles the frame in Arabic', () => {
    const html = render(<PreviewFrame form={form} device="desktop" />, 'ar');
    expect(html).toContain('معاينة مباشرة للنموذج');
  });
});
