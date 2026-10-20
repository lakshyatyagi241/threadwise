import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SenderLease } from '../../../src/modules/broadcasts/send-safety';

/** MT-039: a distributed lock of one workspace must never block, or be released by, another workspace. */

class FakeRedis {
  readonly store = new Map<string, string>();
  async set(key: string, value: string, ..._opts: unknown[]) {
    if (this.store.has(key)) return null;
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async del(key: string) {
    this.store.delete(key);
  }
  async pexpire() {
    return 1;
  }
}

describe('MT-039: SenderLease is scoped by workspace', () => {
  const lease = () => {
    const redis = new FakeRedis();
    return { redis, lease: new SenderLease(redis as never) };
  };

  it('the same engine and sender id in two workspaces are two different locks', () => {
    expect(SenderLease.key(1, 'baileys', 7)).not.toBe(SenderLease.key(2, 'baileys', 7));
    expect(SenderLease.key(1, 'baileys', 7)).toContain(':1:');
  });

  it('workspace A holding its sender does not block workspace B using the same ids', async () => {
    const { lease: l } = lease();
    const a = await l.acquire(SenderLease.key(1, 'baileys', 7));
    const b = await l.acquire(SenderLease.key(2, 'baileys', 7));
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(await l.acquire(SenderLease.key(1, 'baileys', 7))).toBeNull();
  });

  it('a token from one workspace cannot release or renew another workspace lock', async () => {
    const { redis, lease: l } = lease();
    const keyA = SenderLease.key(1, 'baileys', 7);
    const keyB = SenderLease.key(2, 'baileys', 7);
    const tokenA = (await l.acquire(keyA))!;
    await l.acquire(keyB);
    await l.release(keyB, tokenA);
    expect(redis.store.has(keyB)).toBe(true);
    await l.release(keyA, tokenA);
    expect(redis.store.has(keyA)).toBe(false);
    expect(redis.store.has(keyB)).toBe(true);
  });
});

const SRC = join(__dirname, '../../../src');
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/**
 * Locks that are deliberately not per workspace, each with its reason. A new advisory lock whose key carries no workspace id must be
 * added here by someone who has read it, which is what keeps a global lock from appearing unreviewed.
 */
const PLATFORM_LOCKS: Record<string, string> = {
  'modules/addons-extension-registry/extension-store.ts':
    'the extension registry is platform-wide, keyed by slug',
  'modules/analytics/rollup/rollup.service.ts':
    'serialises the one platform-wide analytics rollup: a single watermark covers every workspace, so the pass and the nightly reconcile share one lock',
  'modules/auth/platform/impersonation.service.ts': 'keyed by the platform operator id',
  'modules/auth/platform/operator-auth.service.ts': 'keyed by the platform operator id',
  'modules/auth/platform/tenant-directory.ts':
    'sign-up happens before a workspace exists: the lock is keyed by the e-mail and the number being claimed (one identity, one account)',
  'modules/platform-payment-gateways/checkout.service.ts':
    'a coupon belongs to the platform and is shared by every workspace: the lock is keyed by the coupon so its last uses are not handed out twice',
  'modules/platform-payment-gateways/billing-settings.service.ts':
    'serialises the one platform billing-settings row',
  'modules/platform-settings-branding-storage/vapid.service.ts':
    'serialises the one platform VAPID key pair',
  'modules/shopify-woocommerce/_shims/sql-store-mirror.ts':
    'a helper that locks the key its callers pass; every call site is checked below',
};

describe('MT-039: every Postgres advisory lock carries the workspace', () => {
  const sites: Array<{ file: string; line: number; text: string }> = [];
  for (const f of walk(SRC)) {
    const lines = readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((text, i) => {
      if (text.includes('pg_advisory_xact_lock') || text.includes('pg_advisory_lock')) {
        sites.push({
          file: relative(SRC, f).replace(/\\/g, '/'),
          line: i + 1,
          text: text + (lines[i + 1] ?? ''),
        });
      }
    });
  }

  it('finds the advisory locks (a scan that sees none proves nothing)', () => {
    expect(sites.length).toBeGreaterThan(15);
  });

  it('each lock key names the workspace, or the file is a reviewed platform lock', () => {
    const bad = sites.filter(
      (s) => !/\$\{[^}]*\borgId\b/.test(s.text) && !(s.file in PLATFORM_LOCKS),
    );
    expect(bad.map((s) => `${s.file}:${s.line}`)).toEqual([]);
  });

  it('every call of the store-mirror lock helper builds its key from the workspace', () => {
    const text = readFileSync(
      join(SRC, 'modules/shopify-woocommerce/_shims/sql-store-mirror.ts'),
      'utf8',
    );
    const calls = text.split('\n').filter((l) => l.includes('await lock(tx,'));
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const c of calls) expect(c).toContain('${orgId}');
  });

  it('a platform lock file still has a lock in it (the allowlist does not rot)', () => {
    const files = new Set(sites.map((s) => s.file));
    for (const f of Object.keys(PLATFORM_LOCKS)) expect(files.has(f)).toBe(true);
  });
});
