import { describe, expect, it } from 'vitest';
import {
  applyPropertyPlan,
  coercePropertyValue,
  planPropertyChanges,
  type PropertyDef,
} from '../../../src/modules/crm/contacts/contact-property-values';
import { AppError } from '../../../src/common/errors/app-error';

const def = (fieldType: string, options: string[] = []): PropertyDef => ({
  key: 'k',
  label: 'K',
  fieldType,
  options,
});
const ok = (d: PropertyDef, v: unknown) => {
  const r = coercePropertyValue(d, v);
  if (!r.ok) throw new Error(r.message);
  return r.value;
};
const bad = (d: PropertyDef, v: unknown) => coercePropertyValue(d, v).ok === false;

describe('coercePropertyValue', () => {
  it('text is trimmed and capped; a number is not text', () => {
    expect(ok(def('text'), '  hi ')).toBe('hi');
    expect(bad(def('text'), 'x'.repeat(1001))).toBe(true);
    expect(bad(def('text'), 5)).toBe(true);
    expect(bad(def('long_text'), 'x'.repeat(4001))).toBe(true);
  });
  it('numbers: strings are parsed, integers must be whole', () => {
    expect(ok(def('integer'), '12')).toBe(12);
    expect(bad(def('integer'), 1.5)).toBe(true);
    expect(bad(def('integer'), 'abc')).toBe(true);
    expect(ok(def('decimal'), '1.25')).toBe(1.25);
    expect(bad(def('currency'), Number.NaN)).toBe(true);
  });
  it('checkbox takes a boolean or its text form', () => {
    expect(ok(def('checkbox'), true)).toBe(true);
    expect(ok(def('boolean'), 'false')).toBe(false);
    expect(bad(def('checkbox'), 'yes')).toBe(true);
  });
  it('dates use the form formats and reject impossible days', () => {
    expect(ok(def('date'), '2026-02-28')).toBe('2026-02-28');
    expect(bad(def('date'), '2026-02-30')).toBe(true);
    expect(bad(def('date'), '28/02/2026')).toBe(true);
    expect(ok(def('datetime'), '2026-02-28T09:30')).toBe('2026-02-28T09:30');
    expect(bad(def('datetime'), '2026-02-28T25:00')).toBe(true);
  });
  it('email and url', () => {
    expect(ok(def('email'), 'a@b.co')).toBe('a@b.co');
    expect(bad(def('email'), 'nope')).toBe(true);
    expect(ok(def('url'), 'https://geta.ai')).toBe('https://geta.ai');
    expect(bad(def('url'), 'javascript:alert(1)')).toBe(true);
  });
  it('select and multi-select only take listed options', () => {
    const s = def('select', ['a', 'b']);
    expect(ok(s, 'a')).toBe('a');
    expect(bad(s, 'c')).toBe(true);
    const m = def('multiselect', ['a', 'b']);
    expect(ok(m, ['a', 'a', 'b'])).toEqual(['a', 'b']);
    expect(bad(m, ['a', 'z'])).toBe(true);
    expect(bad(m, 'a')).toBe(true);
  });
});

describe('planPropertyChanges', () => {
  const defs = new Map<string, PropertyDef>([
    ['city', { key: 'city', label: 'City', fieldType: 'text', options: [] }],
    ['budget', { key: 'budget', label: 'Budget', fieldType: 'integer', options: [] }],
  ]);

  it('splits values into set and clear (null, blank text, empty list clear)', () => {
    const plan = planPropertyChanges(defs, { city: 'Pune', budget: null });
    expect(plan).toEqual({ set: { city: 'Pune' }, clear: ['budget'] });
    expect(planPropertyChanges(defs, { city: '  ' }).clear).toEqual(['city']);
  });

  it('an unknown, inactive or system key is 422 CON_PROPERTY_NOT_EDITABLE naming the key', () => {
    try {
      planPropertyChanges(defs, { city: 'x', ghost: 1 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('CON_PROPERTY_NOT_EDITABLE');
      expect((e as AppError).getStatus()).toBe(422);
      expect(JSON.stringify((e as AppError).details)).toContain('customFields.ghost');
    }
  });

  it('a value of the wrong type is 422 VALIDATION_FAILED naming each key', () => {
    try {
      planPropertyChanges(defs, { budget: 'lots' });
      expect.unreachable();
    } catch (e) {
      expect((e as AppError).code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify((e as AppError).details)).toContain('customFields.budget');
    }
  });
});

describe('applyPropertyPlan', () => {
  it('merges, keeps untouched keys, removes cleared keys and lists only what changed', () => {
    const r = applyPropertyPlan(
      { city: 'Delhi', note: 'keep', budget: 5 },
      { set: { city: 'Pune', budget: 5 }, clear: ['absent', 'note'] },
    );
    expect(r.data).toEqual({ city: 'Pune', budget: 5 });
    expect(r.changedKeys.sort()).toEqual(['city', 'note']);
  });
});
