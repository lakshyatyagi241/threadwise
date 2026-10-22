import { describe, expect, it } from 'vitest';
import { savedViews } from '../transform/segments';
import type { Ctx, Outcome, TargetRef } from '../transform/types';

const ctx = (owner: TargetRef | undefined) =>
  ({
    fallbackAt: '2026-06-01T00:00:00.000Z',
    ref: (collection: string) => (collection === 'user' ? owner : undefined),
    idx: { hasUsers: false },
  }) as unknown as Ctx;

const view = (sharedWith: string, createdBy: string | null = 'u1') => ({
  _id: 'v1',
  id: 'v1',
  name: 'ISKM-RY26',
  type: 'custom',
  shared_with: sharedWith,
  created_by: createdBy,
  position: 0,
});

const rowOf = (outcome: Outcome) => {
  if (outcome.kind !== 'rows') throw new Error(`expected rows, got ${outcome.kind}`);
  return outcome.rows[0]!.row;
};

describe('saved views: sharing written with the view', () => {
  const owner = { id: 7, uuid: 'uuid-7', table: 'users' };

  it('a view shared with everyone is shared as everyone, so people other than its creator see it', () => {
    const row = rowOf(savedViews.transform(view('everyone') as never, ctx(owner)));
    expect(row).toMatchObject({ is_shared: true, share_mode: 'everyone', created_by: 7 });
  });

  it('a view kept to its creator stays private as me', () => {
    const row = rowOf(savedViews.transform(view('me') as never, ctx(owner)));
    expect(row).toMatchObject({ is_shared: false, share_mode: 'me', created_by: 7 });
  });

  it('a private view with no migrated owner is shared as everyone, so it does not vanish for everyone', () => {
    const row = rowOf(savedViews.transform(view('me', null) as never, ctx(undefined)));
    expect(row).toMatchObject({ is_shared: true, share_mode: 'everyone', created_by: null });
  });

  it('share_mode is a column the loader writes and reconciles', () => {
    const spec = savedViews.tables.contact_views!;
    expect(spec.columns.map((c) => c.name)).toContain('share_mode');
    expect(spec.fp).toContain('share_mode');
  });
});
