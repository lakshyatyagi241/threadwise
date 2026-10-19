import { describe, expect, it } from 'vitest';
import type { AssignmentRule } from '@crm/contracts';
import {
  draftChanged,
  draftOf,
  draftProblems,
  emptyDraft,
  toCreateInput,
  toUpdateInput,
  withStrategy,
} from './draft';

const U1 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const U2 = '1c9a5f0e-5a6e-4d4e-9d58-5b0f1c1a6a11';
const T1 = '2f6c1c2e-0d52-4a9e-8f2f-0e6b6c8f7a10';

describe('rule form', () => {
  it('starts as round robin that skips offline people and does not reassign', () => {
    expect(emptyDraft('deal')).toMatchObject({
      subject: 'deal',
      strategy: 'round_robin',
      skipOffline: true,
      reassignOnUpdate: false,
    });
  });

  it('needs a name and somebody', () => {
    expect(draftProblems(emptyDraft('contact'))).toEqual(['name', 'people']);
    expect(draftProblems({ ...emptyDraft('contact'), name: ' A ', teamIds: [T1] })).toEqual([]);
  });

  it('a specific-user rule needs exactly one person and no team', () => {
    const d = { ...emptyDraft('contact'), name: 'A', strategy: 'fixed' as const };
    expect(draftProblems({ ...d, userIds: [U1, U2] })).toEqual(['fixedOne']);
    expect(draftProblems({ ...d, userIds: [U1], teamIds: [T1] })).toEqual(['fixedOne']);
    expect(draftProblems({ ...d, userIds: [U1] })).toEqual([]);
  });

  it('switching to a specific user cuts the pool down to one person', () => {
    const d = { ...emptyDraft('contact'), userIds: [U1, U2], teamIds: [T1] };
    expect(withStrategy(d, 'fixed')).toMatchObject({ userIds: [U1], teamIds: [] });
    expect(withStrategy(d, 'least_busy')).toMatchObject({ userIds: [U1, U2], teamIds: [T1] });
  });

  it('builds the create input and an update input that carries the row version, never the module', () => {
    const d = { ...emptyDraft('company'), name: '  Retail  ', userIds: [U1] };
    expect(toCreateInput(d, null, false)).toMatchObject({
      name: 'Retail',
      subject: 'company',
      rules: null,
      isActive: false,
    });
    const update = toUpdateInput(d, null, 4);
    expect(update).toMatchObject({ rowVersion: 4, name: 'Retail' });
    expect('subject' in update).toBe(false);
    expect('isActive' in update).toBe(false);
    expect(toUpdateInput(d, null, 4, true).isActive).toBe(true);
  });

  it('notices a change', () => {
    const rule = {
      name: 'R',
      description: '',
      subject: 'contact',
      strategy: 'round_robin',
      userIds: [U1],
      teamIds: [],
      skipOffline: true,
      reassignOnUpdate: false,
    } as unknown as AssignmentRule;
    const a = draftOf(rule);
    expect(draftChanged(a, draftOf(rule))).toBe(false);
    expect(draftChanged({ ...a, userIds: [U2] }, a)).toBe(true);
    expect(draftChanged({ ...a, reassignOnUpdate: true }, a)).toBe(true);
  });
});
