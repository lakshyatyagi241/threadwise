import { describe, expect, it } from 'vitest';
import { platformBrandingFooterPatchSchema } from '@crm/contracts';
import {
  FOOTER_MAX,
  buildFooterPatch,
  clampFooter,
  footerLength,
  footerPreview,
  footerRemaining,
} from './platform-footer';

describe('FOOTER_MAX', () => {
  it('is the 60 characters WaDesk allows', () => expect(FOOTER_MAX).toBe(60));
});

describe('footerLength', () => {
  it('counts characters, not UTF-16 units', () => {
    expect(footerLength('abc')).toBe(3);
    expect(footerLength('😀')).toBe(1);
    expect(footerLength('😀'.repeat(60))).toBe(60);
    expect('😀'.repeat(60).length).toBe(120);
  });
});

describe('clampFooter', () => {
  it('leaves text within the limit alone', () => {
    expect(clampFooter('Sent via Acme')).toBe('Sent via Acme');
    expect(clampFooter('x'.repeat(60))).toBe('x'.repeat(60));
  });
  it('cuts at 60 characters', () => {
    expect(clampFooter('x'.repeat(75))).toBe('x'.repeat(60));
  });
  it('keeps 60 emoji whole and never splits one', () => {
    expect(clampFooter('😀'.repeat(60))).toBe('😀'.repeat(60));
    expect(clampFooter('😀'.repeat(61))).toBe('😀'.repeat(60));
    expect(clampFooter('a'.repeat(59) + '😀😀')).toBe('a'.repeat(59) + '😀');
  });
});

describe('footerRemaining', () => {
  it('counts down to zero and stops there', () => {
    expect(footerRemaining('')).toBe(60);
    expect(footerRemaining('abc')).toBe(57);
    expect(footerRemaining('😀'.repeat(60))).toBe(0);
    expect(footerRemaining('x'.repeat(75))).toBe(0);
  });
});

describe('footerPreview', () => {
  it('wraps the text in underscores, which WhatsApp renders as italics', () => {
    expect(footerPreview('Sent via Acme', '(no footer)')).toBe('_Sent via Acme_');
    expect(footerPreview('  Sent via Acme  ', '(no footer)')).toBe('_Sent via Acme_');
  });
  it('says there is no footer when the box is blank', () => {
    expect(footerPreview('', '(no footer)')).toBe('(no footer)');
    expect(footerPreview('   ', '(no footer)')).toBe('(no footer)');
  });
});

describe('buildFooterPatch', () => {
  const saved = { footer: 'Sent via Acme' };
  it('sends nothing when the draft is the saved text, spaces aside', () => {
    expect(buildFooterPatch(saved, 'Sent via Acme')).toBeNull();
    expect(buildFooterPatch(saved, '  Sent via Acme ')).toBeNull();
  });
  it('sends the trimmed new text', () => {
    expect(buildFooterPatch(saved, ' New footer ')).toEqual({ footer: 'New footer' });
  });
  it('sends an empty string to remove the footer', () => {
    expect(buildFooterPatch(saved, '')).toEqual({ footer: '' });
    expect(buildFooterPatch(saved, '   ')).toEqual({ footer: '' });
  });
  it('sends nothing for a blank draft when the footer is already blank', () => {
    expect(buildFooterPatch({ footer: '' }, '  ')).toBeNull();
  });
  it('produces a body the API contract accepts, and the contract takes 60 characters of emoji', () => {
    expect(platformBrandingFooterPatchSchema.safeParse(buildFooterPatch(saved, 'x')).success).toBe(
      true,
    );
    expect(platformBrandingFooterPatchSchema.safeParse({ footer: '😀'.repeat(60) }).success).toBe(
      true,
    );
    expect(platformBrandingFooterPatchSchema.safeParse({ footer: '😀'.repeat(61) }).success).toBe(
      false,
    );
  });
});
