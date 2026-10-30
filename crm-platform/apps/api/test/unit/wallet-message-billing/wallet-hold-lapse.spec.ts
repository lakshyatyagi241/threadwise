import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { WalletRepository } from '../../../src/modules/wallet-message-billing/wallet.repository';

const dialect = new PgDialect();
const textOf = (q: SQL) => dialect.sqlToQuery(q).sql.replace(/\s+/g, ' ').trim();

// Each answer is what the next statement returns: [] means "nothing held".
function fakeTx(answers: Array<Array<{ id: number }>>) {
  const statements: string[] = [];
  const tx = {
    execute: async (q: SQL) => {
      statements.push(textOf(q));
      return { rows: answers.shift() ?? [] };
    },
  } as unknown as Tx;
  return { tx, statements };
}
const lapses = (s: string[]) => s.filter((x) => /WITH lapsed AS/.test(x)).length;

describe('WalletRepository.holdMinor', () => {
  // A send that is covered must not scan every open hold of the workspace: 7,000 open holds cost 22 ms per send and every send queued
  // behind the wallet row.
  it('holds a covered send with one statement and no lapse scan', async () => {
    const { tx, statements } = fakeTx([[{ id: 9 }]]);
    expect(await new WalletRepository().holdMinor(tx, 1, 'INR', 531, 3600)).toBe(9);
    expect(statements).toHaveLength(1);
    expect(lapses(statements)).toBe(0);
  });

  it('gives back lapsed holds only when the first try is not covered, then tries once more', async () => {
    const { tx, statements } = fakeTx([[], [], [{ id: 12 }]]);
    expect(await new WalletRepository().holdMinor(tx, 1, 'INR', 531, 3600)).toBe(12);
    expect(statements).toHaveLength(3);
    expect(lapses(statements)).toBe(1);
    expect(statements[1]).toMatch(/^WITH lapsed AS/);
  });

  it('returns null when it is still not covered after the lapse', async () => {
    const { tx, statements } = fakeTx([[], [], []]);
    expect(await new WalletRepository().holdMinor(tx, 1, 'INR', 531, 3600)).toBeNull();
    expect(statements).toHaveLength(3);
  });
});
