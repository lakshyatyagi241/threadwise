import { describe, expect, it } from 'vitest';
import { parseWizardCsv } from '../../../src/modules/campaigns/wizard/wizard-csv-parse';

describe('parseWizardCsv', () => {
  it('normalises to E.164 with the workspace default country, keeps the first of a repeated number and reports line numbers', () => {
    const out = parseWizardCsv(
      [
        'Mobile,First Name,Last Name',
        '9812345678,Aarav,Sharma',
        '+91 98123 45678,Dup,Row',
        'abc,Bad,Row',
        ',Blank,Row',
      ].join('\n'),
      '+91',
    );
    expect(out).toMatchObject({ valid: 1, duplicate: 1, invalid: 2 });
    expect(out.lines.map((l) => [l.line, l.kind, l.phone, l.name, l.reason])).toEqual([
      [2, 'valid', '+919812345678', 'Aarav Sharma', null],
      [3, 'duplicate', '+919812345678', null, 'duplicate'],
      [4, 'invalid', null, null, 'invalid_phone'],
      [5, 'invalid', null, null, 'missing_phone'],
    ]);
  });

  it('a bare local number is invalid when the workspace has no default country, an international one is not', () => {
    const out = parseWizardCsv('phone\n9812345678\n+447700900123', null);
    expect(out.lines.map((l) => l.kind)).toEqual(['invalid', 'valid']);
  });

  it('reads semicolon files and a country code column', () => {
    const out = parseWizardCsv('phone;country_code\n9812345678;44', '+91');
    expect(out.lines[0]).toMatchObject({ kind: 'valid', digits: '449812345678' });
  });

  it('refuses a file without a phone column, or without rows', () => {
    expect(() => parseWizardCsv('name,email\nA,a@x.com', '+91')).toThrow(/phone/);
    expect(() => parseWizardCsv('phone\n', '+91')).toThrow(/no numbers/);
  });
});
