import { DEFAULT_LABEL_COLOR, LABEL_COLORS } from '@/lib/theme/tokens';
import { safeLabelColor } from './label-color';

describe('safeLabelColor', () => {
  it('keeps a hex colour, adding the # when it was stored without one', () => {
    expect(safeLabelColor('#2563EB')).toBe('#2563EB');
    expect(safeLabelColor('2563eb')).toBe('#2563eb');
    expect(safeLabelColor('#abc')).toBe('#abc');
    expect(safeLabelColor(' #12345678 ')).toBe('#12345678');
  });

  it('keeps a colour name the phone knows', () => {
    expect(safeLabelColor('tomato')).toBe('tomato');
  });

  it('falls back to the default for nothing, a name the phone does not know, or anything that is not a colour', () => {
    expect(safeLabelColor(null)).toBe(DEFAULT_LABEL_COLOR);
    expect(safeLabelColor('')).toBe(DEFAULT_LABEL_COLOR);
    expect(safeLabelColor('notacolour')).toBe(DEFAULT_LABEL_COLOR);
    expect(safeLabelColor('red; background:url(x)')).toBe(DEFAULT_LABEL_COLOR);
    expect(safeLabelColor('#12')).toBe(DEFAULT_LABEL_COLOR);
  });

  it('offers a palette whose first colour is the default', () => {
    expect(LABEL_COLORS[0]).toBe(DEFAULT_LABEL_COLOR);
    expect(new Set(LABEL_COLORS).size).toBe(LABEL_COLORS.length);
  });
});
