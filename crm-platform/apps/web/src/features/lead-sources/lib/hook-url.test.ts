import { describe, expect, it } from 'vitest';
import { leadHookUrl } from './hook-url';

const PATH = '/v2/public/lead-hooks/tkn123';

describe('leadHookUrl', () => {
  it('prefixes the public API address when it is set', () => {
    expect(leadHookUrl(PATH, { apiPublicUrl: 'https://api.acme.test' })).toEqual({
      url: `https://api.acme.test${PATH}`,
      path: PATH,
      source: 'public',
    });
  });

  it('drops trailing slashes and keeps a path prefix of the public address', () => {
    expect(leadHookUrl(PATH, { apiPublicUrl: 'https://acme.test/api///' }).url).toBe(
      `https://acme.test/api${PATH}`,
    );
  });

  it('prefers the public address over the realtime one', () => {
    const r = leadHookUrl(PATH, {
      apiPublicUrl: 'https://api.acme.test',
      realtimeUrl: 'https://other.test/realtime',
    });
    expect(r.source).toBe('public');
    expect(r.url).toBe(`https://api.acme.test${PATH}`);
  });

  it('falls back to the origin of the realtime address (the API origin plus /realtime)', () => {
    expect(leadHookUrl(PATH, { realtimeUrl: 'http://localhost:3000/realtime' })).toEqual({
      url: `http://localhost:3000${PATH}`,
      path: PATH,
      source: 'realtime',
    });
  });

  it('shows the path alone when no address is known, or the ones given are not addresses', () => {
    expect(leadHookUrl(PATH, {})).toEqual({ url: null, path: PATH, source: 'none' });
    expect(leadHookUrl(PATH, { apiPublicUrl: '  ', realtimeUrl: null }).source).toBe('none');
    expect(
      leadHookUrl(PATH, { apiPublicUrl: 'not a url', realtimeUrl: 'ftp://x.test' }).source,
    ).toBe('none');
  });

  it('ignores a public address that is not http(s) and falls through to the realtime one', () => {
    const r = leadHookUrl(PATH, {
      apiPublicUrl: 'javascript:alert(1)',
      realtimeUrl: 'https://rt.acme.test/realtime',
    });
    expect(r.url).toBe(`https://rt.acme.test${PATH}`);
  });

  it('accepts a path without its leading slash and an already absolute address', () => {
    expect(leadHookUrl('v2/public/lead-hooks/t', { apiPublicUrl: 'https://a.test' }).url).toBe(
      'https://a.test/v2/public/lead-hooks/t',
    );
    expect(leadHookUrl('https://api.acme.test/v2/public/lead-hooks/t', {}).url).toBe(
      'https://api.acme.test/v2/public/lead-hooks/t',
    );
  });
});
