import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PageFill } from './page-fill';

const src = (rel: string) => readFileSync(join(__dirname, '../..', rel), 'utf8');

describe('PageFill', () => {
  it('marks itself for the shell and is the containing block and clip of what is inside', () => {
    const html = renderToStaticMarkup(<PageFill>x</PageFill>);
    expect(html).toContain('data-page-fill=""');
    // relative + overflow-clip: an sr-only label in a table row cannot stretch the window; flex-1 min-h-0 fills <main>.
    for (const c of ['relative', 'overflow-clip', 'flex-1', 'min-h-0', 'flex-col'])
      expect(html).toContain(c);
  });

  it('keeps a floor on a short window through minHeight and takes extra classes', () => {
    const html = renderToStaticMarkup(
      <PageFill minHeight="34rem" className="gap-3">
        x
      </PageFill>,
    );
    expect(html).toContain('min-height:34rem');
    expect(html).toContain('gap-3');
  });
});

describe('the shell contract that PageFill relies on', () => {
  const css = src('app/globals.css');
  it('makes the shell one window tall and <main> the column that scrolls only when forced', () => {
    expect(css).toMatch(/\.app-shell:has\(\[data-page-fill\]\)\s*\{[^}]*height:\s*100dvh/);
    expect(css).toMatch(
      /\.app-shell:has\(\[data-page-fill\]\) > \.app-shell-col\s*\{[^}]*min-height:\s*0/,
    );
    expect(css).toMatch(
      /\.app-shell:has\(\[data-page-fill\]\) \.app-shell-main\s*\{[^}]*flex-direction:\s*column[^}]*overflow-y:\s*auto/,
    );
  });

  it('puts the hooks on the shell, its column and <main>', () => {
    const shell = src('components/shell/app-shell.tsx');
    expect(shell).toMatch(/className="app-shell flex min-h-dvh"/);
    expect(shell).toMatch(/className="app-shell-col [^"]*"/);
    expect(shell).toMatch(/className="app-shell-main [^"]*"/);
  });
});

describe('no screen counts the bars above it by hand', () => {
  // These screens used `calc(100dvh - Nrem)`; N was wrong whenever a trial bar, a notice or a wrapped header appeared (two scrollbars).
  const screens = [
    'features/contacts-attributes-tags/components/contacts-screen.tsx',
    'features/tasks/components/tasks-screen.tsx',
    'features/invoicing/components/invoices-screen.tsx',
    'features/invoicing/components/credit-notes-screen.tsx',
    'features/invoicing/components/recurring-screen.tsx',
    'features/invoicing/components/sales-orders-screen.tsx',
    'features/invoicing/components/tax-rates-screen.tsx',
    'features/appointments/components/appointments-screen.tsx',
    'features/appointments/components/booking-types-screen.tsx',
    'features/sales-docs/components/sales-docs-screen.tsx',
    'features/segments/components/segments-screen.tsx',
  ];
  it.each(screens)('%s sizes itself with PageFill', (rel) => {
    const code = src(rel);
    expect(code).not.toMatch(/calc\(100d?vh\s*-/);
    expect(code).toContain('<PageFill');
  });
});
