import { describe, expect, it } from 'vitest';
import { parseCurl, shellSplit, urlEncodeDatum } from './curl';

describe('shellSplit', () => {
  it('groups quotes, honours escapes and joins continued lines', () => {
    expect(shellSplit(`curl -H 'A: b c' "x y" z\\ w \\\n --flag`)).toEqual([
      'curl',
      '-H',
      'A: b c',
      'x y',
      'z w',
      '--flag',
    ]);
  });
  it('keeps an empty quoted argument', () => {
    expect(shellSplit(`a '' b`)).toEqual(['a', '', 'b']);
  });
});

describe('parseCurl', () => {
  it('reads a JSON POST', () => {
    const r = parseCurl(
      `curl -X POST 'https://api.example.com/orders' -H 'Content-Type: application/json' -H "X-Key: abc" -d '{"id": 1, "tags": ["a"]}'`,
    );
    expect(r).toEqual({
      method: 'POST',
      url: 'https://api.example.com/orders',
      headers: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'X-Key', value: 'abc' },
      ],
      body: { id: 1, tags: ['a'] },
      payloadType: 'application/json',
    });
  });

  it('defaults to GET, and to POST when there is data', () => {
    expect(parseCurl('curl https://a.test/x')?.method).toBe('GET');
    expect(parseCurl(`curl https://a.test/x -d 'a=1'`)?.method).toBe('POST');
    expect(parseCurl(`curl -G https://a.test/x -d 'a=1'`)).toMatchObject({
      method: 'GET',
      url: 'https://a.test/x?a=1',
    });
  });

  it('finds the URL anywhere, with --url, and ignores unrelated flags', () => {
    expect(parseCurl('curl -L --max-time 5 -s https://a.test/x')?.url).toBe('https://a.test/x');
    expect(parseCurl('curl --url https://a.test/y -X DELETE')).toMatchObject({
      url: 'https://a.test/y',
      method: 'DELETE',
    });
  });

  it('turns -u into a Basic header', () => {
    const r = parseCurl('curl -u user:pass https://a.test/x');
    expect(r?.headers).toEqual([{ key: 'Authorization', value: `Basic ${btoa('user:pass')}` }]);
  });

  it('reads -F fields as multipart form data without a Content-Type header', () => {
    const r = parseCurl(
      `curl https://a.test/up -H 'Content-Type: multipart/form-data' -F 'name=Ann' -F "city=Pune"`,
    );
    expect(r).toMatchObject({
      method: 'POST',
      payloadType: 'multipart/form-data',
      body: { name: 'Ann', city: 'Pune' },
      headers: [],
    });
  });

  it('keeps a body that is not JSON as text', () => {
    expect(parseCurl(`curl https://a.test -d 'a=1&b=2'`)?.body).toBe('a=1&b=2');
  });

  it('returns null for anything that is not a curl command with an http address', () => {
    expect(parseCurl('')).toBeNull();
    expect(parseCurl('wget https://a.test')).toBeNull();
    expect(parseCurl('curl ftp://a.test')).toBeNull();
    expect(parseCurl('curl -X POST')).toBeNull();
  });

  it('maps an unknown method to GET', () => {
    expect(parseCurl('curl -X TRACE https://a.test')?.method).toBe('GET');
  });
});

describe('--data-urlencode', () => {
  it('encodes the content like curl does and never splits on an & inside it', () => {
    expect(urlEncodeDatum('q=a b&c=d')).toBe('q=a%20b%26c%3Dd');
    expect(urlEncodeDatum('=x y')).toBe('x%20y');
    expect(urlEncodeDatum('plain & text')).toBe('plain%20%26%20text');
    expect(urlEncodeDatum('file@/tmp/a')).toBe('file@/tmp/a');
  });

  it('puts the encoded value in the address of a -G request, other data as typed', () => {
    expect(
      parseCurl(`curl -G https://a.test/s --data-urlencode 'q=fish & chips' -d 'page=2'`),
    ).toMatchObject({ method: 'GET', url: 'https://a.test/s?q=fish%20%26%20chips&page=2' });
    expect(
      parseCurl(`curl https://a.test/s --data-urlencode 'name=A&B' --data-urlencode 'x=1'`)?.body,
    ).toBe('name=A%26B&x=1');
  });
});
