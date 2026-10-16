import { describe, expect, it } from 'vitest';
import { EMPTY_WIZARD_DRAFT } from '@crm/contracts';
import { audience, draft, slot, template, uuid } from '../testing';
import { clampStep, draftPatch, initialState, keepMatchingVariables, wizardReducer } from './state';

const withVars = () =>
  draft({
    templateId: uuid(1),
    variables: {
      'body.1': { kind: 'field', field: 'first_name', fallback: 'friend' },
      'body.2': { kind: 'fixed', text: 'A-1' },
    },
  });

describe('wizard reducer', () => {
  it('opens at the saved step', () => {
    expect(initialState(draft({ step: 3 })).view).toBe(3);
    expect(initialState().view).toBe(1);
    expect(clampStep(9)).toBe(4);
    expect(clampStep(0)).toBe(1);
    expect(clampStep(Number.NaN)).toBe(1);
  });

  it('sets the name and keeps the same state for a no-op', () => {
    const s = initialState();
    const n = wizardReducer(s, { type: 'name', name: 'Offer' });
    expect(n.draft.name).toBe('Offer');
    expect(wizardReducer(n, { type: 'name', name: 'Offer' })).toBe(n);
  });

  it('changing the template keeps variables whose slot still exists and drops the rest', () => {
    const s = { ...initialState(withVars()), view: 2 as const };
    const next = wizardReducer(s, {
      type: 'template',
      template: template({ id: uuid(9), slots: [slot('body', 1, 'first_name')] }),
    });
    expect(next.draft.templateId).toBe(uuid(9));
    expect(Object.keys(next.draft.variables)).toEqual(['body.1']);
  });

  it('choosing the same template does not touch the variables', () => {
    const s = initialState(withVars());
    expect(wizardReducer(s, { type: 'template', template: template() })).toBe(s);
  });

  it('clearing the template empties the variables', () => {
    const next = wizardReducer(initialState(withVars()), { type: 'template', template: null });
    expect(next.draft.templateId).toBeNull();
    expect(next.draft.variables).toEqual({});
  });

  it('merges audience patches and sets or clears one variable', () => {
    let s = initialState();
    s = wizardReducer(s, { type: 'audience', patch: { groupIds: [uuid(11)] } });
    s = wizardReducer(s, { type: 'audience', patch: { segmentIds: [uuid(21)] } });
    expect(s.draft.audience).toMatchObject({
      groupIds: [uuid(11)],
      segmentIds: [uuid(21)],
      rules: null,
    });
    s = wizardReducer(s, {
      type: 'variable',
      slot: 'body.1',
      source: { kind: 'fixed', text: 'x' },
    });
    expect(s.draft.variables['body.1']).toEqual({ kind: 'fixed', text: 'x' });
    s = wizardReducer(s, { type: 'variable', slot: 'body.1', source: null });
    expect(s.draft.variables).toEqual({});
  });

  it('going forward raises the furthest step; going back does not lower it', () => {
    let s = initialState();
    s = wizardReducer(s, { type: 'go', step: 2 });
    s = wizardReducer(s, { type: 'go', step: 3 });
    expect(s).toMatchObject({ view: 3, draft: { step: 3 } });
    s = wizardReducer(s, { type: 'go', step: 1 });
    expect(s).toMatchObject({ view: 1, draft: { step: 3 } });
  });

  it('replaces everything on hydrate', () => {
    const s = wizardReducer(initialState(), {
      type: 'hydrate',
      draft: draft({ name: 'Loaded', step: 2 }),
    });
    expect(s.draft.name).toBe('Loaded');
    expect(s.view).toBe(2);
  });

  it('keepMatchingVariables works on a null template', () => {
    expect(keepMatchingVariables(withVars().variables, null)).toEqual({});
  });
});

describe('the campaign builder options', () => {
  it('sets the A/B test, auto-end, Smart Delivery and link tracking, and saves only what changed', () => {
    const s = initialState();
    const n = wizardReducer(s, {
      type: 'options',
      patch: {
        abTesting: true,
        abSplit: 30,
        trackLinks: false,
        autoEnd: { at: '2027-01-01T10:00', timezone: 'UTC' },
        pacing: { throttleMinSec: 1, windowStart: '08:00', windowEnd: '20:00' },
      },
    });
    expect(n.draft).toMatchObject({ abTesting: true, abSplit: 30, trackLinks: false });
    expect(Object.keys(draftPatch(s.draft, n.draft)).sort()).toEqual(
      ['abSplit', 'abTesting', 'autoEnd', 'pacing', 'trackLinks'].sort(),
    );
  });

  it('variant B has its own template and mapping; changing the template keeps the placeholders that still exist', () => {
    let s = initialState(draft({ abTesting: true }));
    s = wizardReducer(s, { type: 'templateB', template: template({ id: uuid(2) }) });
    expect(s.draft.templateIdB).toBe(uuid(2));
    s = wizardReducer(s, {
      type: 'variableB',
      slot: 'body.1',
      source: { kind: 'fixed', text: 'B-1' },
    });
    s = wizardReducer(s, {
      type: 'variableB',
      slot: 'body.9',
      source: { kind: 'fixed', text: 'gone' },
    });
    s = wizardReducer(s, { type: 'templateB', template: template({ id: uuid(3) }) });
    expect(Object.keys(s.draft.variablesB)).toEqual(['body.1']);
    expect(s.draft.variables).toEqual({});
  });
});

describe('draftPatch', () => {
  it('is empty when nothing changed and names only the changed keys otherwise', () => {
    expect(draftPatch(EMPTY_WIZARD_DRAFT, { ...EMPTY_WIZARD_DRAFT })).toEqual({});
    const next = { ...EMPTY_WIZARD_DRAFT, name: 'A', step: 2 };
    expect(draftPatch(EMPTY_WIZARD_DRAFT, next)).toEqual({ name: 'A', step: 2 });
  });

  it('compares nested values by content', () => {
    const a = draft({ audience: audience({ groupIds: [uuid(1)] }) });
    const b = draft({ audience: audience({ groupIds: [uuid(1)] }) });
    expect(draftPatch(a, b)).toEqual({});
  });
});

describe('follow-ups', () => {
  const step = {
    trigger: 'not_read' as const,
    waitMinutes: 120,
    action: { kind: 'template' as const, templateId: null },
  };

  it('replaces the list and the save patch names the key', () => {
    const s = initialState();
    const n = wizardReducer(s, { type: 'followUps', followUps: [step] });
    expect(n.draft.followUps).toEqual([step]);
    expect(draftPatch(s.draft, n.draft)).toEqual({ followUps: [step] });
    const edited = wizardReducer(n, {
      type: 'followUps',
      followUps: [{ ...step, waitMinutes: 180 }],
    });
    expect(draftPatch(n.draft, edited.draft)).toEqual({
      followUps: [{ ...step, waitMinutes: 180 }],
    });
    const cleared = wizardReducer(edited, { type: 'followUps', followUps: [] });
    expect(draftPatch(edited.draft, cleared.draft)).toEqual({ followUps: [] });
  });
});

describe('template sequence', () => {
  const tpl = (n: number) => template({ id: uuid(n), slots: [slot('body', 1, 'first_name')] });
  const withSeq = () => {
    let s = initialState();
    for (const n of [5, 6, 7]) {
      s = wizardReducer(s, { type: 'sequenceAdd' });
      s = wizardReducer(s, {
        type: 'sequenceTemplate',
        index: s.draft.templateSequence.length - 1,
        template: tpl(n),
      });
    }
    return s;
  };
  const ids = (s: ReturnType<typeof initialState>) =>
    s.draft.templateSequence.map((e) => e.templateId);

  it('adds empty entries, up to nine, and the save patch names the key', () => {
    let s = initialState();
    const before = s.draft;
    for (let i = 0; i < 12; i++) s = wizardReducer(s, { type: 'sequenceAdd' });
    expect(s.draft.templateSequence).toHaveLength(9);
    expect(s.draft.templateSequence[0]).toEqual({ templateId: null, variables: {} });
    expect(Object.keys(draftPatch(before, s.draft))).toEqual(['templateSequence']);
  });

  it('picking a template keeps the mapping that still fits; the same pick is a no-op', () => {
    let s = withSeq();
    s = wizardReducer(s, {
      type: 'sequenceVariable',
      index: 1,
      slot: 'body.1',
      source: { kind: 'fixed', text: 'x' },
    });
    s = wizardReducer(s, {
      type: 'sequenceVariable',
      index: 1,
      slot: 'body.9',
      source: { kind: 'fixed', text: 'y' },
    });
    const same = wizardReducer(s, { type: 'sequenceTemplate', index: 1, template: tpl(6) });
    expect(same).toBe(s);
    const next = wizardReducer(s, { type: 'sequenceTemplate', index: 1, template: tpl(8) });
    expect(next.draft.templateSequence[1]).toEqual({
      templateId: uuid(8),
      variables: { 'body.1': { kind: 'fixed', text: 'x' } },
    });
    const cleared = wizardReducer(s, { type: 'sequenceTemplate', index: 1, template: null });
    expect(cleared.draft.templateSequence[1]).toEqual({ templateId: null, variables: {} });
  });

  it('sets, clears and replaces the mapping of one entry only', () => {
    let s = withSeq();
    s = wizardReducer(s, {
      type: 'sequenceVariable',
      index: 2,
      slot: 'body.1',
      source: { kind: 'fixed', text: 'z' },
    });
    expect(s.draft.templateSequence[2]!.variables['body.1']).toEqual({ kind: 'fixed', text: 'z' });
    expect(s.draft.templateSequence[0]!.variables).toEqual({});
    s = wizardReducer(s, { type: 'sequenceVariable', index: 2, slot: 'body.1', source: null });
    expect(s.draft.templateSequence[2]!.variables).toEqual({});
    s = wizardReducer(s, {
      type: 'sequenceVariables',
      index: 0,
      variables: { 'body.1': { kind: 'field', field: 'email', fallback: null } },
    });
    expect(s.draft.templateSequence[0]!.variables).toHaveProperty('body.1');
    expect(wizardReducer(s, { type: 'sequenceVariable', index: 8, slot: 'a', source: null })).toBe(
      s,
    );
  });

  it('moves an entry with its mapping, and refuses to move past either end', () => {
    let s = withSeq();
    s = wizardReducer(s, {
      type: 'sequenceVariable',
      index: 0,
      slot: 'body.1',
      source: { kind: 'fixed', text: 'first' },
    });
    const down = wizardReducer(s, { type: 'sequenceMove', index: 0, by: 1 });
    expect(ids(down)).toEqual([uuid(6), uuid(5), uuid(7)]);
    expect(down.draft.templateSequence[1]!.variables['body.1']).toEqual({
      kind: 'fixed',
      text: 'first',
    });
    expect(ids(wizardReducer(down, { type: 'sequenceMove', index: 1, by: -1 }))).toEqual(ids(s));
    expect(wizardReducer(s, { type: 'sequenceMove', index: 0, by: -1 })).toBe(s);
    expect(wizardReducer(s, { type: 'sequenceMove', index: 2, by: 1 })).toBe(s);
  });

  it('removes one entry or all of them', () => {
    const s = withSeq();
    expect(ids(wizardReducer(s, { type: 'sequenceRemove', index: 1 }))).toEqual([uuid(5), uuid(7)]);
    expect(wizardReducer(s, { type: 'sequenceRemove', index: 5 })).toBe(s);
    const none = wizardReducer(s, { type: 'sequenceClear' });
    expect(none.draft.templateSequence).toEqual([]);
    expect(wizardReducer(none, { type: 'sequenceClear' })).toBe(none);
  });
});

describe('previous sends in the audience', () => {
  const c = (n: number) => ({ kind: 'campaign' as const, id: uuid(n) });

  it('sets the picked sends and the outcome, next to the other sources', () => {
    let s = wizardReducer(initialState(), { type: 'audience', patch: { groupIds: [uuid(11)] } });
    s = wizardReducer(s, {
      type: 'audience',
      patch: { previous: { sends: [c(1)], outcome: 'read' } },
    });
    expect(s.draft.audience.groupIds).toEqual([uuid(11)]);
    expect(s.draft.audience.previous).toEqual({ sends: [c(1)], outcome: 'read' });
  });

  it('keeps at most 20 sends, no repeats, and drops an outcome a ticked broadcast cannot give', () => {
    const many = Array.from({ length: 25 }, (_, i) => c(i + 1));
    const s = wizardReducer(initialState(), {
      type: 'audience',
      patch: { previous: { sends: [...many, c(1)], outcome: 'read' } },
    });
    expect(s.draft.audience.previous?.sends).toHaveLength(20);
    const b = wizardReducer(initialState(), {
      type: 'audience',
      patch: { previous: { sends: [{ kind: 'broadcast', id: uuid(1) }], outcome: 'clicked' } },
    });
    expect(b.draft.audience.previous?.outcome).toBe('all');
  });

  it('clears with null, and a patch of another source leaves it alone', () => {
    let s = wizardReducer(initialState(), {
      type: 'audience',
      patch: { previous: { sends: [c(1)], outcome: 'all' } },
    });
    s = wizardReducer(s, { type: 'audience', patch: { groupIds: [uuid(11)] } });
    expect(s.draft.audience.previous?.sends).toHaveLength(1);
    s = wizardReducer(s, { type: 'audience', patch: { previous: null } });
    expect(s.draft.audience.previous).toBeNull();
  });

  it('is part of the save patch when it changes, and a resumed draft opens with it', () => {
    const before = draft();
    const after = draft({
      audience: audience({ previous: { sends: [c(1)], outcome: 'replied' } }),
    });
    expect(Object.keys(draftPatch(before, after))).toEqual(['audience']);
    const hydrated = wizardReducer(initialState(), { type: 'hydrate', draft: after });
    expect(hydrated.draft.audience.previous?.outcome).toBe('replied');
  });
});
