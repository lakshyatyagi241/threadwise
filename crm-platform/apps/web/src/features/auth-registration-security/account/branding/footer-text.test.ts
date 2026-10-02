import { describe, expect, it } from 'vitest';
import { FOOTER_MAX, clampCodePoints, codePointLength, footerPreview } from './footer-text';

describe('codePointLength', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(codePointLength('Sent via Acme')).toBe(13);
    expect(codePointLength('😀😀😀')).toBe(3);
    expect(codePointLength('')).toBe(0);
  });
});

describe('clampCodePoints', () => {
  it('leaves a short footer alone', () => {
    expect(clampCodePoints('Sent via Acme')).toBe('Sent via Acme');
  });

  it('cuts at 60 characters', () => {
    expect(clampCodePoints('a'.repeat(80))).toHaveLength(FOOTER_MAX);
  });

  it('keeps 60 emoji (120 UTF-16 units) and cuts the 61st without splitting one', () => {
    const sixty = '😀'.repeat(60);
    expect(clampCodePoints(sixty)).toBe(sixty);
    expect(clampCodePoints(`${sixty}😀`)).toBe(sixty);
  });
});

describe('footerPreview', () => {
  it('wraps the footer in underscores, as WhatsApp italics', () => {
    expect(footerPreview('Sent via Acme', '(no footer)')).toBe('_Sent via Acme_');
  });

  it('shows the label for a blank footer, even one of spaces', () => {
    expect(footerPreview('', '(no footer)')).toBe('(no footer)');
    expect(footerPreview('   ', '(no footer)')).toBe('(no footer)');
    expect(footerPreview(null, '(no footer)')).toBe('(no footer)');
  });

  it('keeps inner and edge spaces of a real footer, as Reference does', () => {
    expect(footerPreview(' hi ', '(no footer)')).toBe('_ hi _');
  });
});
