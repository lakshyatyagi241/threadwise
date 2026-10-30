import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';
import { ContactsRepository } from '../../../src/modules/crm/contacts/contacts.repository';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service';

/**
 * Legacy #13078: the flow "Update contact" step read the whole `data` object and wrote the whole object back, so two writers of
 * different keys at the same moment (two steps, or a step and a form) overwrote each other. The write is now one statement that sets
 * the one key. No database: the transaction is a fake.
 */
const dialect = new PgDialect();
const sqlOf = (q: unknown) => dialect.sqlToQuery(q as never);

describe('ContactsRepository.setDataKey', () => {
  it('merges one key into data in a single statement', async () => {
    const execute = vi.fn(async () => ({ rows: [{ id: 9 }] }));
    const ok = await new ContactsRepository().setDataKey(
      { execute } as never,
      1,
      9,
      'city',
      'Pune',
    );
    expect(ok).toBe(true);
    const q = sqlOf(execute.mock.calls[0]![0]);
    expect(q.sql).toContain('data = data || jsonb_build_object(');
    expect(q.sql).toContain('org_id =');
    expect(q.params).toEqual(['city', 'Pune', 1, 9]);
  });

  it('reports false when the contact is gone', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    expect(await new ContactsRepository().setDataKey({ execute } as never, 1, 9, 'a', 'b')).toBe(
      false,
    );
  });
});

describe('flow writes of a custom contact property', () => {
  function build() {
    const tx = {
      execute: vi.fn(async (q: unknown) => {
        const s = sqlOf(q).sql;
        if (s.includes('FROM contacts'))
          return { rows: [{ uuid: 'u1', current: null, data: { other: 'kept' } }] };
        if (s.includes('FROM fields')) return { rows: [{ '?column?': 1 }] };
        return { rows: [] };
      }),
    };
    const repo = {
      setDataKey: vi.fn(async () => true),
      updateFieldsById: vi.fn(async () => true),
      findById: vi.fn(async () => ({ data: { other: 'kept' } })),
    };
    const svc = Object.create(ContactsService.prototype) as Record<string, unknown>;
    svc.db = { txAs: async (_c: unknown, fn: (t: unknown) => unknown) => fn(tx) };
    svc.repo = repo;
    svc.audit = { record: vi.fn(async () => undefined) };
    svc.outbox = { emit: vi.fn(async () => undefined) };
    return { svc: svc as unknown as ContactsService, repo };
  }

  it('setFieldFromFlow sets the one key and never rewrites the whole data object', async () => {
    const { svc, repo } = build();
    expect(await svc.setFieldFromFlow(1, 9, 'city', ' Pune ')).toEqual({ stored: 'Pune' });
    expect(repo.setDataKey).toHaveBeenCalledWith(expect.anything(), 1, 9, 'city', 'Pune');
    expect(repo.updateFieldsById).not.toHaveBeenCalled();
  });

  it('setPropertyFromFlow sets the one key and never rewrites the whole data object', async () => {
    const { svc, repo } = build();
    expect(await svc.setPropertyFromFlow(1, 9, 'city', 'Pune')).toBe(true);
    expect(repo.setDataKey).toHaveBeenCalledWith(expect.anything(), 1, 9, 'city', 'Pune');
    expect(repo.updateFieldsById).not.toHaveBeenCalled();
  });
});
