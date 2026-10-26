import { describe, expect, it } from 'vitest';
import { normalizeImportDate, parseImportBirthDate } from './contact-import';

describe('normalizeImportDate', () => {
  it('reads year first in any of the three separators', () => {
    expect(normalizeImportDate('1990-05-14')).toBe('1990-05-14');
    expect(normalizeImportDate('1990/5/4')).toBe('1990-05-04');
    expect(normalizeImportDate('1990.05.14')).toBe('1990-05-14');
  });
  it('reads year last only when it cannot mean two dates', () => {
    expect(normalizeImportDate('14-05-1990')).toBe('1990-05-14');
    expect(normalizeImportDate('05/14/1990')).toBe('1990-05-14');
    expect(normalizeImportDate('10-05-1990')).toBeNull();
    expect(normalizeImportDate('13-13-1990')).toBeNull();
  });
  it('refuses a day that does not exist', () => {
    expect(normalizeImportDate('31-02-1990')).toBeNull();
    expect(normalizeImportDate('1990-02-30')).toBeNull();
  });
  it('a birth date must also be believable', () => {
    expect(parseImportBirthDate('14-05-1990', new Date('2026-10-26'))).toBe('1990-05-14');
    expect(parseImportBirthDate('14-05-2999', new Date('2026-10-26'))).toBeNull();
  });
});
