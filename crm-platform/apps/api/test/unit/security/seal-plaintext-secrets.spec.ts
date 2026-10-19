import { randomBytes } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { tokenHash } from '../../../src/common/crypto/secret-columns';
import {
  sealPlaintextSecrets,
  SEAL_TARGETS,
  type SealDb,
  type SealTarget,
} from '../../../src/common/crypto/seal-plaintext-secrets';

/** The backfill for encryption audit E2, E3, E7, E8, driven over a scripted connection (no database). */
const key = randomBytes(32).toString('base64');
const crypto = new CryptoService({
  get: (n: string) => (n === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS' ? '' : key),
} as unknown as ConfigService<never, true>);

type Row = Record<string, unknown>;

/** One table in memory; understands just the statements the backfill sends. */
function fakeDb(rows: Row[], plain: string): SealDb & { rows: Row[] } {
  const isPlain = (r: Row) =>
    typeof r[plain] === 'string' && r[plain] !== '' && !String(r[plain]).startsWith('v1:');
  return {
    rows,
    async query(text, params = []) {
      if (/^SELECT count/.test(text)) {
        const n = rows.filter(
          (r) => isPlain(r) && (/NOT LIKE/.test(text) || r.hash == null),
        ).length;
        return { rows: [{ n }] };
      }
      if (/^SELECT/.test(text)) {
        const todo = rows.filter((r) =>
          /NOT LIKE/.test(text) ? isPlain(r) : r.hash == null && isPlain(r),
        );
        return { rows: todo.map((r) => ({ org_id: r.org_id, id: r.id, value: r[plain] })) };
      }
      const row = rows.find((r) => r.org_id === params[0] && r.id === params[1]);
      if (!row || row[plain] !== params[2]) return { rows: [] };
      if (/SET "auth"/.test(text)) row[plain] = params[3];
      else {
        row.hash = params[3];
        if (params[4] !== undefined) row.enc = params[4];
      }
      return { rows: [{ ok: 1 }] };
    },
  };
}

describe('sealPlaintextSecrets', () => {
  it('seals a plaintext push auth secret in place, leaves sealed rows alone, and is idempotent', async () => {
    const already = crypto.encrypt('b');
    const db = fakeDb(
      [
        { org_id: 1, id: 1, auth: 'a-plain' },
        { org_id: 1, id: 2, auth: already },
      ],
      'auth',
    );
    const [r] = await sealPlaintextSecrets(db, crypto);
    expect(r).toMatchObject({ target: 'push_subscriptions.auth', found: 1, done: 1, skipped: 0 });
    expect(db.rows[0]!.auth).not.toBe('a-plain');
    expect(crypto.decrypt(String(db.rows[0]!.auth))).toBe('a-plain');
    expect(db.rows[1]!.auth).toBe(already);
    const [again] = await sealPlaintextSecrets(db, crypto);
    expect(again).toMatchObject({ found: 0, done: 0 });
  });

  it('a dry run counts and writes nothing', async () => {
    const db = fakeDb([{ org_id: 1, id: 1, auth: 'a-plain' }], 'auth');
    const [r] = await sealPlaintextSecrets(db, crypto, { dryRun: true });
    expect(r).toMatchObject({ found: 1, done: 0 });
    expect(db.rows[0]!.auth).toBe('a-plain');
  });

  it('fills the lookup hash and the sealed copy of a plaintext token', async () => {
    const target: SealTarget = {
      name: 't.token',
      table: 't',
      pk: ['org_id', 'id'],
      plain: 'token',
      hash: 'hash',
      enc: 'enc',
    };
    const db = fakeDb([{ org_id: 1, id: 1, token: 'tok-1', hash: null, enc: null }], 'token');
    const [r] = await sealPlaintextSecrets(db, crypto, { targets: [target] });
    expect(r).toMatchObject({ found: 1, done: 1 });
    expect(db.rows[0]!.hash).toBe(tokenHash('tok-1'));
    expect(crypto.decrypt(String(db.rows[0]!.enc))).toBe('tok-1');
  });

  it('every target names a table.column', () => {
    for (const t of SEAL_TARGETS) expect(t.name).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });
});
