import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { RoutingRulesRepository } from '../../../src/modules/team-inbox-routing-sla/routing-rules.repository';
import { HandoffRepository } from '../../../src/modules/team-inbox-routing-sla/handoff.repository';
import { languageMatches } from '../../../src/modules/team-inbox-routing-sla/routing-matcher';

const dialect = new PgDialect();

function capture() {
  const seen: string[] = [];
  const tx = {
    execute: async (q: SQL) => {
      seen.push(dialect.sqlToQuery(q).sql.replace(/\s+/g, ' '));
      return { rows: [] };
    },
  } as unknown as Tx;
  return { tx, seen };
}

describe('the customer language a routing rule sees', () => {
  it('falls back to the Language of the contact when the conversation has none (rules engine)', async () => {
    const { tx, seen } = capture();
    await new RoutingRulesRepository().conversationFacts(tx, 1, 2);
    expect(seen[0]).toContain('coalesce(nullif(c.customer_language');
    expect(seen[0]).toContain('nullif(ct.language');
    expect(seen[0]).toContain('LEFT JOIN contacts ct');
  });
  it('and for a handoff', async () => {
    const { tx, seen } = capture();
    await new HandoffRepository().facts(tx, 1, 2);
    expect(seen[0]).toContain('nullif(ct.language');
    expect(seen[0]).toContain('LEFT JOIN contacts ct');
  });
  it('a contact language of en matches a rule for en', () => {
    expect(languageMatches(['en'], 'en')).toBe(true);
    expect(languageMatches(['ar'], 'en')).toBe(false);
  });
});
