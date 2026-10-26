import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Tx } from '@crm/db';
import { recordCampaignClick } from '../../../src/modules/broadcasts/tracking/link-redirect.service';
import { OPTED_OUT } from '../../../src/modules/campaigns/campaigns.repository';

const dialect = new PgDialect();
const textOf = (q: SQL) => dialect.sqlToQuery(q).sql.replace(/\s+/g, ' ').trim();

function fakeTx(firstTap: boolean | null) {
  const statements: string[] = [];
  const tx = {
    execute: async (q: SQL) => {
      const text = textOf(q);
      statements.push(text);
      if (text.startsWith('UPDATE wp_campaign_contacts')) {
        return { rows: firstTap === null ? [] : [{ first_tap: firstTap }] };
      }
      return { rows: [] };
    },
  } as unknown as Tx;
  return { tx, statements };
}

describe('recordCampaignClick', () => {
  it('stamps the recipient and raises the campaign click count on the first tap', async () => {
    const { tx, statements } = fakeTx(true);
    await recordCampaignClick(tx, 1, 7, 9);
    expect(statements.some((s) => s.startsWith('UPDATE wp_campaign_contacts'))).toBe(true);
    expect(statements.some((s) => s.startsWith('UPDATE wpcampaigns SET clicked_count'))).toBe(true);
  });
  it('does not count the same contact twice on the campaign', async () => {
    const { tx, statements } = fakeTx(false);
    await recordCampaignClick(tx, 1, 7, 9);
    expect(statements.some((s) => s.startsWith('UPDATE wpcampaigns'))).toBe(false);
  });
  it('leaves the campaign alone when the contact is not one of its recipients', async () => {
    const { tx, statements } = fakeTx(null);
    await recordCampaignClick(tx, 1, 7, 9);
    expect(statements.some((s) => s.startsWith('UPDATE wpcampaigns'))).toBe(false);
  });
});

describe('OPTED_OUT', () => {
  it('counts a contact who opted out after the message was sent, not only a STOP reported on the row', () => {
    const t = (OPTED_OUT as unknown as { queryChunks: Array<{ value: string[] }> }).queryChunks
      .flatMap((c) => c.value)
      .join('');
    expect(t).toContain('r.is_unsubscribed');
    expect(t).toContain('c.is_unsubscribed');
    expect(t).toContain('r.sent_at');
  });
});
