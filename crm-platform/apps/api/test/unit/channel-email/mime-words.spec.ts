import { describe, expect, it } from 'vitest';
import {
  decodeWords,
  parseAddressList,
  parseFirstAddress,
  parseHeaderParams,
  parseMessageIds,
} from '../../../src/infra/providers/channel-email';

describe('TW-MAIL-026: header text', () => {
  it('decodes RFC 2047 words (B and Q, several charsets) and joins adjacent ones', () => {
    expect(decodeWords('=?UTF-8?B?w4RyZ2VyIG1pdCDDnGJlcnNjaHJpZnQ=?=')).toBe(
      'Ärger mit Überschrift',
    );
    expect(decodeWords('=?iso-8859-1?Q?Caf=E9_cr=E8me?=')).toBe('Café crème');
    expect(decodeWords('=?UTF-8?Q?Hello?= =?UTF-8?Q?_World?=')).toBe('Hello World');
    expect(decodeWords('plain text')).toBe('plain text');
    expect(decodeWords('=?bogus-charset?B?aGk=?=')).toBe('hi');
  });

  it('parses names, quoted commas, encoded names, groups and bare addresses', () => {
    expect(
      parseAddressList('Ana <ana@example.com>, "Smith, Bob" <Bob@Example.com>, plain@x.org'),
    ).toEqual([
      { name: 'Ana', address: 'ana@example.com' },
      { name: 'Smith, Bob', address: 'bob@example.com' },
      { name: null, address: 'plain@x.org' },
    ]);
    expect(parseFirstAddress('=?UTF-8?B?w4VzYQ==?= <asa@example.com>')).toEqual({
      name: 'Åsa',
      address: 'asa@example.com',
    });
    expect(parseAddressList('Team: a@x.com, b@x.com;')).toEqual([
      { name: null, address: 'a@x.com' },
      { name: null, address: 'b@x.com' },
    ]);
  });

  it('drops garbage and duplicates, never throws', () => {
    expect(parseAddressList('not an address, <>, ana@example.com, ANA@example.com')).toEqual([
      { name: null, address: 'ana@example.com' },
    ]);
    expect(parseAddressList(null)).toEqual([]);
    expect(parseAddressList('')).toEqual([]);
    expect(parseFirstAddress(undefined)).toBeNull();
  });

  it('reads message ids and header parameters', () => {
    expect(parseMessageIds('<a@x> <b@x>\r\n <a@x>')).toEqual(['a@x', 'b@x']);
    expect(parseMessageIds(undefined)).toEqual([]);
    expect(parseHeaderParams('Text/Plain; charset="ISO-8859-1"; format=flowed')).toEqual({
      value: 'text/plain',
      params: { charset: 'ISO-8859-1', format: 'flowed' },
    });
  });
});
