import { describe, expect, it } from 'vitest';
import { EMPTY_WIZARD_AUDIENCE } from '@crm/contracts';
import { uuid } from '../testing';
import { sanitizePatch } from './save-patch';

describe('sanitizePatch', () => {
  it('keeps a good patch as it is', () => {
    const p = { name: 'A', templateId: uuid(1), step: 2 as const };
    expect(sanitizePatch(p)).toEqual(p);
  });

  it('drops variables the server would refuse (empty or braces) and keeps the rest', () => {
    const out = sanitizePatch({
      variables: {
        'body.1': { kind: 'fixed', text: 'ok' },
        'body.2': { kind: 'fixed', text: '{{x}}' },
        'body.3': { kind: 'fixed', text: '' },
        'body.4': { kind: 'field', field: '', fallback: null },
        'body.5': { kind: 'field', field: 'email', fallback: null },
      },
    });
    expect(Object.keys(out.variables!)).toEqual(['body.1', 'body.5']);
  });

  it('leaves a half-typed schedule out of the save', () => {
    expect(
      sanitizePatch({
        schedule: { mode: 'scheduled', date: '', time: '09:00', timezone: 'UTC' },
        name: 'A',
      }),
    ).toEqual({ name: 'A' });
    const good = { mode: 'scheduled' as const, date: '2026-12-01', time: '09:00', timezone: 'UTC' };
    expect(sanitizePatch({ schedule: good }).schedule).toEqual(good);
  });

  it('turns empty retry fields into nulls and drops an invalid retry setting', () => {
    expect(
      sanitizePatch({ retries: { enabled: true, endDate: '', timezone: '' } }).retries,
    ).toEqual({
      enabled: true,
      endDate: null,
      timezone: null,
    });
    expect(
      sanitizePatch({ retries: { enabled: true, endDate: 'soon', timezone: null } }).retries,
    ).toBeUndefined();
  });

  it('cuts a name to the limit', () => {
    expect(sanitizePatch({ name: 'x'.repeat(300) }).name).toHaveLength(191);
  });
});

describe('sanitizePatch: follow-ups', () => {
  const ok = {
    trigger: 'read' as const,
    waitMinutes: 60,
    action: { kind: 'flow' as const, flowId: null },
  };

  it('keeps a step that still has no template or flow chosen', () => {
    expect(sanitizePatch({ followUps: [ok] }).followUps).toEqual([ok]);
    expect(sanitizePatch({ followUps: [] }).followUps).toEqual([]);
  });

  it('leaves out a step the server would refuse and cuts the list to the limit', () => {
    const bad = { ...ok, waitMinutes: 20_000 };
    expect(sanitizePatch({ followUps: [ok, bad] }).followUps).toEqual([ok]);
    expect(sanitizePatch({ followUps: [ok, ok, ok, ok, ok] }).followUps).toHaveLength(3);
  });
});

describe('sanitizePatch: template sequence', () => {
  it('keeps every entry in place and cleans only a mapping the server would refuse', () => {
    const out = sanitizePatch({
      templateSequence: [
        { templateId: uuid(5), variables: { 'body.1': { kind: 'fixed', text: 'ok' } } },
        { templateId: null, variables: {} },
        {
          templateId: uuid(6),
          variables: {
            'body.1': { kind: 'fixed', text: '{{x}}' },
            'body.2': { kind: 'field', field: 'email', fallback: null },
          },
        },
      ],
    });
    expect(out.templateSequence).toEqual([
      { templateId: uuid(5), variables: { 'body.1': { kind: 'fixed', text: 'ok' } } },
      { templateId: null, variables: {} },
      {
        templateId: uuid(6),
        variables: { 'body.2': { kind: 'field', field: 'email', fallback: null } },
      },
    ]);
  });

  it('an empty list is saved as empty, and a patch without it is untouched', () => {
    expect(sanitizePatch({ templateSequence: [] }).templateSequence).toEqual([]);
    expect('templateSequence' in sanitizePatch({ name: 'A' })).toBe(false);
  });

  it('cleans the previous sends of an audience: no repeats, 20 at most, a known outcome', () => {
    const c = (n: number) => ({ kind: 'campaign' as const, id: uuid(n) });
    const out = sanitizePatch({
      audience: {
        ...EMPTY_WIZARD_AUDIENCE,
        previous: {
          sends: [...Array.from({ length: 24 }, (_, i) => c(i + 1)), c(1)],
          outcome: 'nope' as never,
        },
      },
    });
    expect(out.audience?.previous?.sends).toHaveLength(20);
    expect(out.audience?.previous?.outcome).toBe('all');
    // an audience without previous sends is sent as it is
    const plain = { ...EMPTY_WIZARD_AUDIENCE, groupIds: [uuid(1)] };
    expect(sanitizePatch({ audience: plain }).audience).toEqual(plain);
  });
});
