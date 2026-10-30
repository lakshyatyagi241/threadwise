import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { CampaignsRepository } from '../../../src/modules/campaigns/campaigns.repository';

const dialect = new PgDialect();
const textOf = (q: SQL) => dialect.sqlToQuery(q).sql.replace(/\s+/g, ' ').trim();

function fakeTx(rows: unknown[]) {
  const statements: string[] = [];
  const tx = {
    execute: async (q: SQL) => {
      statements.push(textOf(q));
      return { rows };
    },
  } as unknown as Tx;
  return { tx, statements };
}

describe('CampaignsRepository.identityOf', () => {
  it('returns only the public id and name', async () => {
    const { tx } = fakeTx([{ uuid: 'u-1', name: 'Diwali' }]);
    expect(await new CampaignsRepository().identityOf(tx, 1, 7)).toEqual({
      uuid: 'u-1',
      name: 'Diwali',
    });
  });

  it('is undefined for a campaign that does not exist', async () => {
    const { tx } = fakeTx([]);
    expect(await new CampaignsRepository().identityOf(tx, 1, 7)).toBeUndefined();
  });

  // The per-receipt path runs this once per delivery report. If it ever joins the recipients or the charges again, a large
  // broadcast costs O(recipients) per receipt (about 140 ms at 30k recipients) and the database saturates.
  it('reads the campaign row alone, never the recipients or the charges', async () => {
    const { tx, statements } = fakeTx([{ uuid: 'u-1', name: 'Diwali' }]);
    await new CampaignsRepository().identityOf(tx, 1, 7);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatch(/FROM wpcampaigns WHERE org_id = \$1 AND id = \$2$/);
    // The column is campaign_name; a bare `name` fails on every receipt in production (#1491 shipped that).
    expect(statements[0]).toMatch(/^SELECT uuid, campaign_name AS name FROM/);
    expect(statements[0]).not.toMatch(/wp_campaign_contacts|usage_charges|JOIN/i);
  });
});
