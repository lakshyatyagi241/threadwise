import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Tx } from '@crm/db';
import { lockAgentCapacity } from '../../../src/modules/team-inbox-routing-sla/routing-rules.repository';

const dialect = new PgDialect();

function fakeTx() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const tx = {
    execute: vi.fn(async (q: Parameters<PgDialect['sqlToQuery']>[0]) => {
      const { sql, params } = dialect.sqlToQuery(q);
      calls.push({ sql, params });
      return { rows: [] };
    }),
  } as unknown as Tx;
  return { tx, calls };
}

describe('lockAgentCapacity (legacy #15583)', () => {
  it('takes one advisory lock per agent, in id order, once each', async () => {
    const { tx, calls } = fakeTx();
    await lockAgentCapacity(tx, 7, [9, 4, 9, 6]);
    expect(calls.map((c) => c.params[0])).toEqual(['chat-cap:7:4', 'chat-cap:7:6', 'chat-cap:7:9']);
    expect(calls.every((c) => c.sql.includes('pg_advisory_xact_lock'))).toBe(true);
  });

  it('scopes the lock by workspace, so two workspaces never block each other', async () => {
    const { tx, calls } = fakeTx();
    await lockAgentCapacity(tx, 1, [5]);
    await lockAgentCapacity(tx, 2, [5]);
    expect(calls.map((c) => c.params[0])).toEqual(['chat-cap:1:5', 'chat-cap:2:5']);
  });

  it('locks nothing for an empty list', async () => {
    const { tx, calls } = fakeTx();
    await lockAgentCapacity(tx, 1, []);
    expect(calls).toEqual([]);
  });
});
