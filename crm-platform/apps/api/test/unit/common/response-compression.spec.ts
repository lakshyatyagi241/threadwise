import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { COMPRESSION_THRESHOLD_BYTES, responseCompression } from '../../../src/common/http/response-compression';

/** QA 63: large JSON is compressed, small bodies and event streams are not, and a client can opt out. */

const rows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Contact number ${i}`, email: `person${i}@example.test` }));
const app = express();
app.use(responseCompression());
app.get('/big', (_req, res) => res.json({ data: rows }));
app.get('/small', (_req, res) => res.json({ ok: true }));
app.get('/stream', (_req, res) => {
  res.type('text/event-stream');
  res.send('data: ' + 'x'.repeat(COMPRESSION_THRESHOLD_BYTES * 2) + '\n\n');
});

describe('responseCompression', () => {
  it('compresses a large JSON response for a client that accepts gzip', async () => {
    const res = await request(app).get('/big').set('accept-encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.body.data).toHaveLength(200); // supertest inflates it again: the bytes survive the round trip
  });

  it('sends the body as it is when the client does not accept compression', async () => {
    const res = await request(app).get('/big').set('accept-encoding', 'identity');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('leaves a body under the threshold alone', async () => {
    const res = await request(app).get('/small').set('accept-encoding', 'gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('never compresses an event stream', async () => {
    const res = await request(app).get('/stream').set('accept-encoding', 'gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('honours x-no-compression', async () => {
    const res = await request(app).get('/big').set('accept-encoding', 'gzip').set('x-no-compression', '1');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

});
