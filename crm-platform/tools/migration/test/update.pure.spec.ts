import { describe, expect, it } from 'vitest';
import { decide, diffColumns, skipFor, updatableSteps } from '../load/update';
import { STEPS } from '../transform';

const cols = [
  { name: 'name', pg: 'text' },
  { name: 'data', pg: 'jsonb' },
  { name: 'owner_id', pg: 'bigint' },
  { name: 'updated_at', pg: 'timestamptz' },
  { name: 'is_unsubscribed', pg: 'boolean' },
];
const have = {
  name: 'Asha',
  data: { b: 1, a: [1, 2] },
  owner_id: 5,
  updated_at: '2026-04-02T11:30:00.000000',
  is_unsubscribed: false,
};

describe('update mode: what differs', () => {
  it('an equal row has no difference (key order, millisecond vs microsecond, string vs number ids)', () => {
    const want = { name: 'Asha', data: { a: [1, 2], b: 1 }, owner_id: '5', updated_at: '2026-04-02T11:30:00.000Z', is_unsubscribed: false };
    expect(diffColumns(cols, new Set(), want, have)).toEqual([]);
  });
  it('names exactly the columns that changed, nulls included', () => {
    const want = { ...have, name: 'Asha2', owner_id: null, data: { b: 1, a: [1, 3] } };
    expect(diffColumns(cols, new Set(), want, have)).toEqual(['name', 'data', 'owner_id']);
  });
  it('a skipped column never counts', () => {
    expect(diffColumns(cols, new Set(['name']), { ...have, name: 'x' }, have)).toEqual([]);
  });
  it('a document with no usable date does not compare its dates (the fallback moves with every export)', () => {
    const ts = { columns: [], skipCompare: ['display_id'] };
    expect([...skipFor(ts, ['x'], true)].sort()).toEqual(['created_at', 'display_id', 'updated_at', 'x']);
    expect([...skipFor(ts, undefined, false)]).toEqual(['display_id']);
  });
});

describe('update mode: the local-edit rule', () => {
  it('unchanged beats everything', () => {
    expect(decide([], 7, 1)).toBe('unchanged');
  });
  it('a row still at the version the loader inserted (1) is updated', () => {
    expect(decide(['name'], 1)).toBe('update');
  });
  it('a row someone updated since the load is left', () => {
    expect(decide(['name'], 2)).toBe('conflict');
  });
  it('a row at the version this tool left is updated again; a later edit is a conflict', () => {
    expect(decide(['name'], 3, 3)).toBe('update');
    expect(decide(['name'], 4, 3)).toBe('conflict');
  });
});

describe('update mode: which steps opt in', () => {
  it('the people, definitions, tags, lists, memberships and broadcasts', () => {
    expect(updatableSteps().map((s) => s.handler)).toEqual([
      'field_sections',
      'field_defs',
      'field_options',
      'lifecycle',
      'lifecycle_status',
      'tags',
      'groups',
      'contacts',
      'group_members',
      'campaigns',
      'recipients',
    ]);
  });
  it('--steps narrows, and refuses a step that cannot be updated', () => {
    expect(updatableSteps(['contacts']).map((s) => s.handler)).toEqual(['contacts']);
    expect(() => updatableSteps(['notes'])).toThrow(/cannot be updated/);
  });
  it('an opted-in step writes only keyed tables (the matching is by uuid)', () => {
    for (const s of STEPS.filter((x) => x.update))
      for (const t of Object.values(s.tables)) expect(t.keyless || t.custom || t.noUuid || t.windowCol).toBeFalsy();
  });
  it('only a link step may prune, and it never prunes a contact that is gone', () => {
    expect(STEPS.filter((s) => s.update?.prune).map((s) => s.handler)).toEqual(['group_members']);
  });
});

describe('update mode: broadcasts never touch what could send', () => {
  const spec = (h: string) => STEPS.find((s) => s.handler === h)!;
  it('retry switches are not written and only terminal / delivery values are allowed', () => {
    expect(spec('campaigns').update?.ignore).toContain('retry_enabled');
    expect(spec('recipients').update?.ignore).toContain('retry_count');
    expect(spec('campaigns').update?.allow?.status).toEqual(['completed', 'failed', 'cancelled']);
    expect(spec('recipients').update?.allow?.status).not.toContain('pending');
  });
  it('no retry / next-attempt control column is among the written columns', () => {
    for (const h of ['campaigns', 'recipients'])
      for (const t of Object.values(spec(h).tables))
        for (const c of t.columns.map((x) => x.name))
          expect(/^(next_attempt_at|retry_state|retry_next_at|retry_first_sent_at|retry_until)$/.test(c)).toBe(false);
  });
  it('send_attempts stays updatable (a row turning failed carries the sweeper-proof value together with its status)', () => {
    expect(spec('recipients').update?.ignore).not.toContain('send_attempts');
  });
  it('flows, credits and chat are not updatable', () => {
    expect(() => updatableSteps(['inbox'])).toThrow(/cannot be updated/);
    expect(() => updatableSteps(['credit_wallet'])).toThrow(/cannot be updated/);
    expect(() => updatableSteps(['flow_bots'])).toThrow(/cannot be updated/);
  });
});
