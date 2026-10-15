import { FONT_FAMILY, fontFamilyFor, withInter } from './fonts';
import { typography } from './tokens';

describe('fontFamilyFor', () => {
  it.each([
    ['400', FONT_FAMILY.regular],
    ['500', FONT_FAMILY.medium],
    ['600', FONT_FAMILY.semibold],
    ['700', FONT_FAMILY.bold],
    ['800', FONT_FAMILY.bold],
    ['900', FONT_FAMILY.bold],
    ['100', FONT_FAMILY.regular],
    ['normal', FONT_FAMILY.regular],
    ['bold', FONT_FAMILY.bold],
    ['semibold', FONT_FAMILY.semibold],
    [600, FONT_FAMILY.semibold],
    [undefined, FONT_FAMILY.regular],
  ] as const)('draws weight %s with %s', (weight, family) => {
    expect(fontFamilyFor(weight)).toBe(family);
  });

  it('has a file for every weight the type scale uses', () => {
    const families = Object.values(typography).map((v) => fontFamilyFor(v.fontWeight));
    expect(new Set(families)).toEqual(
      new Set([FONT_FAMILY.regular, FONT_FAMILY.semibold, FONT_FAMILY.bold]),
    );
  });
});

describe('withInter', () => {
  it('swaps the weight for the family that draws it, and keeps the rest of the style', () => {
    expect(withInter({ fontSize: 20, fontWeight: '600', color: '#000' })).toEqual({
      fontSize: 20,
      color: '#000',
      fontFamily: FONT_FAMILY.semibold,
    });
  });

  it('keeps a family that was set on purpose', () => {
    expect(withInter({ fontFamily: 'Courier', fontWeight: '700' }).fontFamily).toBe('Courier');
  });
});
