import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nav } from './nav';

describe('FAQs have no menu entry of their own', () => {
  it('declares no nav item: FAQs are a tab of each flow', () => {
    expect(nav).toEqual([]);
  });

  it('keeps only one /faq route, a catch-all that redirects, and no workspace FAQ screens', () => {
    const app = join(process.cwd(), 'src', 'app', '(app)', '(faq-knowledge)', 'faq');
    expect(existsSync(join(app, '[[...path]]', 'page.tsx'))).toBe(true);
    for (const old of ['new', 'test', 'unanswered', 'insights', 'settings', '[id]', 'page.tsx'])
      expect(existsSync(join(app, old)), old).toBe(false);
    expect(existsSync(join(app, '..', 'layout.tsx'))).toBe(false);
  });
});
