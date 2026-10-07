import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { isBlockedAddress, ipv6Groups } from '../../../src/infra/net/blocked-address';
import { guardedRequest, isPrivateAddress } from '../../../src/infra/net/guarded-http';

const BLOCKED = [
  '127.0.0.1',
  '0.0.0.0',
  '10.1.2.3',
  '100.64.0.1',
  '169.254.169.254',
  '172.16.0.1',
  '172.31.255.255',
  '192.168.0.1',
  '192.88.99.1',
  '198.18.0.1',
  '224.0.0.1',
  '255.255.255.255',
  '::',
  '::1',
  '::ffff:127.0.0.1', // IPv4-mapped, dotted
  '::ffff:7f00:1', // the same address in the hex form Node and DNS use
  '::ffff:a9fe:a9fe', // metadata address, hex
  '::ffff:0a00:0001', // 10.0.0.1, long hex
  '0:0:0:0:0:ffff:7f00:1', // fully expanded
  '::FFFF:7F00:1', // upper case
  '::7f00:1', // deprecated IPv4-compatible
  '::8.8.8.8', // compatible form is never legitimate
  '64:ff9b::7f00:1', // NAT64 of loopback
  '64:ff9b::a9fe:a9fe', // NAT64 of metadata
  '2002:7f00:1::1', // 6to4 of loopback
  '2002:a9fe:a9fe::1', // 6to4 of metadata
  '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
  '2001:db8::1',
  '100::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'fe80::1%eth0',
  'fec0::1',
  'ff02::1',
  'not-an-ip',
  '',
];

const PUBLIC = [
  '93.184.216.34',
  '8.8.8.8',
  '172.15.255.255',
  '172.32.0.1',
  '100.63.255.255',
  '100.128.0.1',
  '2606:4700:4700::1111',
  '::ffff:8.8.8.8',
  '::ffff:0808:0808', // the same, hex
  '64:ff9b::808:808',
  '2002:808:808::1',
];

describe('the shared address rule', () => {
  it.each(BLOCKED)('%j is blocked', (a) => expect(isBlockedAddress(a)).toBe(true));
  it.each(PUBLIC)('%s is public', (a) => expect(isBlockedAddress(a)).toBe(false));

  it('Node spells a mapped literal in hex, and that spelling is blocked', () => {
    expect(new URL('http://[::ffff:127.0.0.1]/').hostname).toBe('[::ffff:7f00:1]');
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);
    expect(new URL('http://[::ffff:169.254.169.254]/').hostname).toBe('[::ffff:a9fe:a9fe]');
  });

  it('expands groups, and rejects text that is not an address', () => {
    expect(ipv6Groups('::ffff:7f00:1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(ipv6Groups('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x102, 0x304]);
    expect(ipv6Groups('1:2:3')).toBeNull();
    expect(ipv6Groups('::g')).toBeNull();
  });
});

describe('guardedRequest (infra/net/guarded-http)', () => {
  const base = {
    method: 'GET',
    headers: {},
    timeoutMs: 2000,
    allowPrivate: false,
    maxBytes: 100,
  } as const;

  it('isPrivateAddress is the shared rule, hex-mapped forms included', () => {
    for (const a of BLOCKED) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of PUBLIC) expect(isPrivateAddress(a), a).toBe(false);
  });

  it.each(['::ffff:127.0.0.1', '::ffff:169.254.169.254', '64:ff9b::7f00:1', '2002:7f00:1::1'])(
    'refuses the literal http://[%s]/ before any connection',
    async (host) => {
      let hit = false;
      const server = createServer((_, res) => {
        hit = true;
        res.end('secret');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      const { port } = server.address() as AddressInfo;
      try {
        await expect(
          guardedRequest({ ...base, url: new URL(`http://[${host}]:${port}/`) }),
        ).rejects.toThrow(/private networks/);
        expect(hit).toBe(false);
      } finally {
        server.close();
      }
    },
  );

  it('allowPrivate still lets a private literal through to the caller (an operator opt-in)', async () => {
    const server = createServer((_, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await guardedRequest({
        ...base,
        allowPrivate: true,
        url: new URL(`http://127.0.0.1:${port}/`),
      });
      expect(res.body).toBe('ok');
    } finally {
      server.close();
    }
  });
});
