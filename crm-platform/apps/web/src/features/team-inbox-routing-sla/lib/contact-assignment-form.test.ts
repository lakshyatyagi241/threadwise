import { describe, expect, it } from 'vitest';
import { assignmentConditionsSchema, type AssignmentRule } from '@crm/contracts';
import { draftOf, emptyDraft, toInput, usedConditions } from './contact-assignment-form';

const U1 = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const U2 = '1c9a5f0e-5a6e-4d4e-9d58-5b0f1c1a6a11';

describe('toInput', () => {
  it('needs a name and somebody to give the work to', () => {
    expect(toInput({ ...emptyDraft(), userIds: [U1] })).toEqual({ ok: false, problem: 'name' });
    expect(toInput({ ...emptyDraft(), name: 'X' })).toEqual({ ok: false, problem: 'people' });
  });

  it('a fixed rule names exactly one person and no team', () => {
    expect(toInput({ ...emptyDraft(), name: 'X', strategy: 'fixed', userIds: [U1, U2] })).toEqual({
      ok: false,
      problem: 'fixedOne',
    });
    expect(
      toInput({ ...emptyDraft(), name: 'X', strategy: 'fixed', userIds: [U1], teamIds: [U2] }),
    ).toEqual({ ok: false, problem: 'fixedOne' });
    expect(toInput({ ...emptyDraft(), name: 'X', strategy: 'fixed', userIds: [U1] }).ok).toBe(true);
  });

  it('turns typed lists into conditions: trimmed, de-duplicated, a leading + dropped from phone prefixes', () => {
    const r = toInput({
      ...emptyDraft(),
      name: ' Web ',
      userIds: [U1],
      sources: 'Website, ads ,website\nWebsite',
      phonePrefixes: '+91, 44',
      origins: ['form'],
      properties: 'plan = Pro\nregion=North\n=ignored\n  ',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.name).toBe('Web');
    expect(r.value.conditions.sources).toEqual(['Website', 'ads', 'website']);
    expect(r.value.conditions.phonePrefixes).toEqual(['91', '44']);
    expect(r.value.conditions.properties).toEqual([
      { key: 'plan', equals: 'Pro' },
      { key: 'region', equals: 'North' },
    ]);
    expect(r.value.conditions.origins).toEqual(['form']);
  });

  it('refuses a phone prefix that is not digits and a value range that is backwards or not a number', () => {
    expect(toInput({ ...emptyDraft(), name: 'X', userIds: [U1], phonePrefixes: '9x' })).toEqual({
      ok: false,
      problem: 'prefix',
    });
    expect(
      toInput({ ...emptyDraft('deal'), name: 'X', userIds: [U1], valueMin: '100', valueMax: '50' }),
    ).toEqual({ ok: false, problem: 'value' });
    expect(toInput({ ...emptyDraft('deal'), name: 'X', userIds: [U1], valueMin: 'abc' })).toEqual({
      ok: false,
      problem: 'value',
    });
    const ok = toInput({
      ...emptyDraft('deal'),
      name: 'X',
      userIds: [U1],
      valueMin: '100',
      valueMax: '',
    });
    expect(ok.ok && ok.value.conditions.valueMin).toBe(100);
    expect(ok.ok && ok.value.conditions.valueMax).toBeNull();
  });
});

describe('draftOf and usedConditions', () => {
  const rule: AssignmentRule = {
    id: 'r1',
    name: 'India',
    subject: 'contact',
    conditions: assignmentConditionsSchema.parse({
      phonePrefixes: ['91'],
      sources: ['web', 'ads'],
      properties: [{ key: 'plan', equals: 'Pro' }],
    }),
    strategy: 'round_robin',
    userIds: [U1],
    teamIds: [],
    skipOffline: true,
    isActive: true,
    position: 1,
    firedCount: 3,
    lastFiredAt: null,
    rowVersion: 2,
  };
  it('round-trips a rule through the form', () => {
    const d = draftOf(rule);
    expect(d.sources).toBe('web, ads');
    expect(d.properties).toBe('plan=Pro');
    const back = toInput(d);
    expect(back.ok && back.value.conditions).toEqual(rule.conditions);
  });
  it('lists the conditions a rule uses, and none for a catch-all', () => {
    expect(usedConditions(rule.conditions)).toEqual(['sources', 'phonePrefixes', 'properties']);
    expect(usedConditions(assignmentConditionsSchema.parse({}))).toEqual([]);
  });
});
