import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  extensionFor,
  isBlockedAddress,
  resolveMime,
  SafeFetch,
  UnsafeMediaUrlError,
} from '../../../src/infra/providers/node-bridge-runtime/safe-fetch';

describe('blocked addresses (TW-NODE-028 rule 1)', () => {
  it.each([
    '0.0.0.0',
    '0.1.2.3',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1',
    '100.127.255.255',
    '127.0.0.1',
    '127.255.0.9',
    '169.254.169.254',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '224.0.0.1',
    '239.255.255.255',
    '240.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'febf::1',
    'fc00::1',
    'fdff::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.5',
    '::ffff:169.254.169.254',
    '[::1]',
  ])('refuses %s', (a) => expect(isBlockedAddress(a)).toBe(true));

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.15.255.255',
    '172.32.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '169.253.0.1',
    '223.255.255.255',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('allows %s', (a) => expect(isBlockedAddress(a)).toBe(false));

  it('a name is not an address', () => expect(isBlockedAddress('example.com')).toBe(false));
});

describe('media type (TW-NODE-028 rule 3)', () => {
  it('uses the server type, else the extension, else a binary default', () => {
    expect(resolveMime('image/png; charset=binary', 'https://x.test/a')).toBe('image/png');
    expect(resolveMime(undefined, 'https://x.test/files/report.PDF?sig=1')).toBe('application/pdf');
    expect(resolveMime('application/octet-stream', 'https://x.test/a.mp4')).toBe('video/mp4');
    expect(resolveMime(undefined, 'https://x.test/blob')).toBe('application/octet-stream');
  });

  it('names a download so an image is not delivered as .bin, defaulting to .jpg', () => {
    expect(extensionFor('image/png', 'https://x.test/blob')).toBe('.png');
    expect(extensionFor('application/pdf', 'https://x.test/a.pdf')).toBe('.pdf');
    expect(extensionFor('application/octet-stream', 'https://x.test/blob')).toBe('.jpg');
  });
});

describe('SafeFetch', () => {
  let server: Server;
  let base = '';
  const hits: string[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      hits.push(req.url!);
      if (req.url === '/redirect-internal') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data' }).end();
      } else if (req.url === '/hop1') {
        res.writeHead(302, { location: '/hop2' }).end();
      } else if (req.url === '/hop2') {
        res.writeHead(301, { location: '/doc.pdf' }).end();
      } else if (req.url === '/loop') {
        res.writeHead(302, { location: '/loop' }).end();
      } else if (req.url === '/doc.pdf') {
        res.writeHead(200).end('%PDF-1.4 body'); // no content-type: the extension decides
      } else if (req.url === '/big') {
        res.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.alloc(2048));
      } else if (req.url === '/missing') {
        res.writeHead(404).end();
      } else {
        res.writeHead(200, { 'content-type': 'image/png' }).end('PNGDATA');
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  const open = () => {
    const f = new SafeFetch();
    f.isBlocked = () => false; // the stand-in server is on loopback
    return f;
  };

  it('refuses an internal host before connecting (cloud metadata, loopback, private)', async () => {
    const f = new SafeFetch();
    for (const url of [
      'http://169.254.169.254/latest/meta-data',
      `${base}/x`,
      'http://10.0.0.5/a.png',
      'http://[::1]/a.png',
      'http://[::ffff:127.0.0.1]/a.png',
    ]) {
      await expect(f.fetchMedia(url), url).rejects.toThrow('Blocked internal media host');
    }
    expect(hits).toHaveLength(0);
  });

  it('refuses a name that resolves to an internal address (every address is checked)', async () => {
    await expect(new SafeFetch().fetchMedia('http://localhost/a.png')).rejects.toThrow(
      'Blocked internal media host',
    );
  });

  it('refuses a non-http scheme, a local path and a malformed value', async () => {
    const f = new SafeFetch();
    for (const url of [
      'file:///etc/passwd',
      'ftp://x.test/a.png',
      '../../.env',
      '/etc/passwd',
      'data:text/plain,hi',
    ]) {
      await expect(f.fetchMedia(url), url).rejects.toBeInstanceOf(UnsafeMediaUrlError);
    }
  });

  it('downloads, and reports the type and extension', async () => {
    const m = await open().fetchMedia(`${base}/img`);
    expect(m.buffer.toString()).toBe('PNGDATA');
    expect(m).toMatchObject({ mimetype: 'image/png', extension: '.png' });
  });

  it('a .pdf served without a content-type is a document with application/pdf', async () => {
    const m = await open().fetchMedia(`${base}/doc.pdf`);
    expect(m).toMatchObject({ mimetype: 'application/pdf', extension: '.pdf' });
  });

  it('follows up to 3 redirects, resolving relative targets', async () => {
    const m = await open().fetchMedia(`${base}/hop1`);
    expect(m.finalUrl).toBe(`${base}/doc.pdf`);
  });

  it('stops at more than 3 redirects', async () => {
    await expect(open().fetchMedia(`${base}/loop`)).rejects.toThrow('Too many redirects');
  });

  it('checks every hop: an allowed host cannot bounce the request to an internal one', async () => {
    const f = new SafeFetch();
    f.isBlocked = (a) => isBlockedAddress(a) && a !== '127.0.0.1'; // only the first host is "public"
    await expect(f.fetchMedia(`${base}/redirect-internal`)).rejects.toThrow(
      'Blocked internal media host',
    );
  });

  it('refuses a download over the size cap, and reports a failing host', async () => {
    await expect(open().fetchMedia(`${base}/big`, { maxBytes: 1024 })).rejects.toThrow(
      'larger than',
    );
    await expect(open().fetchMedia(`${base}/missing`)).rejects.toThrow('HTTP 404');
  });
});
