import { createCipheriv, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  reencryptSecrets,
  type SecretsDb,
} from '../../../src/modules/auth/maintenance/reencrypt-secrets';

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');
const OLD = key(1);
const NEW = key(2);
const NEWER = key(3);

const service = (current: string, previous?: string) =>
  new CryptoService({
    get: (k: string) =>
      k === 'CREDENTIALS_ENCRYPTION_KEY'
        ? current
        : k === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS'
          ? previous
          : undefined,
  } as unknown as ConfigService<never, true>);

/** A blob in the format written before key ids existed: `v1:<iv>:<tag>:<ct>`. */
function legacyBlob(base64Key: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(base64Key, 'base64'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ct.toString('base64'),
  ].join(':');
}

describe('encryption key ring (TW-AUTH-047)', () => {
  it('writes the id of the sealing key into every blob, as a trailing segment', () => {
    const c = service(NEW);
    const blob = c.encrypt('secret');
    const parts = blob.split(':');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('v1');
    expect(parts[4]).toBe(c.currentKeyId);
    expect(c.keyIdOf(blob)).toBe(c.currentKeyId);
    expect(c.isCurrent(blob)).toBe(true);
  });

  it('keeps the four-segment layout readable by an instance that predates key ids', () => {
    // A rolling deploy: the old reader destructures four segments and ignores the rest.
    const c = service(NEW);
    const [version, iv, tag, data] = c.encrypt('rolling').split(':');
    expect(version).toBe('v1');
    expect([iv, tag, data].every(Boolean)).toBe(true);
    const legacyReader = service(NEW);
    expect(legacyReader.decrypt([version, iv, tag, data].join(':'))).toBe('rolling');
  });

  it('reads a blob sealed with a retired key while that key is in the previous list', () => {
    const sealedByOld = service(OLD).encrypt('mfa-seed');
    const rotated = service(NEW, OLD);
    expect(rotated.decrypt(sealedByOld)).toBe('mfa-seed');
    expect(rotated.isCurrent(sealedByOld)).toBe(false);
    expect(rotated.keyIdOf(sealedByOld)).toBe(service(OLD).currentKeyId);
  });

  it('opens blobs written before key ids existed, trying each key in the ring', () => {
    const legacy = legacyBlob(OLD, 'old-secret');
    expect(service(NEW, OLD).decrypt(legacy)).toBe('old-secret');
    expect(service(OLD).decrypt(legacy)).toBe('old-secret');
    expect(service(OLD).keyIdOf(legacy)).toBeNull();
    expect(service(OLD).isCurrent(legacy)).toBe(false);
  });

  it('says which key is missing instead of failing with a bare auth error', () => {
    const sealedByOld = service(OLD).encrypt('x');
    expect(() => service(NEW).decrypt(sealedByOld)).toThrow(/not in the key ring/);
    // A legacy blob names no key: it just fails to authenticate against every key.
    expect(() => service(NEW).decrypt(legacyBlob(OLD, 'x'))).toThrow();
  });

  it('re-seals under the current key and leaves a current blob untouched', () => {
    const rotated = service(NEWER, `${OLD},${NEW}`);
    const fromOld = service(OLD).encrypt('a');
    const fromNew = service(NEW).encrypt('b');
    const already = rotated.encrypt('c');

    const a = rotated.reencrypt(fromOld);
    expect(rotated.isCurrent(a)).toBe(true);
    expect(rotated.decrypt(a)).toBe('a');
    expect(rotated.decrypt(rotated.reencrypt(fromNew))).toBe('b');
    expect(rotated.reencrypt(already)).toBe(already);
  });

  it('does not list the current key twice and rejects a malformed previous key', () => {
    expect(() => service(NEW, `${NEW},${OLD}`)).not.toThrow();
    expect(() => service(NEW, Buffer.alloc(8).toString('base64'))).toThrow(/32 bytes/);
  });

  it('treats a tampered key id or segment as malformed or unauthenticated, never as plaintext', () => {
    const c = service(NEW);
    const parts = c.encrypt('secret').split(':');
    expect(() => c.decrypt(parts.slice(0, 3).join(':'))).toThrow(/malformed/);
    expect(() => c.decrypt([...parts.slice(0, 4), ''].join(':'))).toThrow(/malformed/);
    expect(() => c.decrypt([...parts.slice(0, 4), 'deadbeef'].join(':'))).toThrow(/key ring/);
  });
});

/** A tiny in-memory stand-in for the three tables, enough to follow the SQL by its intent. */
function fakeDb(rows: {
  settings: Array<{ key: string; value: string }>;
  users: Array<{ org_id: string; user_id: string; blob: string }>;
  operators: Array<{ id: string; blob: string }>;
}): SecretsDb {
  return {
    async query(text, params = []) {
      if (text.includes('FROM platform_settings')) {
        const after = params[0] as string | null;
        return {
          rows: rows.settings.filter((r) => after === null || r.key > after).map((r) => ({ ...r })),
        };
      }
      if (text.startsWith('UPDATE platform_settings')) {
        const row = rows.settings.find((r) => r.key === params[0]);
        if (!row || JSON.stringify(row.value) !== (params[1] as string)) return { rows: [] };
        row.value = JSON.parse(params[2] as string) as string;
        return { rows: [{ '?column?': 1 }] };
      }
      if (text.includes('FROM user_security')) {
        return { rows: after(params[0]) ? [] : rows.users.map((r) => ({ ...r })) };
      }
      if (text.startsWith('UPDATE user_security')) {
        const row = rows.users.find((r) => r.org_id === params[0] && r.user_id === params[1]);
        if (!row || row.blob !== params[2]) return { rows: [] };
        row.blob = params[3] as string;
        return { rows: [{ '?column?': 1 }] };
      }
      if (text.includes('FROM platform_operators')) {
        return { rows: after(params[0]) ? [] : rows.operators.map((r) => ({ ...r })) };
      }
      if (text.startsWith('UPDATE platform_operators')) {
        const row = rows.operators.find((r) => r.id === params[0]);
        if (!row || row.blob !== params[1]) return { rows: [] };
        row.blob = params[2] as string;
        return { rows: [{ '?column?': 1 }] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
  function after(v: unknown): boolean {
    return v !== null && v !== undefined;
  }
}

describe('re-encrypt command', () => {
  // The settings table holds the blob as a JSON string, so the fake keeps it that way.
  const settingsRow = (k: string, blob: string) => ({ key: k, value: blob });

  it('moves every secret off the retired key, skips current ones, reports the unreadable ones', async () => {
    const oldC = service(OLD);
    const next = service(NEW, OLD);
    const current = next.encrypt('already');
    const unreadable = service(NEWER).encrypt('lost-key');
    const rows = {
      settings: [
        settingsRow('otp.sender.waba.1', oldC.encrypt('graph-token')),
        settingsRow('recaptcha.secret', current),
        settingsRow('social.google.secret', legacyBlob(OLD, 'google-secret')),
      ],
      users: [{ org_id: '1', user_id: '7', blob: oldC.encrypt('totp-seed') }],
      operators: [{ id: '3', blob: unreadable }],
    };
    const db = fakeDb(rows);

    const dry = await reencryptSecrets(db, next, { dryRun: true });
    expect(dry.map((r) => [r.scanned, r.current, r.rewritten, r.failed.length])).toEqual([
      [3, 1, 2, 0],
      [1, 0, 1, 0],
      [1, 0, 0, 1],
    ]);
    // A dry run writes nothing.
    expect(next.isCurrent(rows.users[0]!.blob)).toBe(false);

    const real = await reencryptSecrets(db, next);
    expect(real[0]).toMatchObject({ scanned: 3, current: 1, rewritten: 2, failed: [] });
    expect(real[1]).toMatchObject({ rewritten: 1 });
    expect(real[2]!.failed).toEqual(['operator 3']);

    expect(rows.settings.every((r) => next.isCurrent(r.value))).toBe(true);
    expect(next.decrypt(rows.settings[0]!.value)).toBe('graph-token');
    expect(next.decrypt(rows.settings[2]!.value)).toBe('google-secret');
    expect(next.decrypt(rows.users[0]!.blob)).toBe('totp-seed');
    // Never deleted or overwritten: the key that opens it may still turn up.
    expect(rows.operators[0]!.blob).toBe(unreadable);

    // Idempotent: nothing left to do for what could be moved.
    const again = await reencryptSecrets(db, next);
    expect(again.map((r) => r.rewritten)).toEqual([0, 0, 0]);
  });

  it('does not clobber a secret that changed while it was running', async () => {
    const oldC = service(OLD);
    const next = service(NEW, OLD);
    const rows = {
      settings: [settingsRow('recaptcha.secret', oldC.encrypt('before'))],
      users: [],
      operators: [],
    };
    const base = fakeDb(rows);
    const racing: SecretsDb = {
      async query(text, params) {
        if (text.startsWith('UPDATE platform_settings')) {
          // someone saves a new secret between our read and our write
          rows.settings[0]!.value = next.encrypt('saved-meanwhile');
        }
        return base.query(text, params);
      },
    };
    const [report] = await reencryptSecrets(racing, next);
    expect(report!.rewritten).toBe(0);
    expect(report!.failed[0]).toMatch(/changed while running/);
    expect(next.decrypt(rows.settings[0]!.value)).toBe('saved-meanwhile');
  });
});
