import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { CompaniesRepository } from '../../../src/modules/crm/companies/companies.repository';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository';

/**
 * MT-066: pickers and typeaheads return only the caller's workspace, and a search string can never widen the query.
 * The repositories are run against a recording transaction and the SQL they build is rendered, so no database is needed.
 */
const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

function recordingSelectTx() {
  const seen: { where?: SQL } = {};
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = (w: SQL) => {
    seen.where = w;
    return chain;
  };
  chain.orderBy = () => chain;
  chain.limit = async () => [];
  const tx = { select: () => chain };
  return { tx: tx as never, seen };
}

function recordingExecuteTx() {
  const seen: { query?: SQL } = {};
  const tx = {
    execute: async (q: SQL) => {
      seen.query = q;
      return { rows: [] };
    },
  };
  return { tx: tx as never, seen };
}

const HOSTILE = "x' OR 1=1 --";

describe('MT-066: contacts picker', () => {
  const repo = ContactsRepository as unknown as new () => ContactsRepository;

  it('always carries the workspace id as the first, bound predicate, ANDed with the search', async () => {
    const { tx, seen } = recordingSelectTx();
    await new repo().selectData(tx, 41, { q: 'ann', limit: 10, scope: 'all', actorUserId: 9 });
    const { sql, params } = render(seen.where!);
    expect(sql).toMatch(/^\("contacts"\."org_id" = \$1 and /);
    expect(params[0]).toBe(41);
  });

  it('a hostile search string is a bound parameter, never SQL text', async () => {
    const { tx, seen } = recordingSelectTx();
    await new repo().selectData(tx, 41, { q: HOSTILE, limit: 10, scope: 'all', actorUserId: 9 });
    const { sql, params } = render(seen.where!);
    expect(sql).not.toContain('1=1');
    expect(sql).not.toContain('--');
    // the search splits on spaces: every piece is its own bound ILIKE pattern
    expect(params).toContain('%1=1%');
    expect(sql).toMatch(/^\("contacts"\."org_id" = \$1 and /);
  });

  it('record scope narrows further and never replaces the workspace predicate', async () => {
    for (const scope of ['own', 'team'] as const) {
      const { tx, seen } = recordingSelectTx();
      await new repo().selectData(tx, 41, { limit: 10, scope, actorUserId: 9 });
      const { sql, params } = render(seen.where!);
      expect(sql).toMatch(/^\("contacts"\."org_id" = \$1 and /);
      expect(params[0]).toBe(41);
    }
  });

  it('an actor with no user id under a narrowed scope matches nothing', async () => {
    const { tx, seen } = recordingSelectTx();
    await new repo().selectData(tx, 41, { limit: 10, scope: 'own', actorUserId: null });
    expect(render(seen.where!).sql).toContain('false');
  });
});

describe('MT-066: companies picker', () => {
  const repo = CompaniesRepository as unknown as new () => CompaniesRepository;

  it('filters by the workspace id as a bound parameter', async () => {
    const { tx, seen } = recordingExecuteTx();
    await new repo().selectData(tx, 41, { q: 'acme', limit: 10 });
    const { sql, params } = render(seen.query!);
    expect(sql).toMatch(/c\.org_id\s*=\s*\$/i);
    expect(params).toContain(41);
  });

  it('a hostile search string is a bound parameter', async () => {
    const { tx, seen } = recordingExecuteTx();
    await new repo().selectData(tx, 41, { q: HOSTILE, limit: 10 });
    const { sql, params } = render(seen.query!);
    expect(sql).not.toContain('1=1');
    expect(params.some((p) => typeof p === 'string' && p.includes('1=1'))).toBe(true);
    expect(params).toContain(41);
  });
});
