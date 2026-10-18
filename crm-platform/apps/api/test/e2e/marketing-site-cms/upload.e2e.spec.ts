import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { OperatorContentResponse } from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/** TW-CMS-027: the page editor's image upload, against a fake S3 bucket. */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));
let superToken = '';
let supportToken = '';

// a 1x1 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
let s3: Server;
let s3Url = '';
const puts: Array<{ method: string; url: string }> = [];

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
  s3 = createServer((req, res) => {
    puts.push({ method: req.method!, url: req.url! });
    req.resume();
    req.on('end', () => res.writeHead(200).end());
  });
  await new Promise<void>((r) => s3.listen(0, '127.0.0.1', r));
  s3Url = `http://127.0.0.1:${(s3.address() as AddressInfo).port}`;
}, 240_000);

afterAll(async () => {
  await new Promise((r) => s3?.close(r));
  await h?.stop();
});

const storage = (values: Record<string, unknown> = {}) => ({
  provider: 'r2',
  endpoint: s3Url,
  bucket: 'media',
  accessKeyId: 'AKID',
  visibility: 'public',
  enabled: true,
  ...values,
});
const setStorage = async (values: Record<string, unknown>) => {
  const url = '/v2/platform/settings/groups/storage';
  const cur = (await api().get(url).set(bearer(superToken))).body as { rowVersion: number };
  const res = await api()
    .patch(url)
    .set(bearer(superToken))
    .send({ rowVersion: cur.rowVersion, values, secrets: { secret: 'bucket-secret' } });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  h.app.get(PlatformSettingsService).invalidate();
};
const upload = (token: string, file: Buffer, name: string, key?: string) => {
  const r = api()
    .post('/v2/platform/cms/content/upload')
    .set(bearer(token))
    .attach('file', file, name);
  return key ? r.field('key', key) : r;
};
const operatorContent = async () =>
  (await api().get('/v2/platform/cms/content').set(bearer(superToken)))
    .body as OperatorContentResponse;
const events = async (like: string) =>
  (
    await h.owner.query(
      `SELECT event, actor_type, status FROM security_events WHERE event LIKE $1 ORDER BY id`,
      [like],
    )
  ).rows as Array<{ event: string; actor_type: string; status: string }>;

beforeEach(async () => {
  puts.length = 0;
  await h.owner.query(`DELETE FROM frontend_content`);
  await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'set.%'`);
  h.app.get(PlatformSettingsService).invalidate();
});

describe('editor image upload (TW-CMS-027)', () => {
  it('refuses while media storage is local disk', async () => {
    const res = await upload(superToken, PNG, 'a.png');
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('public cloud object storage');
    expect(puts).toHaveLength(0);
  });

  it('refuses a private bucket that has no CDN address', async () => {
    await setStorage(storage({ visibility: 'private' }));
    expect((await upload(superToken, PNG, 'a.png')).status).toBe(422);
    expect(puts).toHaveLength(0);
  });

  it('stores the image on the bucket and answers its address; with a link key it becomes that field draft', async () => {
    await setStorage(storage());
    const res = await upload(superToken, PNG, 'hero.png', 'home.hero.cta1_url');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.url).toMatch(/\/media\/site\/\d+_[0-9a-f]+\.png$/);
    expect(puts.map((p) => p.method)).toEqual(['PUT']);
    expect(puts[0]!.url).toMatch(/^\/media\/site\/\d+_[0-9a-f]+\.png$/);
    const entry = (await operatorContent()).entries.find((e) => e.key === 'home.hero.cta1_url');
    expect(entry?.draft).toBe(res.body.url);
    expect((await events('platform.cms.image_uploaded')).at(-1)).toMatchObject({
      actor_type: 'platform_operator',
      status: 'success',
    });
  });

  it('without a key only the address comes back and nothing is drafted or audited', async () => {
    await setStorage(storage());
    const before = (await events('platform.cms.image_uploaded')).length;
    const res = await upload(superToken, PNG, 'x.png');
    expect(res.status).toBe(200);
    expect((await operatorContent()).entries).toHaveLength(0);
    expect(await events('platform.cms.image_uploaded')).toHaveLength(before);
  });

  it('refuses a key that is not an address field, an invalid key, SVG, a file over 4 MB and a non-image', async () => {
    await setStorage(storage());
    expect((await upload(superToken, PNG, 'a.png', 'home.hero.headline')).status).toBe(422);
    expect((await upload(superToken, PNG, 'a.png', 'no such key!')).status).toBe(422);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect((await upload(superToken, svg, 'a.svg')).status).toBe(422);
    const big = Buffer.concat([PNG, Buffer.alloc(4 * 1024 * 1024)]);
    const tooBig = await upload(superToken, big, 'big.png');
    expect(tooBig.status).toBe(422);
    expect(JSON.stringify(tooBig.body)).toContain('too_large');
    expect((await upload(superToken, Buffer.from('not an image'), 'a.png')).status).toBe(422);
    expect(puts).toHaveLength(0);
  });

  it('is for super admins: a support operator gets 403, an anonymous caller 401', async () => {
    expect((await upload(supportToken, PNG, 'a.png')).status).toBe(403);
    expect(
      (await api().post('/v2/platform/cms/content/upload').attach('file', PNG, 'a.png')).status,
    ).toBe(401);
  });
});
