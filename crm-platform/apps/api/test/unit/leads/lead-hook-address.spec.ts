import { describe, expect, it } from 'vitest';
import { hookUrlFor, resolveHookBase } from '../../../src/modules/leads/lead-hook-address';

/** BL-061: the complete webhook address, or the reason there is none. Never a guessed address. */
const prod = (appUrl: string | undefined) => resolveHookBase({ appUrl, isProduction: true });
const dev = (appUrl: string | undefined) => resolveHookBase({ appUrl, isProduction: false });

describe('resolveHookBase', () => {
  it('builds the origin from a configured address, without a trailing slash, query or fragment', () => {
    expect(prod('https://api.acme.test')).toEqual({
      baseUrl: 'https://api.acme.test',
      problem: null,
    });
    expect(prod('https://api.acme.test///?x=1#top').baseUrl).toBe('https://api.acme.test');
  });

  it('keeps a path prefix (a reverse proxy that mounts the API under /api)', () => {
    expect(prod('https://acme.test/api/').baseUrl).toBe('https://acme.test/api');
  });

  it('reports a missing setting, an empty one and one that is not a web address', () => {
    for (const v of [undefined, '', '   ', 'not a url', 'ftp://files.acme.test']) {
      expect(prod(v)).toEqual({ baseUrl: null, problem: 'base_url_not_configured' });
    }
  });

  it('refuses a private or local address in production: no ad platform can deliver a lead there', () => {
    for (const v of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://10.1.2.3',
      'http://172.20.0.5',
      'http://192.168.1.10:3000',
      'http://169.254.1.1',
      'http://api.corp.internal',
      'http://printer.local',
      'http://[::1]:3000',
    ]) {
      expect(prod(v), v).toEqual({ baseUrl: null, problem: 'base_url_not_public' });
    }
  });

  it('allows a local address on a developer machine, where it is the real address', () => {
    expect(dev('http://localhost:3000').baseUrl).toBe('http://localhost:3000');
  });

  it('does not mistake a public address for a private one', () => {
    for (const v of ['https://172.32.0.1', 'https://11.0.0.1', 'https://fcdn.acme.test']) {
      expect(prod(v).problem, v).toBeNull();
    }
  });
});

describe('hookUrlFor', () => {
  it('puts the token path behind the base, and returns null when there is no base', () => {
    expect(hookUrlFor({ baseUrl: 'https://api.acme.test/api', problem: null }, 'tok')).toBe(
      'https://api.acme.test/api/v2/public/lead-hooks/tok',
    );
    expect(hookUrlFor({ baseUrl: null, problem: 'base_url_not_configured' }, 'tok')).toBeNull();
  });
});
