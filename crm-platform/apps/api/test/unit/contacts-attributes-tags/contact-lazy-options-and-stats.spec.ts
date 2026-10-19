import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import {
  FIELD_INLINE_OPTIONS_MAX,
  listFieldsQuerySchema,
  searchFieldOptionsQuerySchema,
} from '@crm/contracts';
import { ContactMessageStatsRepository } from '../../../src/modules/crm/contact-message-stats/contact-message-stats.repository';

const dialect = new PgDialect();

describe('GET /fields option listing', () => {
  it('keeps short lists inline by default and can ask for every option', () => {
    expect(listFieldsQuerySchema.parse({ moduleKey: 'contacts' }).options).toBe('inline');
    expect(listFieldsQuerySchema.parse({ moduleKey: 'contacts', options: 'all' }).options).toBe('all');
    expect(FIELD_INLINE_OPTIONS_MAX).toBeGreaterThan(0);
  });

  it('searches options by text or reads exact stored values, one page at a time', () => {
    const q = searchFieldOptionsQuerySchema.parse({ q: ' ber ', values: 'a,b', limit: '20' });
    expect(q.q).toBe('ber');
    expect(q.values).toEqual(['a', 'b']);
    expect(q.limit).toBe(20);
    expect(searchFieldOptionsQuerySchema.parse({}).limit).toBe(50);
    expect(searchFieldOptionsQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});

describe('the WhatsApp counters of a contact', () => {
  it('counts the messages of the contact in WhatsApp conversations only, system notices left out', async () => {
    let seen: SQL | undefined;
    const tx = {
      execute: vi.fn(async (q: SQL) => {
        seen = q;
        return { rows: [{ sent: 5, delivered: '4', seen: 3, received: 2, failed: 1, replied: 2 }] };
      }),
    };
    const out = await new ContactMessageStatsRepository().whatsapp(tx as never, 7, 99);
    expect(out).toEqual({ sent: 5, delivered: 4, seen: 3, received: 2, failed: 1, replied: 2 });
    const { sql, params } = dialect.sqlToQuery(seen!);
    expect(sql).toContain("ch.kind LIKE 'whatsapp%'");
    expect(sql).toContain("sender_kind <> 'system'");
    expect(sql).toContain('lead(msg.direction)');
    expect(params).toEqual([7, 99, 7]);
  });

  it('is zero for a contact that never talked on WhatsApp', async () => {
    const tx = { execute: vi.fn(async () => ({ rows: [] })) };
    expect(await new ContactMessageStatsRepository().whatsapp(tx as never, 1, 2)).toEqual({
      sent: 0,
      delivered: 0,
      seen: 0,
      received: 0,
      failed: 0,
      replied: 0,
    });
  });
});
