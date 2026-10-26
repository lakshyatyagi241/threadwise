import { describe, expect, it } from 'vitest';
import express from 'express';
import { parseTrustProxy } from '../../../src/config/trust-proxy';
import { clientKey } from '../../../src/modules/platform-infrastructure/rate-limit/client-address';

/**
 * Who a per-address limit counts, under the `TRUST_PROXY` the deploy files ship (QA sheet 3, item 33). Express computes `req.ip` with
 * proxy-addr; this runs the same function over the same setting with synthetic peers, so every case is a real reading of production
 * configuration, not a guess about it. A peer is the machine that opened the TCP connection to the API.
 */
const PROD = 'loopback,linklocal,uniquelocal'; // deploy/hostinger/docker-compose.yml
/** `req.ip` as Express computes it: its own getter, over its own `trust proxy` setting, for a peer and an X-Forwarded-For header. */
const ipOf = (peer: string, xff: string | undefined, setting: string = PROD) => {
  const app = express();
  app.set('trust proxy', parseTrustProxy(setting) as never);
  const req = Object.create(app.request) as {
    app: unknown;
    connection: unknown;
    headers: Record<string, string>;
    ip: string;
  };
  req.app = app;
  req.connection = { remoteAddress: peer };
  req.headers = xff === undefined ? {} : { 'x-forwarded-for': xff };
  return req.ip;
};

describe('parseTrustProxy', () => {
  it('reads a hop count, a list, and a single name', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('loopback, linklocal ,uniquelocal')).toEqual([
      'loopback',
      'linklocal',
      'uniquelocal',
    ]);
  });
});

describe('the client address behind a limit, with the shipped TRUST_PROXY', () => {
  it('ignores a forged X-Forwarded-For from a peer it does not trust', () => {
    expect(ipOf('203.0.113.9', '1.1.1.1')).toBe('203.0.113.9');
    expect(ipOf('203.0.113.9', '1.1.1.1, 2.2.2.2, 10.0.0.1')).toBe('203.0.113.9');
  });

  it('believes the proxy it trusts, and takes the right-most untrusted address, so a forged left-hand entry is ignored', () => {
    expect(ipOf('10.0.0.5', '198.51.100.7')).toBe('198.51.100.7');
    expect(ipOf('10.0.0.5', '1.1.1.1, 198.51.100.7')).toBe('198.51.100.7');
    expect(ipOf('172.18.0.4', '198.51.100.7, 10.1.1.1')).toBe('198.51.100.7');
  });

  it('trusts loopback, link-local and private-range proxies, and nothing public', () => {
    for (const peer of [
      '127.0.0.1',
      '::1',
      '169.254.1.1',
      '10.1.2.3',
      '172.16.5.5',
      '192.168.1.1',
      'fd00::1',
    ]) {
      expect(ipOf(peer, '198.51.100.7'), peer).toBe('198.51.100.7');
    }
    for (const peer of ['8.8.8.8', '172.32.0.1', '192.169.0.1', '2001:db8::1']) {
      expect(ipOf(peer, '198.51.100.7'), peer).toBe(peer);
    }
  });

  it('is only as good as the proxy: one that forwards the visitor header unchanged hands the client the choice', () => {
    // BY DESIGN and documented in docs/runbooks/forms-app-operator-setup.md: the relay must APPEND the address it saw.
    expect(ipOf('10.0.0.5', '9.9.9.9')).toBe('9.9.9.9');
  });

  it('with an exact hop count, believes exactly that many hops', () => {
    expect(ipOf('10.0.0.5', '1.1.1.1, 198.51.100.7', '1')).toBe('198.51.100.7');
    expect(ipOf('203.0.113.9', '1.1.1.1', '1')).toBe('1.1.1.1'); // a count trusts the first hop whoever it is: why the shipped value is a list
  });

  it('cannot be started in trust-everyone mode through the obvious spellings: Express refuses them at boot', () => {
    for (const value of ['true', '*', 'all', '0.0.0.0/0', '::/0']) {
      expect(() => ipOf('203.0.113.9', '1.1.1.1', value), value).toThrow();
    }
  });
});

describe('the counter key a client lands on', () => {
  it('gives a client rotating addresses inside one IPv6 /64 a single counter, and a plain/mapped pair one counter', () => {
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => clientKey(`2001:db8:abcd:12::${i + 1}`)),
    );
    expect(keys.size).toBe(1);
    expect(clientKey('::ffff:198.51.100.7')).toBe(clientKey('198.51.100.7'));
  });

  it('does not let a forged header choose a bucket from an untrusted peer', () => {
    const keys = new Set(
      Array.from({ length: 50 }, (_, i) => clientKey(ipOf('203.0.113.9', `1.1.${i}.1`))),
    );
    expect(keys.size).toBe(1);
  });
});
