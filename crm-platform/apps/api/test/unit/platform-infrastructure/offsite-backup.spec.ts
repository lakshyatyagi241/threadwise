import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  isDumpName,
  planRetention,
  takenAt,
} from '../../../src/modules/platform-infrastructure/offsite-backup/retention';
import { signRequest } from '../../../src/modules/platform-infrastructure/offsite-backup/s3-client';
import {
  keyIdOf,
  openFile,
  parseKey,
  sealFile,
} from '../../../src/modules/platform-infrastructure/offsite-backup/seal';

const D = (iso: string) => new Date(iso);
const dump = (iso: string, label = 'daily') =>
  `desk/desk-${label}-${iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}.dump.enc`;

describe('takenAt / isDumpName', () => {
  it('reads the time out of a dump name, with or without a folder and the .enc suffix', () => {
    expect(takenAt('desk/desk-daily-20261004T020000Z.dump.enc')?.toISOString()).toBe(
      '2026-10-04T02:00:00.000Z',
    );
    expect(takenAt('desk-pre-ab12cd34-20261004T131501Z.dump')?.toISOString()).toBe(
      '2026-10-04T13:15:01.000Z',
    );
  });
  it.each([
    'desk/connection-test-ab12.txt',
    'desk-daily-2026.dump',
    'notes.md',
    'desk-daily-20261304T020000Z.dump.enc.part',
  ])('gives no time for %s', (name) => {
    expect(takenAt(name)).toBeNull();
  });
  it('recognises exactly the names the backup service writes', () => {
    expect(isDumpName('desk-daily-20261004T020000Z.dump')).toBe(true);
    expect(isDumpName('desk-daily-20261004T020000Z.dump.part')).toBe(false);
    expect(isDumpName('.last-ok')).toBe(false);
  });
});

describe('planRetention (30 daily + 12 monthly)', () => {
  const now = D('2026-10-04T12:00:00Z');
  const plan = (isos: string[]) =>
    planRetention(
      isos.map((i) => ({ key: dump(i), at: takenAt(dump(i)) })),
      now,
    );

  it('keeps everything from the last 30 days', () => {
    const isos = Array.from({ length: 30 }, (_, i) =>
      new Date(now.getTime() - i * 86_400_000).toISOString(),
    );
    expect(plan(isos).remove).toEqual([]);
  });

  it('keeps only the first dump of each older month, and drops the rest', () => {
    const r = plan([
      '2026-07-03T02:00:00Z',
      '2026-07-04T02:00:00Z',
      '2026-07-20T02:00:00Z',
      '2026-09-01T02:00:00Z',
      '2026-09-30T02:00:00Z',
      '2026-10-03T02:00:00Z',
    ]);
    // 09-30 and 10-03 are within 30 days (and with 09-01 the newest... 09-01 is also the first of September).
    expect(r.keep).toContain(dump('2026-07-03T02:00:00Z'));
    expect(r.remove).toEqual([dump('2026-07-04T02:00:00Z'), dump('2026-07-20T02:00:00Z')]);
  });

  it('forgets months older than twelve', () => {
    const r = plan([
      '2025-09-15T02:00:00Z',
      '2025-10-15T02:00:00Z',
      '2025-11-15T02:00:00Z',
      '2026-09-30T02:00:00Z',
      '2026-10-03T02:00:00Z',
      '2026-10-04T02:00:00Z',
    ]);
    // the window is this month and the eleven before it: November 2025 to October 2026
    expect(r.remove).toEqual([dump('2025-09-15T02:00:00Z'), dump('2025-10-15T02:00:00Z')]);
    expect(r.keep).toContain(dump('2025-11-15T02:00:00Z'));
  });

  it('always keeps the newest three, even when they are old (dumps stopped months ago)', () => {
    const old = [
      '2026-01-02T02:00:00Z',
      '2026-01-03T02:00:00Z',
      '2026-01-04T02:00:00Z',
      '2026-01-05T02:00:00Z',
    ];
    expect(plan(old).keep).toEqual(expect.arrayContaining(old.slice(1).map((i) => dump(i))));
  });

  it('never lists a file it does not recognise for deletion', () => {
    const r = planRetention(
      [
        { key: 'desk/README.txt', at: null },
        { key: dump('2020-01-01T00:00:00Z'), at: takenAt(dump('2020-01-01T00:00:00Z')) },
      ],
      now,
    );
    expect(r.keep).toContain('desk/README.txt');
    expect(r.remove).not.toContain('desk/README.txt');
  });

  it('is a no-op on an empty bucket', () => {
    expect(plan([])).toEqual({ keep: [], remove: [] });
  });
});

describe('sealing a dump', () => {
  let dir: string;
  const key = parseKey(randomBytes(32).toString('base64'));
  const other = parseKey(randomBytes(32).toString('base64'));
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'seal-'));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  const sealed = async (data: Buffer, name = 'a') => {
    await writeFile(join(dir, `${name}.dump`), data);
    await sealFile(join(dir, `${name}.dump`), join(dir, `${name}.enc`), key);
    return join(dir, `${name}.enc`);
  };

  it('round-trips bytes exactly, including an empty file and binary data', async () => {
    for (const [i, data] of [
      Buffer.alloc(0),
      Buffer.from('hello'),
      randomBytes(3 * 1024 * 1024 + 7),
    ].entries()) {
      const enc = await sealed(data, `rt${i}`);
      await openFile(enc, join(dir, `rt${i}.out`), [key]);
      expect((await readFile(join(dir, `rt${i}.out`))).equals(data)).toBe(true);
    }
  });

  it('does not contain the plaintext, and two seals of the same bytes differ', async () => {
    const data = Buffer.from('SECRET-CONTACT-LIST '.repeat(50));
    const a = await readFile(await sealed(data, 'p1'));
    const b = await readFile(await sealed(data, 'p2'));
    expect(a.includes(Buffer.from('SECRET-CONTACT-LIST'))).toBe(false);
    expect(a.equals(b)).toBe(false);
  });

  it('opens with the right key among several (a rotated backup key still opens old files)', async () => {
    const enc = await sealed(Buffer.from('x'), 'rot');
    await openFile(enc, join(dir, 'rot.out'), [other, key]);
    expect((await readFile(join(dir, 'rot.out'))).toString()).toBe('x');
  });

  it('refuses a wrong key and leaves nothing behind', async () => {
    const enc = await sealed(Buffer.from('x'), 'wk');
    await expect(openFile(enc, join(dir, 'wk.out'), [other])).rejects.toThrow(
      /no key for this backup/,
    );
    await expect(stat(join(dir, 'wk.out'))).rejects.toThrow();
  });

  it('refuses a tampered file and writes no output', async () => {
    const enc = await sealed(Buffer.from('important '.repeat(100)), 'tm');
    const raw = await readFile(enc);
    raw[40] ^= 0xff;
    await writeFile(enc, raw);
    await expect(openFile(enc, join(dir, 'tm.out'), [key])).rejects.toThrow();
    await expect(stat(join(dir, 'tm.out'))).rejects.toThrow();
    await expect(stat(join(dir, 'tm.out.part'))).rejects.toThrow();
  });

  it('refuses a truncated file and something that is not a sealed backup', async () => {
    const enc = await sealed(Buffer.from('y'.repeat(1000)), 'tr');
    const raw = await readFile(enc);
    await writeFile(enc, raw.subarray(0, raw.length - 5));
    await expect(openFile(enc, join(dir, 'tr.out'), [key])).rejects.toThrow();
    await writeFile(
      join(dir, 'plain'),
      'just text, no header at all, long enough to pass the length check',
    );
    await expect(openFile(join(dir, 'plain'), join(dir, 'plain.out'), [key])).rejects.toThrow(
      /not a sealed backup/,
    );
    await writeFile(join(dir, 'tiny'), 'x');
    await expect(openFile(join(dir, 'tiny'), join(dir, 'tiny.out'), [key])).rejects.toThrow(
      /too short/,
    );
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => parseKey(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
    expect(keyIdOf(key)).toHaveLength(4);
  });
});

describe('signRequest', () => {
  const cfg = {
    endpoint: 'https://acct.r2.cloudflarestorage.com',
    region: 'auto',
    bucket: 'bk',
    accessKeyId: 'AK',
    secretAccessKey: 'SK',
    pathStyle: true,
  };
  const now = D('2026-10-04T12:00:00Z');

  it('addresses the bucket by path and encodes each key segment', () => {
    const { url } = signRequest(cfg, {
      method: 'PUT',
      key: 'desk/a b+c.dump.enc',
      payloadSha256: 'x',
      now,
    });
    expect(url.toString()).toBe('https://acct.r2.cloudflarestorage.com/bk/desk/a%20b%2Bc.dump.enc');
  });

  it('sorts and encodes list queries, and signs the payload hash it was given', () => {
    const { url, headers } = signRequest(cfg, {
      method: 'GET',
      key: '',
      query: [
        ['prefix', 'desk/'],
        ['list-type', '2'],
      ],
      payloadSha256: 'e3b0',
      now,
    });
    expect(url.search).toBe('?list-type=2&prefix=desk%2F');
    expect(headers['x-amz-content-sha256']).toBe('e3b0');
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AK\/20261004\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it('gives a different signature for a different secret or key', () => {
    const a = signRequest(cfg, { method: 'GET', key: 'k', payloadSha256: 'x', now }).headers
      .authorization;
    const b = signRequest(
      { ...cfg, secretAccessKey: 'other' },
      { method: 'GET', key: 'k', payloadSha256: 'x', now },
    ).headers.authorization;
    const c = signRequest(cfg, { method: 'GET', key: 'k2', payloadSha256: 'x', now }).headers
      .authorization;
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
