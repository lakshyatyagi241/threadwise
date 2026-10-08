import { describe, expect, it } from 'vitest';
import {
  REPORT_DESIGN_SKILL,
  buildDesignedHtml,
  designedSignature,
  isDesignedReady,
} from './designed-report';

const done = {
  generating: false,
  htmlComplete: true,
  cssComplete: true,
  css: 'body{background:#fff}',
  html: ['<head></head><body><h1>', 'Q3</h1></body>'],
  jsFunctions: 'function f(){return 1}',
  jsExpressions: ['f()', 'document.title="</script><b>"'],
};

describe('isDesignedReady', () => {
  it('is true only when the model has finished and the page is whole', () => {
    expect(isDesignedReady(done)).toBe(true);
    expect(isDesignedReady({ ...done, generating: true })).toBe(false);
    expect(isDesignedReady({ ...done, htmlComplete: false })).toBe(false);
    expect(isDesignedReady({ ...done, html: [] })).toBe(false);
    expect(isDesignedReady({})).toBe(false);
  });
});

describe('designedSignature', () => {
  it('is equal for equal content and changes as content streams in', () => {
    expect(designedSignature({ ...done })).toBe(
      designedSignature({ ...done, html: [...done.html] }),
    );
    expect(designedSignature({ html: ['a'] })).not.toBe(designedSignature({ html: ['a', 'b'] }));
    expect(designedSignature({ html: ['a'] })).not.toBe(designedSignature({ html: ['ab'] }));
    expect(designedSignature({ generating: true })).not.toBe(
      designedSignature({ generating: false }),
    );
  });
});

describe('buildDesignedHtml', () => {
  it('is null until the page is finished: nothing half-written is offered for download', () => {
    expect(buildDesignedHtml({ ...done, generating: true }, 'Report')).toBeNull();
  });

  it('builds a standalone document: doctype, css in the head, body as written, scripts last', () => {
    const out = buildDesignedHtml(done, 'Report')!;
    expect(out.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(out).toContain('<style>body{background:#fff}</style>');
    expect(out).toContain('<h1>Q3</h1>');
    expect(out.indexOf('<style>')).toBeLessThan(out.indexOf('<h1>'));
    expect(out.indexOf('<h1>')).toBeLessThan(out.indexOf('function f()'));
    expect(out.indexOf('function f()')).toBeLessThan(out.indexOf('</body>'));
  });

  it('cannot be broken out of by a closing script tag inside the model code', () => {
    const out = buildDesignedHtml(done, 'Report')!;
    expect(out).toContain('<\\/script><b>');
    expect(out.match(/<\/script>/g)).toHaveLength(3);
  });

  it('copes with a fragment that has no head or body', () => {
    const out = buildDesignedHtml(
      { generating: false, htmlComplete: true, html: ['<p>x</p>'] },
      'R',
    )!;
    expect(out).toContain('<html>');
    expect(out).toContain('<head>');
    expect(out).toContain('<p>x</p>');
  });

  it('keeps the title text free of markup', () => {
    const out = buildDesignedHtml(done, '<script>x</script>')!;
    expect(out).toContain('<title>scriptx/script</title>');
  });
});

describe('design brief', () => {
  it('keeps the sandboxed page as an explicit fallback: blocks are the default, a custom page only on request', () => {
    expect(REPORT_DESIGN_SKILL).toMatch(/Do not use generateSandboxedUi for ordinary reports/);
    for (const tool of ['show_summary', 'show_kpis', 'show_chart', 'show_table'])
      expect(REPORT_DESIGN_SKILL).toContain(tool);
    expect(REPORT_DESIGN_SKILL).toMatch(/explicitly asks for a custom/);
  });

  it('still asks for a page that needs no network and no invented numbers', () => {
    expect(REPORT_DESIGN_SKILL).toMatch(/no network/i);
    expect(REPORT_DESIGN_SKILL).toMatch(/Never invent a number/);
    expect(REPORT_DESIGN_SKILL).toMatch(/distinct colours/);
  });
});
