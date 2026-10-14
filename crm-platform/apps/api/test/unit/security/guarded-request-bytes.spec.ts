import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { guardedRequest } from '../../../src/infra/net/guarded-http';

describe('guardedRequest sends raw bytes exactly as given', () => {
  it('keeps a body that is not valid UTF-8 byte for byte, with the right Content-Length', async () => {
    const payload = new Uint8Array([0x7b, 0xff, 0xfe, 0x00, 0x80, 0x7d]);
    let got: Buffer = Buffer.alloc(0);
    let length = '';
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      length = String(req.headers['content-length']);
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        got = Buffer.concat(chunks);
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const res = await guardedRequest({
      method: 'POST',
      url: new URL(`http://127.0.0.1:${port}/hook`),
      headers: { 'content-type': 'application/octet-stream' },
      body: payload,
      timeoutMs: 3000,
      allowPrivate: true, // the stand-in server is on loopback
      maxBytes: 1024,
    });
    server.close();
    expect(res.status).toBe(200);
    expect(Buffer.from(got).equals(Buffer.from(payload))).toBe(true);
    expect(length).toBe(String(payload.byteLength));
  });
});
