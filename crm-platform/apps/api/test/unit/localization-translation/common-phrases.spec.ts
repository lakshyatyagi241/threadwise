import { describe, expect, it } from 'vitest';
import {
  COMMON_PHRASES,
  lookupCommonPhrase,
} from '../../../src/modules/localization-translation/common-phrases';

/** WD-I18N-023 */
describe('lookupCommonPhrase', () => {
  it('translates an English word straight from the table', () => {
    expect(lookupCommonPhrase('Hello', 'en', 'ko')).toBe('안녕하세요');
    expect(lookupCommonPhrase('  THANKS ', 'en', 'es')).toBe('gracias');
  });

  it('pivots through English for a non-English source', () => {
    expect(lookupCommonPhrase('धन्यवाद', 'hi', 'es')).toBe('gracias');
    expect(lookupCommonPhrase('Merci', 'fr', 'de')).toBe('danke');
  });

  it('accepts regional codes by their base language', () => {
    expect(lookupCommonPhrase('hello', 'en', 'zh-CN')).toBe('你好');
  });

  it('returns the lower-cased phrase when source and target match', () => {
    expect(lookupCommonPhrase('Hello', 'en', 'en')).toBe('hello');
  });

  it('misses on anything that is not a whole known phrase', () => {
    expect(lookupCommonPhrase('hello there', 'en', 'es')).toBeNull();
    expect(lookupCommonPhrase('', 'en', 'es')).toBeNull();
    expect(lookupCommonPhrase('hello', 'en', 'xx')).toBeNull();
  });

  it('has the same languages for every concept', () => {
    const sets = Object.values(COMMON_PHRASES).map((r) => Object.keys(r).sort().join());
    expect(new Set(sets).size).toBe(1);
    expect(Object.keys(COMMON_PHRASES)).toHaveLength(12);
  });
});
