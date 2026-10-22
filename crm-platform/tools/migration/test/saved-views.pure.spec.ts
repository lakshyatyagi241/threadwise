import { describe, expect, it } from 'vitest';
import { savedViews } from '../transform/segments';
import type { Ctx, Outcome, TargetRef } from '../transform/types';
import type { Doc } from '../util';

const ctx = (owner: TargetRef | undefined) =>
  ({
    fallbackAt: '2026-06-01T00:00:00.000Z',
    ref: (collection: string) => (collection === 'user' ? owner : undefined),
    idx: { hasUsers: false },
  }) as unknown as Ctx;

const view = (sharedWith: string, createdBy: string | null = 'u1', accessType?: string) => ({
  _id: 'v1',
  id: 'v1',
  name: 'ISKM-RY26',
  type: 'custom',
  shared_with: sharedWith,
  created_by: createdBy,
  position: 0,
  access_type: accessType,
});

const rowsOf = (outcome: Outcome) => {
  if (outcome.kind !== 'rows') throw new Error(`expected rows, got ${outcome.kind}`);
  return outcome.rows;
};
const rowOf = (outcome: Outcome) => rowsOf(outcome)[0]!.row;

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

  it('a private view with no migrated owner stays private, as in Waboo', () => {
    const row = rowOf(savedViews.transform(view('me', null) as never, ctx(undefined)));
    expect(row).toMatchObject({ is_shared: false, share_mode: 'me', created_by: null });
  });

  it('a view whose shared_with is neither everyone nor me stays private, as in Waboo', () => {
    const row = rowOf(savedViews.transform(view('selected') as never, ctx(owner)));
    expect(row).toMatchObject({ is_shared: false, share_mode: 'me', created_by: 7 });
  });

  it('share_mode is a column the loader writes and reconciles', () => {
    const spec = savedViews.tables.contact_views!;
    expect(spec.columns.map((c) => c.name)).toContain('share_mode');
    expect(spec.fp).toContain('share_mode');
  });
});

describe('saved views: access written from Waboo access_type', () => {
  const owner = { id: 7, uuid: 'uuid-7', table: 'users' };

  it('a view shared with everyone keeps can_view', () => {
    const row = rowOf(savedViews.transform(view('everyone', 'u1', 'can_view') as never, ctx(owner)));
    expect(row).toMatchObject({ share_mode: 'everyone', access_type: 'can_view' });
  });

  it('a view shared with everyone with can_edit keeps can_edit', () => {
    const row = rowOf(savedViews.transform(view('everyone', 'u1', 'can_edit') as never, ctx(owner)));
    expect(row).toMatchObject({ share_mode: 'everyone', access_type: 'can_edit' });
  });

  it('a private view is can_edit for its creator, as WaDesk records it', () => {
    const row = rowOf(savedViews.transform(view('me', 'u1', 'can_view') as never, ctx(owner)));
    expect(row).toMatchObject({ share_mode: 'me', access_type: 'can_edit' });
  });

  it('an access_type that is neither can_view nor can_edit falls back to can_view with a soft issue', () => {
    const outcome = savedViews.transform(view('everyone', 'u1', 'owner') as never, ctx(owner));
    expect(rowOf(outcome)).toMatchObject({ access_type: 'can_view' });
    expect(outcome.kind === 'rows' && outcome.soft.map((s) => s.code)).toContain('ACCESS_TYPE_UNKNOWN');
  });

  it('access_type is a column the loader writes and reconciles', () => {
    const spec = savedViews.tables.contact_views!;
    expect(spec.columns.map((c) => c.name)).toContain('access_type');
    expect(spec.fp).toContain('access_type');
  });
});

describe('saved views: people listed on a view become a selected share', () => {
  // user_list keys are Waboo user ids; ids maps each to a migrated user id
  const usersCtx = (ids: Record<string, number>) =>
    ({
      fallbackAt: '2026-06-01T00:00:00.000Z',
      ref: (collection: string, key: unknown) =>
        collection === 'user' && ids[String(key)] !== undefined
          ? { id: ids[String(key)], uuid: `uuid-${String(key)}`, table: 'users' }
          : undefined,
      idx: { hasUsers: false },
    }) as unknown as Ctx;
  const ids = { u1: 7, u2: 8 };
  const listed = (sharedWith: string, userList: unknown[], accessType = 'can_edit') => ({
    ...view(sharedWith, 'u1', accessType),
    user_list: userList,
  });
  const outcomeOf = (doc: unknown) => savedViews.transform(doc as Doc, usersCtx(ids));

  it('a view kept to its creator that lists another migrated person is a selected share with that person', () => {
    const outcome = outcomeOf(listed('me', ['u1', 'u2']));
    expect(rowsOf(outcome)[0]!.row).toMatchObject({ share_mode: 'selected', is_shared: true, access_type: 'can_edit', created_by: 7 });
    expect(rowsOf(outcome).slice(1)).toEqual([{ table: 'contact_view_users', sub: '#person:8', row: { user_id: 8 } }]);
  });

  it('a view whose list holds only its creator stays private', () => {
    const outcome = outcomeOf(listed('me', ['u1']));
    expect(rowsOf(outcome)).toHaveLength(1);
    expect(rowsOf(outcome)[0]!.row).toMatchObject({ share_mode: 'me', is_shared: false });
  });

  it('a listed person who is not a migrated user is skipped with a soft issue, and the view stays private', () => {
    const outcome = outcomeOf(listed('me', ['u1', 'gone']));
    expect(rowsOf(outcome)).toHaveLength(1);
    expect(rowsOf(outcome)[0]!.row).toMatchObject({ share_mode: 'me' });
    expect(outcome.kind === 'rows' && outcome.soft.map((s) => s.code)).toContain('USER_LIST_UNRESOLVED');
  });

  it('a selected share keeps can_view when Waboo says can_view', () => {
    const outcome = outcomeOf(listed('me', ['u1', 'u2'], 'can_view'));
    expect(rowsOf(outcome)[0]!.row).toMatchObject({ share_mode: 'selected', access_type: 'can_view' });
  });

  it('a view shared with everyone ignores its list', () => {
    const outcome = outcomeOf(listed('everyone', ['u1', 'u2']));
    expect(rowsOf(outcome)).toHaveLength(1);
    expect(rowsOf(outcome)[0]!.row).toMatchObject({ share_mode: 'everyone' });
  });

  it('contact_view_users is a keyless child of contact_views on view_id', () => {
    expect(savedViews.tables.contact_view_users!.keyless).toEqual({ parent: 'contact_views', parentCol: 'view_id' });
  });
});
