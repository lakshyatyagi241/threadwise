import { describe, expect, it } from 'vitest';
import { groups } from '../transform/misc';
import type { Ctx, Outcome, TargetRef } from '../transform/types';

const users: Record<string, TargetRef> = {
  u_ahmad: { id: 7, uuid: 'uuid-7', table: 'users' },
};
const ctx = {
  fallbackAt: '2026-06-01T00:00:00.000Z',
  ref: (collection: string, key: unknown) =>
    collection === 'user' ? users[String(key)] : undefined,
  idx: {},
} as unknown as Ctx;

const list = (over: Record<string, unknown>) => ({
  _id: 'l1',
  id: 'MARKETING_LIST_AAAA1111',
  name: 'Documents_post',
  created_time: '2026-09-09T18:42:00Z',
  modified_time: '2026-09-09T19:12:00Z',
  ...over,
});
const rowOf = (o: Outcome) => {
  if (o.kind !== 'rows') throw new Error(`expected rows, got ${o.kind}`);
  return o.rows[0]!.row;
};

describe('a migrated contact list keeps who created it', () => {
  it("reads the creator from user_id, because created_by is the creator's display name in Waboo", () => {
    const row = rowOf(
      groups.transform(list({ created_by: 'AHMAD SHAIKH', user_id: 'u_ahmad' }) as never, ctx),
    );
    expect(row).toMatchObject({ name: 'Documents_post', created_by: 7 });
  });

  it('falls back to created_by when that is itself the id of a migrated user', () => {
    expect(rowOf(groups.transform(list({ created_by: 'u_ahmad' }) as never, ctx))).toMatchObject({
      created_by: 7,
    });
  });

  it('leaves the creator empty, and keeps the list, when nobody resolves', () => {
    expect(
      rowOf(groups.transform(list({ created_by: 'AHMAD SHAIKH', user_id: 'gone' }) as never, ctx)),
    ).toMatchObject({ name: 'Documents_post', created_by: null });
    expect(rowOf(groups.transform(list({}) as never, ctx))).toMatchObject({ created_by: null });
  });
});
