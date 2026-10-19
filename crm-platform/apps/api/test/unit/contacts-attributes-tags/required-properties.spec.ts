import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  isBlank,
  missingRequired,
  requiredPropertiesError,
  requiredScopeOfEdit,
  ruleApplies,
  type RequiredRule,
} from '../../../src/modules/crm/contacts/required-properties';

const rule = (key: string, conditions: RequiredRule['conditions'] = []): RequiredRule => ({
  key,
  label: key.toUpperCase(),
  conditions,
});

describe('isBlank', () => {
  it('nothing, blank text and an empty list are not answers; zero, false and text are', () => {
    for (const v of [null, undefined, '', '   ', []])
      expect(isBlank(v), JSON.stringify(v)).toBe(true);
    for (const v of [0, false, 'x', ['a'], 5]) expect(isBlank(v), JSON.stringify(v)).toBe(false);
  });
});

describe('missingRequired', () => {
  const rules = [rule('budget'), rule('city')];

  it('names every required property with no value, in registry order', () => {
    expect(missingRequired(rules, {}).map((r) => r.key)).toEqual(['budget', 'city']);
    expect(missingRequired(rules, { budget: 0, city: 'Pune' })).toEqual([]);
    expect(missingRequired(rules, { budget: '', city: 'Pune' }).map((r) => r.key)).toEqual([
      'budget',
    ]);
  });

  it('with `only`, a partial edit is answerable just for the keys it touches', () => {
    const touched = new Set(['city']);
    expect(missingRequired(rules, { city: '' }, touched).map((r) => r.key)).toEqual(['city']);
    expect(missingRequired(rules, { city: 'Pune' }, touched)).toEqual([]);
  });
});

describe('dependencies', () => {
  const dependent = rule('visa_type', [{ parentKey: 'needs_visa', wanted: 'yes' }]);

  it('a dependent property is required only while its condition holds', () => {
    expect(ruleApplies(dependent, { needs_visa: 'yes' })).toBe(true);
    expect(ruleApplies(dependent, { needs_visa: 'no' })).toBe(false);
    expect(ruleApplies(dependent, {})).toBe(false);
    expect(missingRequired([dependent], { needs_visa: 'no' })).toEqual([]);
    expect(missingRequired([dependent], { needs_visa: 'yes' }).map((r) => r.key)).toEqual([
      'visa_type',
    ]);
    expect(missingRequired([dependent], { needs_visa: 'yes', visa_type: 'F1' })).toEqual([]);
  });

  it('a multi-select parent holds the wanted value among others', () => {
    expect(ruleApplies(dependent, { needs_visa: ['maybe', 'yes'] })).toBe(true);
    expect(ruleApplies(dependent, { needs_visa: ['maybe'] })).toBe(false);
  });

  it('every condition must hold, and a condition naming no value never does', () => {
    const both = rule('x', [
      { parentKey: 'a', wanted: '1' },
      { parentKey: 'b', wanted: '2' },
    ]);
    expect(ruleApplies(both, { a: 1, b: 2 })).toBe(true);
    expect(ruleApplies(both, { a: 1, b: 3 })).toBe(false);
    expect(ruleApplies(rule('y', [{ parentKey: 'a', wanted: null }]), { a: 'anything' })).toBe(
      false,
    );
  });
});

describe('requiredPropertiesError', () => {
  it('is a 422 problem naming each key, with the stable code', () => {
    const err = requiredPropertiesError([rule('budget'), rule('city')]);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe(ERROR_CODES.CON_REQUIRED_PROPERTY_MISSING);
    expect(err.getStatus()).toBe(422);
    expect(err.details).toEqual([
      { path: 'customFields.budget', message: 'required' },
      { path: 'customFields.city', message: 'required' },
    ]);
    expect(err.message).toContain('BUDGET');
  });
});

describe('requiredScopeOfEdit', () => {
  const budget = rule('budget');
  const visa = rule('visa_type', [{ parentKey: 'needs_visa', wanted: 'yes' }]);
  const rules = [budget, visa];

  it('an inline edit answers only for the keys it names', () => {
    const before = {};
    const after = { job_title: 'CEO' };
    const scope = requiredScopeOfEdit(rules, before, after, ['job_title']);
    expect([...scope]).toEqual(['job_title']);
    expect(missingRequired(rules, after, scope)).toEqual([]);
  });

  it('a key it names is held to the rule, blank or not', () => {
    const scope = requiredScopeOfEdit(rules, { budget: 5 }, { budget: null }, ['budget']);
    expect(missingRequired(rules, { budget: null }, scope).map((r) => r.key)).toEqual(['budget']);
  });

  it('a dependent the edit makes required is answered for; one that already applied is not', () => {
    const turnsOn = requiredScopeOfEdit(rules, {}, { needs_visa: 'yes' }, ['needs_visa']);
    expect(turnsOn.has('visa_type')).toBe(true);
    expect(missingRequired(rules, { needs_visa: 'yes' }, turnsOn).map((r) => r.key)).toEqual([
      'visa_type',
    ]);
    const already = requiredScopeOfEdit(
      rules,
      { needs_visa: 'yes' },
      { needs_visa: 'yes', job_title: 'x' },
      ['job_title'],
    );
    expect(already.has('visa_type')).toBe(false);
    const turnsOff = requiredScopeOfEdit(rules, { needs_visa: 'yes' }, { needs_visa: 'no' }, [
      'needs_visa',
    ]);
    expect(turnsOff.has('visa_type')).toBe(false);
  });

  it('a form save that sends every property answers for all of them', () => {
    const scope = requiredScopeOfEdit(rules, {}, { budget: null, needs_visa: 'no' }, [
      'budget',
      'needs_visa',
    ]);
    expect(
      missingRequired(rules, { budget: null, needs_visa: 'no' }, scope).map((r) => r.key),
    ).toEqual(['budget']);
  });
});
