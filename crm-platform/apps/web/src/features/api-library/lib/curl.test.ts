import { describe, expect, it } from 'vitest';
import { parseCurl, shellSplit } from './curl';

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

  it('encodes --data-urlencode like curl, so "a b&c" is one value in the address', () => {
    expect(parseCurl(`curl -G https://a.test/s --data-urlencode 'q=a b&c'`)?.url).toBe(
      'https://a.test/s?q=a%20b%26c',
    );
    expect(parseCurl(`curl -G https://a.test/s --data-urlencode 'a b'`)?.url).toBe(
      'https://a.test/s?a%20b',
    );
    expect(parseCurl(`curl https://a.test/s --data-urlencode 'q=x y' -d 'k=1'`)?.body).toBe(
      'q=x%20y&k=1',
    );
  });

  it('keeps --form-string text and says which file parts it could not take', () => {
    const r = parseCurl(
      `curl https://a.test/up -F 'file=@/tmp/a.png' --form-string 'note=@not a file' -F 'name=Ann'`,
    );
    expect(r).toMatchObject({
      payloadType: 'multipart/form-data',
      body: { note: '@not a file', name: 'Ann' },
      skipped: [{ code: 'file', name: 'file' }],
    });
    // Only a file: still a form, with nothing silently pretended.
    expect(parseCurl(`curl https://a.test/up -F 'f=@a.txt'`)).toMatchObject({
      method: 'POST',
      payloadType: 'multipart/form-data',
      body: {},
      skipped: [{ code: 'file', name: 'f' }],
    });
  });

  it("reads bash's $'...' quoting: \\n is a line break", () => {
    expect(shellSplit("a $'l1\\nl2\\t\\x41\\'' b")).toEqual(['a', "l1\nl2\tA'", 'b']);
    expect(parseCurl("curl https://a.test/m -d $'line1\\nline2'")?.body).toBe('line1\nline2');
  });

  it('reads --json as a JSON body with its headers', () => {
    expect(parseCurl(`curl https://a.test/j --json '{"a":1}'`)).toMatchObject({
      method: 'POST',
      body: { a: 1 },
      headers: [
        { key: 'Content-Type', value: 'application/json' },
        { key: 'Accept', value: 'application/json' },
      ],
    });
  });
});

describe('what a pasted command has that the form cannot take is said, not dropped', () => {
  it('says a GET with a message will not send it, and keeps the message', () => {
    const r = parseCurl(
      `curl -X GET https://httpbin.org/anything/search -d '{"query":"active users"}'`,
    );
    expect(r?.method).toBe('GET');
    expect(r?.body).toEqual({ query: 'active users' });
    expect(r?.skipped).toEqual([{ code: 'body', name: 'GET' }]);
  });
  it('says a method it does not know, and does not hide the message that came with it', () => {
    const r = parseCurl(`curl -X PACTH https://api.example.com/x -d '{"a":1}'`);
    expect(r?.method).toBe('GET');
    expect(r?.skipped).toEqual([
      { code: 'method', name: 'PACTH' },
      { code: 'body', name: 'GET' },
    ]);
  });
  it('has nothing to say about a command the form takes whole', () => {
    expect(
      parseCurl(`curl -X POST https://api.example.com/x -d '{"a":1}'`)?.skipped,
    ).toBeUndefined();
    expect(parseCurl('curl https://api.example.com/x')?.skipped).toBeUndefined();
  });
});
