import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  S3Client,
  S3Error,
  signRequest,
  EMPTY_SHA256,
  type S3Config,
} from '../../../src/modules/platform-infrastructure/offsite-backup/s3-client';
import {
  openFile,
  parseKey,
} from '../../../src/modules/platform-infrastructure/offsite-backup/seal';
import { syncOffsite } from '../../../src/modules/platform-infrastructure/offsite-backup/sync';

/**
 * The off-host copy against a real S3 server (MinIO), which verifies the request signature itself: a signing bug cannot pass here
 * the way it could against a fake that shares our code. Cloudflare R2 speaks the same protocol (SigV4, path-style, list v2).
 */
let minio: StartedTestContainer;
let cfg: S3Config;
let client: S3Client;
let dir: string;
const key = parseKey(randomBytes(32).toString('base64'));
const stamp = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');
const name = (d: Date, label = 'daily') => `desk-${label}-${stamp(d)}.dump`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

async function makeBucket(c: S3Config): Promise<void> {
  const { url, headers } = signRequest(c, { method: 'PUT', key: '', payloadSha256: EMPTY_SHA256 });
  const res = await fetch(url, { method: 'PUT', headers });
  if (!res.ok && res.status !== 409) throw new Error(`could not create the bucket: ${res.status}`);
}

beforeAll(async () => {
  minio = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({ MINIO_ROOT_USER: 'testkey', MINIO_ROOT_PASSWORD: 'testsecret-1234' })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/ready', 9000))
    .start();
  cfg = {
    endpoint: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    region: 'auto',
    bucket: 'backups',
    accessKeyId: 'testkey',
    secretAccessKey: 'testsecret-1234',
    pathStyle: true,
  };
  client = new S3Client(cfg);
  await makeBucket(cfg);
  dir = await mkdtemp(join(tmpdir(), 'offsite-'));
}, 180_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await minio?.stop();
});

const dumpFile = async (n: string, bytes: Buffer) => writeFile(join(dir, n), bytes);
const run = (over: Partial<Parameters<typeof syncOffsite>[0]> = {}) =>
  syncOffsite({ dir, client, prefix: 'desk', key, ...over });

describe('off-host sync against S3', () => {
  it('uploads sealed copies, verifies them, and a second pass uploads nothing', async () => {
    const f1 = name(daysAgo(1));
    const f2 = name(daysAgo(0), 'pre-abc1234');
    const d1 = randomBytes(300_000);
    await dumpFile(f1, d1);
    await dumpFile(f2, Buffer.from('second dump'));

    const first = await run();
    expect(first.failed).toEqual([]);
    expect(first.uploaded.sort()).toEqual([f1, f2].sort());

    const listed = (await client.list('desk/')).map((o) => o.key).sort();
    expect(listed).toEqual([`desk/${f1}.enc`, `desk/${f2}.enc`].sort());

    const again = await run();
    expect(again.uploaded).toEqual([]);
    expect(again.alreadyThere).toBe(2);

    // what is stored is sealed, and opens back to the exact bytes
    const stored = join(dir, 'stored.enc');
    await client.get(`desk/${f1}.enc`, stored);
    expect((await readFile(stored)).includes(d1.subarray(1000, 1032))).toBe(false);
    await openFile(stored, join(dir, 'restored.dump'), [key]);
    expect((await readFile(join(dir, 'restored.dump'))).equals(d1)).toBe(true);
  });

  it('copes with an empty dump directory and ignores files that are not finished dumps', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'offsite-empty-'));
    await writeFile(join(empty, '.last-ok'), '');
    await writeFile(join(empty, `${name(daysAgo(0))}.part`), 'half a dump');
    const r = await run({ dir: empty });
    expect(r).toMatchObject({ local: 0, uploaded: [], failed: [] });
    await rm(empty, { recursive: true, force: true });
  });

  it('reports a failure per file and still finishes the others', async () => {
    const good = name(daysAgo(0), 'good');
    await dumpFile(good, Buffer.from('fine'));
    const flaky = {
      list: client.list.bind(client),
      head: client.head.bind(client),
      delete: client.delete.bind(client),
      put: async (k: string, p: string, s: number, h: string) => {
        if (k.includes('good')) throw new S3Error(500, 'InternalError', 'boom');
        return client.put(k, p, s, h);
      },
    };
    const next = name(daysAgo(0), 'next');
    await dumpFile(next, Buffer.from('also fine'));
    const r = await run({ client: flaky });
    expect(r.failed.map((f) => f.file)).toEqual([good]);
    expect(r.uploaded).toContain(next);
    // the failed one is retried and succeeds on the next pass
    expect((await run()).uploaded).toEqual([good]);
  });

  it('rejects a corrupted upload: size or checksum that does not match', async () => {
    const f = name(daysAgo(0), 'corrupt');
    await dumpFile(f, randomBytes(5000));
    const lying = {
      list: client.list.bind(client),
      delete: client.delete.bind(client),
      put: client.put.bind(client),
      head: async (k: string) => {
        const h = await client.head(k);
        return h && k.includes('corrupt') ? { ...h, etag: '0'.repeat(32) } : h;
      },
    };
    const r = await run({ client: lying });
    expect(r.failed).toEqual([{ file: f, error: 'checksum differs after upload' }]);
  });

  it('prunes by the 30 daily + 12 monthly policy, and only names it recognises', async () => {
    const tag = randomBytes(3).toString('hex');
    const p = `prune${tag}`;
    const put = async (n: string) => {
      await dumpFile(n, Buffer.from(n));
    };
    const keepers: string[] = [];
    const goners: string[] = [];
    // 4 recent dumps, 2 dumps in one old month (first kept), an unrelated file
    for (const [age, kept] of [
      [1, true],
      [2, true],
      [3, true],
      [10, true],
      [200, true],
      [201, false],
      [202, false],
    ] as const) {
      const n = name(daysAgo(age), `p${tag}`);
      (kept ? keepers : goners).push(n);
    }
    // make the two old ones fall in the same calendar month for sure: use fixed dates in a month 6 months back
    const base = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 6, 10, 2, 0, 0),
    );
    const oldFirst = name(base, `p${tag}`);
    const oldSecond = name(new Date(base.getTime() + 86_400_000), `p${tag}`);
    const prefixDir = await mkdtemp(join(tmpdir(), 'offsite-prune-'));
    for (const n of [...keepers.slice(0, 4), oldFirst, oldSecond])
      await writeFile(join(prefixDir, n), n);
    await writeFile(join(prefixDir, 'README.txt'), 'not a dump');
    await put(`desk-ignored-${stamp(new Date())}.dump`).catch(() => undefined);

    const first = await syncOffsite({ dir: prefixDir, client, prefix: p, key, prune: false });
    expect(first.failed).toEqual([]);
    // an unrelated object in the same folder
    const readme = join(prefixDir, 'README.txt');
    await client.put(
      `${p}/README.txt`,
      readme,
      10,
      (await import('node:crypto')).createHash('sha256').update('not a dump').digest('hex'),
    );

    const pruned = await syncOffsite({ dir: prefixDir, client, prefix: p, key });
    expect(pruned.pruned).toEqual([`${p}/${oldSecond}.enc`]);
    const left = (await client.list(`${p}/`)).map((o) => o.key);
    expect(left).toContain(`${p}/${oldFirst}.enc`);
    expect(left).toContain(`${p}/README.txt`);
    expect(left).not.toContain(`${p}/${oldSecond}.enc`);
    await rm(prefixDir, { recursive: true, force: true });
  });

  it('follows list pages: more than one page of objects', async () => {
    const p = `many${randomBytes(3).toString('hex')}`;
    const f = join(dir, 'tiny.txt');
    await writeFile(f, 'x');
    const sha = (await import('node:crypto')).createHash('sha256').update('x').digest('hex');
    await Promise.all(
      Array.from({ length: 1030 }, (_, i) =>
        client.put(`${p}/obj-${String(i).padStart(4, '0')}`, f, 1, sha),
      ),
    );
    const all = await client.list(`${p}/`);
    expect(all).toHaveLength(1030);
    expect(new Set(all.map((o) => o.key)).size).toBe(1030);
  }, 120_000);

  it('handles keys with spaces, plus signs and unicode', async () => {
    const f = join(dir, 'odd.txt');
    await writeFile(f, 'odd');
    const sha = (await import('node:crypto')).createHash('sha256').update('odd').digest('hex');
    const k = 'desk/odd name+with é/中文 (1).txt';
    await client.put(k, f, 3, sha);
    expect((await client.head(k))?.size).toBe(3);
    expect((await client.list('desk/odd name')).map((o) => o.key)).toContain(k);
    await client.delete(k);
    expect(await client.head(k)).toBeNull();
  });

  it('says why when the credentials are wrong or the bucket is missing', async () => {
    const bad = new S3Client({ ...cfg, secretAccessKey: 'not-the-secret' });
    await expect(bad.list('desk/')).rejects.toMatchObject({ status: 403 });
    const gone = new S3Client({ ...cfg, bucket: 'no-such-bucket' });
    await expect(gone.list('desk/')).rejects.toMatchObject({ status: 404, code: 'NoSuchBucket' });
  });

  it('delete is idempotent and head of a missing key is null', async () => {
    await client.delete('desk/never-existed');
    expect(await client.head('desk/never-existed')).toBeNull();
  });

  it('leaves the local dumps exactly as they were', async () => {
    const f = name(daysAgo(0), 'untouched');
    await dumpFile(f, Buffer.from('keep me'));
    const when = new Date('2026-01-01T00:00:00Z');
    await utimes(join(dir, f), when, when);
    await run();
    expect((await readFile(join(dir, f))).toString()).toBe('keep me');
  });
});
