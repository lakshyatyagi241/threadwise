import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { withTenant } from '@crm/db';

/**
 * withTenant sets the row-level-security settings in ONE statement per transaction (every extra statement is a network round trip
 * in front of every request). What must not change: each value is a bind parameter, the setting is transaction-local, nothing runs
 * before it, and a missing user or impersonation is handled as before. The isolation itself is proven against a real database by
 * the RLS suites; this pins the statement.
 */
const dialect = new PgDialect();

function fake() {
  const sent: Array<{ sql: string; params: unknown[] }> = [];
  const order: string[] = [];
  const tx = {
    execute: async (q: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const { sql, params } = dialect.sqlToQuery(q);
      sent.push({ sql, params });
      order.push('set');
      return { rows: [] };
    },
  };
  const db = { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  return { db: db as never, sent, order };
}

describe('withTenant', () => {
  it('sets org and user in one statement, as bind parameters, before the callback runs', async () => {
    const { db, sent, order } = fake();
    await withTenant(db, { orgId: 7, userId: 3 }, async () => order.push('callback'));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual(['7', '3']);
    expect(sent[0]!.sql).toMatch(/set_config\('app\.org_id', \$1, true\)/);
    expect(sent[0]!.sql).toMatch(/set_config\('app\.user_id', \$2, true\)/);
    expect(sent[0]!.sql).not.toMatch(/\b7\b|\b3\b/); // the values never appear in the SQL text
    expect(order).toEqual(['set', 'callback']);
  });

  it('sets an empty user for a request with no staff user', async () => {
    const { db, sent } = fake();
    await withTenant(db, { orgId: 7, userId: null }, async () => undefined);
    expect(sent[0]!.params).toEqual(['7', '']);
  });

  it('adds the act-as settings to the same statement', async () => {
    const { db, sent } = fake();
    await withTenant(
      db,
      {
        orgId: 7,
        userId: 3,
        impersonation: { operatorUuid: 'op-uuid', sessionUuid: 'sess-uuid' },
      },
      async () => undefined,
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.params).toEqual(['7', '3', 'op-uuid', 'sess-uuid']);
    expect(sent[0]!.sql).toMatch(/set_config\('app\.impersonator_id', \$3, true\)/);
    expect(sent[0]!.sql).toMatch(/set_config\('app\.impersonation_id', \$4, true\)/);
  });

  it('still refuses to run without a valid org', async () => {
    const { db, sent } = fake();
    await expect(withTenant(db, { orgId: 0 }, async () => undefined)).rejects.toThrow(/orgId/);
    expect(sent).toHaveLength(0);
  });

  it('returns what the callback returns', async () => {
    const { db } = fake();
    expect(await withTenant(db, { orgId: 7 }, async () => 'ok')).toBe('ok');
  });
});
