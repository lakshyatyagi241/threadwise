import { describe, expect, it } from 'vitest';
import { IMPORT_SAMPLE_HEADERS, detectImportColumns, normalizeImportHeader } from '@crm/contracts';
import { detectDelimiter, parseCsv } from '../../../src/modules/crm/contact-import/csv-parser';
import {
  extractRow,
  missingRequired,
  resolveMapping,
  splitList,
} from '../../../src/modules/crm/contact-import/import-rows';
import {
  analyzeCsv,
  sampleCsv,
} from '../../../src/modules/crm/contact-import/contact-import.service';
import { contactImportOptionsSchema } from '@crm/contracts';

const opts = (over: Record<string, unknown> = {}) => contactImportOptionsSchema.parse(over);

describe('column auto-detection (WD-CON-028)', () => {
  it('WD-CON-028 #1: "Phone Number, Full Name, E-mail" maps mobile=0, name=1, email=2; "Mail Address" is not recognised', () => {
    expect(detectImportColumns(['Phone Number', 'Full Name', 'E-mail'])).toEqual({
      phone: 0,
      name: 1,
      email: 2,
    });
    expect(detectImportColumns(['Mail Address'])).toEqual({});
  });

  it('WD-CON-028 #2: with "Name" and "First Name", the leftmost takes `name` and each field takes one column', () => {
    const d = detectImportColumns(['Name', 'First Name']);
    expect(d.name).toBe(0);
    // Deviation from WaDesk (which ignored "First Name"): it now maps to firstName, a field of its own.
    expect(d.firstName).toBe(1);
  });

  it('WD-CON-028 #3: "MSISDN, Lists" maps phone and group', () => {
    expect(detectImportColumns(['MSISDN', 'Lists'])).toEqual({ phone: 0, group: 1 });
  });

  it('WD-CON-028 #1 (normalisation): case, spaces, dashes and underscores do not matter', () => {
    expect(normalizeImportHeader('PHONE-NUMBER')).toBe('phonenumber');
    expect(normalizeImportHeader('phone_number')).toBe('phonenumber');
    expect(normalizeImportHeader('Phone Number')).toBe('phonenumber');
    expect(detectImportColumns(['PHONE-NUMBER'])).toEqual({ phone: 0 });
  });

  it('recognises the fields WaDesk could not import: tags, title, address, notes, status, source', () => {
    expect(detectImportColumns(['Tags', 'Title', 'Address', 'Notes', 'Status', 'Source'])).toEqual({
      tags: 0,
      title: 1,
      address: 2,
      memo: 3,
      status: 4,
      source: 5,
    });
  });

  it('a request mapping overrides detection, and null un-maps a field', () => {
    const headers = ['A', 'B', 'Phone'];
    expect(resolveMapping(headers, { name: 0, phone: 1 })).toMatchObject({ name: 0, phone: 1 });
    expect(resolveMapping(headers, { phone: null }).phone).toBeUndefined();
  });

  it('missingRequired wants a phone and some way to name the contact', () => {
    expect(missingRequired({})).toEqual(['phone', 'name']);
    expect(missingRequired({ phone: 0, firstName: 1 })).toEqual([]);
    expect(missingRequired({ name: 0 })).toEqual(['phone']);
  });
});

describe('sample CSV (WD-CON-032)', () => {
  it('WD-CON-032 #1: three lines with the importer header', () => {
    const lines = sampleCsv().trimEnd().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('name,last_name,country_code,mobile,email,group,language');
    expect(lines[0]!.split(',')).toEqual([...IMPORT_SAMPLE_HEADERS]);
    expect(sampleCsv().endsWith('\n')).toBe(true);
  });

  it('WD-CON-032 #2: imported unchanged, it yields two contacts and the groups VIP, New leads, Customers', () => {
    const a = analyzeCsv(sampleCsv(), opts());
    expect(a.valid).toHaveLength(2);
    expect(a.invalidCount).toBe(0);
    expect(a.valid.flatMap((r) => r.groups).sort()).toEqual(['Customers', 'New leads', 'VIP']);
    expect(a.valid.map((r) => r.phone)).toEqual(['+919812345678', '+919898765432']);
  });

  it('the quoted group cell survives the parser as one cell', () => {
    const recs = parseCsv(sampleCsv()).records;
    expect(recs[1]!.cells[5]).toBe('VIP, New leads');
  });
});

describe('csv parser', () => {
  it('reads quoted cells with commas, doubled quotes and line breaks', () => {
    const r = parseCsv('a,b\n"x, y","say ""hi""\nbye"\n');
    expect(r.records.map((x) => x.cells)).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"\nbye'],
    ]);
  });

  it('strips a UTF-8 BOM and handles CRLF', () => {
    const r = parseCsv(String.fromCharCode(0xfeff) + 'name,phone\r\nA,123\r\n');
    expect(r.records[0]!.cells).toEqual(['name', 'phone']);
    expect(r.records).toHaveLength(2);
  });

  it('detects semicolon, tab and pipe delimiters (WaDesk read commas only)', () => {
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('a|b|c')).toBe('|');
    expect(detectDelimiter('a,b;c')).toBe(',');
    expect(parseCsv('name;phone\nA;123').records[1]!.cells).toEqual(['A', '123']);
  });

  it('a delimiter inside quotes is not counted when detecting', () => {
    expect(detectDelimiter('"a;b;c",d')).toBe(',');
  });

  it('skips blank lines and reports the line each record starts on', () => {
    const r = parseCsv('h\n\nx\n"multi\nline"\ny');
    expect(r.records.map((x) => [x.line, x.cells[0]])).toEqual([
      [1, 'h'],
      [3, 'x'],
      [4, 'multi\nline'],
      [6, 'y'],
    ]);
  });

  it('keeps an empty trailing cell', () => {
    expect(parseCsv('a,b\n1,').records[1]!.cells).toEqual(['1', '']);
  });
});

describe('row validation (WD-CON-027)', () => {
  const header = ['name', 'mobile', 'email', 'country_code', 'group', 'tags'];
  const mapping = resolveMapping(header);
  const row = (cells: string[], over: Parameters<typeof extractRow>[3] = {}) =>
    extractRow({ line: 2, cells }, mapping, header, over);

  it('WD-CON-027 #2: a row with no name, or no number, is rejected with a reason', () => {
    expect(row(['', '9812345678'])).toMatchObject({ ok: false, reason: 'missing_name' });
    expect(row(['A', ''])).toMatchObject({ ok: false, reason: 'missing_phone' });
  });

  it('rejects a number that cannot be a phone, and a bad email (WaDesk imported both)', () => {
    expect(row(['A', 'abc'])).toMatchObject({ ok: false, reason: 'invalid_phone' });
    expect(row(['A', '12345'])).toMatchObject({ ok: false, reason: 'invalid_phone' });
    expect(row(['A', '9812345678', 'not-an-email', '+91'])).toMatchObject({
      ok: false,
      reason: 'invalid_email',
    });
  });

  it('WD-CON-027 #3: groups split on commas, semicolons and pipes; repeats collapse', () => {
    const r = row(['A', '9812345678', '', '+91', 'VIP, New leads; vip | Other']);
    expect(r.ok && r.row.groups).toEqual(['VIP', 'New leads', 'Other']);
    expect(splitList('a,,b')).toEqual(['a', 'b']);
  });

  it('puts the country code in front of a local number, and lower-cases the email', () => {
    const r = row(['A', '9812345678', 'A@Example.COM', '+91']);
    expect(r.ok && r.row.phone).toBe('+919812345678');
    expect(r.ok && r.row.email).toBe('a@example.com');
  });

  it('rejects a group or tag name longer than the column allows', () => {
    const long = 'x'.repeat(192);
    expect(row(['A', '9812345678', '', '+91', long])).toMatchObject({
      ok: false,
      reason: 'group_name_too_long',
    });
    expect(row(['A', '9812345678', '', '+91', '', 'y'.repeat(65)])).toMatchObject({
      ok: false,
      reason: 'tag_name_too_long',
    });
  });

  it('a first/last name pair is enough when there is no name column', () => {
    const h = ['first name', 'last name', 'phone'];
    const r = extractRow(
      { line: 2, cells: ['Aarav', 'Sharma', '+919812345678'] },
      resolveMapping(h),
      h,
      {},
    );
    expect(r.ok && r.row.name).toBe('Aarav Sharma');
  });
});

describe('analyzing a whole file (WD-CON-027)', () => {
  it('WD-CON-027 #4: a header with no recognisable phone column is reported as missing, not "imported 0"', () => {
    const a = analyzeCsv('Name,Colour\nA,red\n', opts());
    expect(a.missing).toContain('phone');
  });

  it('counts invalid rows apart from valid ones and keeps a few samples with their line numbers', () => {
    const a = analyzeCsv(
      'name,mobile\nA,9812345678\n,9812345679\nB,\n',
      opts({ defaultCountryCode: '+91' }),
    );
    expect(a.totalRows).toBe(3);
    expect(a.valid).toHaveLength(1);
    expect(a.invalidCount).toBe(2);
    expect(a.invalid.map((i) => [i.row, i.reason])).toEqual([
      [3, 'missing_name'],
      [4, 'missing_phone'],
    ]);
  });

  it('refuses an empty file and a header-only file', () => {
    expect(() => analyzeCsv('', opts())).toThrow();
    expect(() => analyzeCsv('name,phone\n', opts())).toThrow();
  });

  it('sample rows are keyed by header', () => {
    const a = analyzeCsv('Phone,Name\n+919812345678,A\n', opts());
    expect(a.sampleRows[0]).toEqual({ Phone: '+919812345678', Name: 'A' });
  });
});
