import { describe, expect, it } from 'vitest';
import {
  IMPORT_FIELDS,
  IMPORT_SAMPLE_HEADERS,
  contactImportOptionsSchema,
  detectImportColumns,
} from '@crm/contracts';
import type { PropertyDef } from '../../../src/modules/crm/contacts/contact-property-values';
import { parseCsv } from '../../../src/modules/crm/contact-import/csv-parser';
import { analyzeCsv } from '../../../src/modules/crm/contact-import/contact-import.service';
import { sampleCsv, sampleValue } from '../../../src/modules/crm/contact-import/import-sample';

const opts = () => contactImportOptionsSchema.parse({});

/** A custom property named by its label; the key is the label in snake case, as the workspace would have it. */
const prop = (fieldType: string, label: string, options: string[] = []): PropertyDef => ({
  key: label.toLowerCase().replace(/\W+/g, '_'),
  label,
  fieldType,
  options,
});

/** One property of every type a workspace can hold. The labels are the kind of header a real file uses. */
const EVERY_TYPE: PropertyDef[] = [
  prop('text', 'Hello'),
  prop('long_text', 'Long text'),
  prop('integer', 'Number'),
  prop('big_integer', 'Big number'),
  prop('decimal', 'Decimal number'),
  prop('percentage', 'Percent'),
  prop('currency', 'Price'),
  prop('rating', 'Stars'),
  prop('boolean', 'Yes or no'),
  prop('checkbox', 'Check box'),
  prop('date', 'Date'),
  prop('datetime', 'Meeting at'),
  prop('url', 'Link URL'),
  prop('email', 'Email 1'),
  prop('phone', 'Phone number 1'),
  prop('select', 'Drop down', ['Gold', 'Silver']),
  prop('radio', 'Choice', ['Yes please', 'No thanks']),
  prop('multiselect', 'Multi select', ['Red', 'Blue', 'Green']),
  prop('lookup', 'Lookup'),
  prop('timezone', 'Zone'),
];

/** What each property of EVERY_TYPE holds once the sample's cell is read back by the importer. */
const READ_BACK: Record<string, unknown> = {
  hello: 'Sample text',
  long_text: 'A longer note for this contact. It can run over several sentences.',
  number: 42,
  big_number: 42,
  decimal_number: 12.5,
  percent: 75,
  price: 1250.5,
  stars: 4,
  yes_or_no: true,
  check_box: true,
  date: '2026-05-10',
  meeting_at: '2026-05-10T14:30',
  link_url: 'https://example.com',
  email_1: 'contact@example.com',
  phone_number_1: '98123 45678',
  drop_down: 'Gold',
  choice: 'Yes please',
  multi_select: ['Red', 'Blue'],
  lookup: 'Sample text',
  zone: 'Asia/Kolkata',
};

describe('sample file: built-in columns', () => {
  it('has one column for every built-in import field, and no field twice', () => {
    const detected = detectImportColumns([...IMPORT_SAMPLE_HEADERS]);
    expect(Object.keys(detected).sort()).toEqual([...IMPORT_FIELDS].sort());
    expect(new Set(IMPORT_SAMPLE_HEADERS).size).toBe(IMPORT_SAMPLE_HEADERS.length);
  });

  it('a workspace with no custom properties gets the built-in columns alone, two contacts under them', () => {
    const lines = sampleCsv([]).trimEnd().split('\n');
    expect(lines[0]!.split(',')).toEqual([...IMPORT_SAMPLE_HEADERS]);
    expect(lines).toHaveLength(3);
  });

  it('every row has one cell per column, so the file never shifts a value into the next column', () => {
    const records = parseCsv(sampleCsv(EVERY_TYPE)).records;
    expect(records).toHaveLength(3);
    for (const r of records) expect(r.cells).toHaveLength(records[0]!.cells.length);
  });
});

describe('sample file: one example per custom property type', () => {
  it.each([
    ['text', 'Sample text'],
    ['long_text', 'A longer note for this contact. It can run over several sentences.'],
    ['integer', '42'],
    ['big_integer', '42'],
    ['decimal', '12.5'],
    ['percentage', '75'],
    ['currency', '1250.50'],
    ['rating', '4'],
    ['boolean', 'yes'],
    ['checkbox', 'yes'],
    ['date', '2026-05-10'],
    ['datetime', '2026-05-10T14:30'],
    ['url', 'https://example.com'],
    ['email', 'contact@example.com'],
    ['phone', '98123 45678'],
    ['timezone', 'Asia/Kolkata'],
    ['lookup', 'Sample text'],
  ])('a %s property gets %j', (fieldType, expected) => {
    expect(sampleValue(prop(fieldType, 'X'))).toBe(expected);
  });

  it('a dropdown or radio gets its first option, so the value is one the importer accepts', () => {
    expect(sampleValue(prop('select', 'X', ['Gold', 'Silver']))).toBe('Gold');
    expect(sampleValue(prop('radio', 'X', ['Yes please']))).toBe('Yes please');
  });

  it('a multi-select gets two options joined by a comma, the export format', () => {
    expect(sampleValue(prop('multiselect', 'X', ['Red', 'Blue', 'Green']))).toBe('Red, Blue');
  });

  it('a multi-select option that holds a separator is passed over for one that does not', () => {
    expect(sampleValue(prop('multiselect', 'X', ['Red, dark', 'Blue']))).toBe('Blue');
    expect(sampleValue(prop('multiselect', 'X', ['Red, dark']))).toBe('Red, dark');
  });

  it('a dropdown with no options is left blank, not given a value no option matches', () => {
    expect(sampleValue(prop('select', 'X', []))).toBe('');
  });

  it('a date is written year first, the only form the importer reads', () => {
    expect(sampleValue(prop('date', 'X'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('sample file: imports back without a rejected row', () => {
  it('every data type reads back as its own type, in both example contacts', () => {
    const a = analyzeCsv(sampleCsv(EVERY_TYPE), opts(), EVERY_TYPE);
    expect(a.invalid).toEqual([]);
    expect(a.valid).toHaveLength(2);
    expect(a.valid[0]!.properties).toEqual(READ_BACK);
    expect(a.valid[1]!.properties).toEqual(READ_BACK);
  });

  it('a label that reads as a built-in column is written as attr:<key> and still fills its property', () => {
    const defs = [prop('text', 'Email'), prop('text', 'Source'), prop('select', 'Mobile', ['A'])];
    const csv = sampleCsv(defs);
    // Properties come in label order: Email, Mobile, Source.
    expect(csv.split('\n')[0]!.split(',').slice(-3)).toEqual([
      'attr:email',
      'attr:mobile',
      'attr:source',
    ]);
    const a = analyzeCsv(csv, opts(), defs);
    expect(a.invalid).toEqual([]);
    expect(a.valid[0]!.properties).toEqual({
      email: 'Sample text',
      source: 'Sample text',
      mobile: 'A',
    });
  });

  it('a property whose dropdown has no options imports with no value for it', () => {
    const defs = [prop('select', 'Empty list', [])];
    const a = analyzeCsv(sampleCsv(defs), opts(), defs);
    expect(a.invalid).toEqual([]);
    expect(a.valid[0]!.properties).toBeUndefined();
  });

  it('a label and an option that start like a formula are guarded in the file, and the option still imports', () => {
    const defs = [prop('select', '=Tier', ['=HYPERLINK("x")', 'Gold'])];
    const csv = sampleCsv(defs);
    const [header, row] = csv.split('\n');
    expect(header!.endsWith(",'=Tier")).toBe(true);
    // Quoted by the CSV writer, since the option holds quotes.
    expect(row).toContain('"\'=HYPERLINK(""x"")"');
    const a = analyzeCsv(csv, opts(), defs);
    expect(a.invalid).toEqual([]);
    expect(a.valid[0]!.properties).toEqual({ _tier: '=HYPERLINK("x")' });
  });

  it('a multi-select whose only options hold a separator, one starting like a formula, reads back whole', () => {
    const defs = [prop('multiselect', 'Colors', ['-Red, dark'])];
    const a = analyzeCsv(sampleCsv(defs), opts(), defs);
    expect(a.invalid).toEqual([]);
    expect(a.valid[0]!.properties).toEqual({ colors: ['-Red, dark'] });
  });

  it('two labels that read alike each fill their own property, whatever order the properties come in', () => {
    const defs: PropertyDef[] = [
      { key: 'tier', label: 'Tier', fieldType: 'select', options: ['Gold'] },
      { key: 'tier_2', label: 'tier!', fieldType: 'text', options: [] },
    ];
    for (const order of [defs, [...defs].reverse()]) {
      const a = analyzeCsv(sampleCsv(order), opts(), order);
      expect(a.invalid).toEqual([]);
      expect(a.valid[0]!.properties).toEqual({ tier: 'Gold', tier_2: 'Sample text' });
    }
  });

  it('the example contacts grant no WhatsApp or SMS consent when the import is confirmed', () => {
    const a = analyzeCsv(sampleCsv([]), opts(), []);
    expect(a.valid).toHaveLength(2);
    expect(a.valid.every((r) => r.consent !== 'granted' && r.consentSms !== 'granted')).toBe(true);
    expect(a.valid.map((r) => r.consentEmail)).toEqual(['granted', 'granted']);
  });

  it('keys that differ only in punctuation stay apart, whatever order the properties come in', () => {
    const defs: PropertyDef[] = [
      { key: 'tier2', label: 'Tier', fieldType: 'select', options: ['Gold'] },
      { key: 'tier_2', label: 'Tier', fieldType: 'text', options: [] },
    ];
    for (const order of [defs, [...defs].reverse()]) {
      const a = analyzeCsv(sampleCsv(order), opts(), order);
      expect(a.invalid).toEqual([]);
      expect(a.valid[0]!.properties).toEqual({ tier2: 'Gold', tier_2: 'Sample text' });
    }
  });

  it('a rejected row keeps the cell of the column that failed, even past the first 20 columns', () => {
    const defs = [prop('select', 'Customer tier', ['Gold', 'Silver'])];
    const csv = sampleCsv(defs).replace(/,Gold\n/g, ',Platinum\n');
    const a = analyzeCsv(csv, opts(), defs);
    expect(a.invalid).toHaveLength(2);
    expect(a.invalid[0]).toEqual(
      expect.objectContaining({ reason: 'invalid_property_value', column: 'Customer tier' }),
    );
    expect(a.invalid[0]!.values).toEqual(expect.objectContaining({ 'Customer tier': 'Platinum' }));
  });
});
