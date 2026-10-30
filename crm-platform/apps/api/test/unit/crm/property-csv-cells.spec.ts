import { describe, expect, it } from 'vitest';
import { readBooleanCell, readNumberCell } from '../../../src/modules/crm/property-csv-cells';

describe('readNumberCell', () => {
  it.each([
    ['42', 42],
    ['-3.5', -3.5],
    ['120,000', 120000],
    ['1,250.5', 1250.5],
  ])('reads %s as a number', (text, n) => expect(readNumberCell(text)).toBe(n));

  it.each([
    '12,5',
    '1,2345',
    'abc',
    '1,25',
    '',
    '   ',
    '0x1F',
    '0b11',
    '0o7',
    '-0x10',
    '1e3',
    'Infinity',
  ])('keeps %j as text so the write rules can refuse it', (text) => {
    // Number('') and Number('   ') are 0 in JS; a blank cell must not silently become 0.
    expect(readNumberCell(text)).toBe(text);
  });
});

describe('readBooleanCell', () => {
  it.each(['true', 'YES', 'y', '1', 'x', 'On'])('%s is true', (t) =>
    expect(readBooleanCell(t)).toBe(true),
  );
  it.each(['false', 'No', 'n', '0', 'off'])('%s is false', (t) =>
    expect(readBooleanCell(t)).toBe(false),
  );
  it('leaves anything else as text', () => expect(readBooleanCell('maybe')).toBe('maybe'));
});
