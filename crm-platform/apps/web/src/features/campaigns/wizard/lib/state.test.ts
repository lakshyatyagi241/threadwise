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
