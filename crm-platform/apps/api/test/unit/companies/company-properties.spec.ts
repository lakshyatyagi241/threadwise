import { describe, expect, it } from 'vitest';
import { ERROR_CODES, type FieldType } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import {
  assertRequiredProperties,
  isEditableProperty,
  mergeProperties,
  requiredRulesOf,
  valueProblem,
  type CompanyPropertyDef,
} from '../../../src/modules/crm/companies/company-properties';

const def = (
  key: string,
  fieldType: FieldType = 'text',
  over: Partial<CompanyPropertyDef> = {},
): CompanyPropertyDef => ({
  key,
  label: key.toUpperCase(),
  fieldType,
  isRequired: false,
  isHidden: false,
  isReadOnly: false,
  isActive: true,
  isSystem: false,
  options: [],
  conditions: [],
  ...over,
});

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error('did not throw');
}

describe('isEditableProperty', () => {
  it('is true for an active, visible, writable, non-computed property', () => {
    expect(isEditableProperty(def('a'))).toBe(true);
  });
  it('is false for an inactive, system, hidden, read-only or formula property', () => {
    for (const over of [
      { isActive: false },
      { isSystem: true },
      { isHidden: true },
      { isReadOnly: true },
    ]) {
      expect(isEditableProperty(def('a', 'text', over))).toBe(false);
    }
    expect(isEditableProperty(def('a', 'formula'))).toBe(false);
  });
});

describe('valueProblem (a value fits its property’s type)', () => {
  it('whole numbers, numbers, booleans', () => {
    expect(valueProblem(def('n', 'integer'), 4)).toBeNull();
    expect(valueProblem(def('n', 'integer'), 4.5)).not.toBeNull();
    expect(valueProblem(def('n', 'integer'), '4')).not.toBeNull();
    expect(valueProblem(def('n', 'decimal'), 4.5)).toBeNull();
    expect(valueProblem(def('n', 'decimal'), Number.NaN)).not.toBeNull();
    expect(valueProblem(def('b', 'checkbox'), true)).toBeNull();
    expect(valueProblem(def('b', 'boolean'), 'yes')).not.toBeNull();
  });
  it('dates must be real calendar dates', () => {
    expect(valueProblem(def('d', 'date'), '2026-02-28')).toBeNull();
    expect(valueProblem(def('d', 'date'), '2026-02-30')).not.toBeNull();
    expect(valueProblem(def('d', 'date'), '28/02/2026')).not.toBeNull();
    expect(valueProblem(def('d', 'datetime'), '2026-02-28T10:30')).toBeNull();
    expect(valueProblem(def('d', 'datetime'), 'soon')).not.toBeNull();
  });
  it('web addresses are http or https; emails have an @ and a dot', () => {
    expect(valueProblem(def('u', 'url'), 'https://acme.test/x')).toBeNull();
    expect(valueProblem(def('u', 'url'), 'javascript:alert(1)')).not.toBeNull();
    expect(valueProblem(def('u', 'url'), 'acme.test')).not.toBeNull();
    expect(valueProblem(def('e', 'email'), 'a@b.co')).toBeNull();
    expect(valueProblem(def('e', 'email'), 'a@b')).not.toBeNull();
  });
  it('a choice must be one of the options; a multi-select a list of them', () => {
    const sel = def('s', 'select', { options: ['gold', 'silver'] });
    expect(valueProblem(sel, 'gold')).toBeNull();
    expect(valueProblem(sel, 'bronze')).not.toBeNull();
    const multi = def('m', 'multiselect', { options: ['a', 'b'] });
    expect(valueProblem(multi, ['a', 'b'])).toBeNull();
    expect(valueProblem(multi, ['a', 'z'])).not.toBeNull();
    expect(valueProblem(multi, 'a')).not.toBeNull();
  });
  it('text is text', () => {
    expect(valueProblem(def('t'), 'hello')).toBeNull();
    expect(valueProblem(def('t'), 3)).not.toBeNull();
    expect(valueProblem(def('t', 'long_text'), 'x')).toBeNull();
  });
});

describe('mergeProperties', () => {
  const defs = [
    def('tier', 'select', { options: ['gold', 'silver'] }),
    def('seats', 'integer'),
    def('vip', 'checkbox'),
    def('notes_x', 'text'),
    def('locked', 'text', { isReadOnly: true }),
  ];

  it('sets what is sent, keeps what is not, and reports the keys that changed', () => {
    const { next, changed } = mergeProperties(
      defs,
      { tier: 'gold', seats: 12 },
      { notes_x: 'keep' },
    );
    expect(next).toEqual({ tier: 'gold', seats: 12, notes_x: 'keep' });
    expect(changed.sort()).toEqual(['seats', 'tier']);
  });

  it('null, blank text, an empty list and an unticked box remove the key', () => {
    const { next, changed } = mergeProperties(
      defs,
      { tier: null, notes_x: '   ', vip: false, seats: null },
      { tier: 'gold', notes_x: 'old', vip: true, seats: 3 },
    );
    expect(next).toEqual({});
    expect(changed.sort()).toEqual(['notes_x', 'seats', 'tier', 'vip']);
  });

  it('text is trimmed before it is stored', () => {
    expect(mergeProperties(defs, { notes_x: '  hello ' }, {}).next).toEqual({ notes_x: 'hello' });
  });

  it('a value that did not change is not held to the rules (a form can send back everything it loaded)', () => {
    const { next, changed } = mergeProperties(
      defs,
      { locked: 'same', ghost: 'kept', tier: 'platinum' },
      { locked: 'same', ghost: 'kept', tier: 'platinum' },
    );
    expect(changed).toEqual([]);
    expect(next).toEqual({ locked: 'same', ghost: 'kept', tier: 'platinum' });
  });

  it('a key that is not an editable property is refused, naming it (422 COMPANY_PROPERTY_NOT_EDITABLE)', () => {
    const err = thrown(() => mergeProperties(defs, { locked: 'x', ghost: 'y' }, {}));
    expect(err.code).toBe(ERROR_CODES.COMPANY_PROPERTY_NOT_EDITABLE);
    expect(err.getStatus()).toBe(422);
    expect(err.details?.map((d) => d.path).sort()).toEqual([
      'customFields.ghost',
      'customFields.locked',
    ]);
  });

  it('a value that does not fit is refused, naming it (422 COMPANY_PROPERTY_INVALID)', () => {
    const err = thrown(() => mergeProperties(defs, { tier: 'bronze', seats: 1.5 }, {}));
    expect(err.code).toBe(ERROR_CODES.COMPANY_PROPERTY_INVALID);
    expect(err.details?.map((d) => d.path).sort()).toEqual([
      'customFields.seats',
      'customFields.tier',
    ]);
  });

  it('writes nothing when any key is refused', () => {
    const current = { tier: 'gold' };
    expect(() => mergeProperties(defs, { seats: 4, locked: 'x' }, current)).toThrow();
    expect(current).toEqual({ tier: 'gold' });
  });
});

describe('required properties', () => {
  const defs = [
    def('region', 'select', { isRequired: true, options: ['eu', 'us'] }),
    def('vat', 'text', {
      isRequired: true,
      conditions: [{ parentKey: 'region', wanted: 'eu' }],
    }),
    def('vip', 'checkbox', { isRequired: true }),
    def('old', 'text', { isRequired: true, isActive: false }),
  ];

  it('only editable, non-checkbox required properties count', () => {
    expect(requiredRulesOf(defs).map((r) => r.key)).toEqual(['region', 'vat']);
  });

  it('refuses a missing required property, naming it (422 COMPANY_REQUIRED_PROPERTY_MISSING)', () => {
    const err = thrown(() => assertRequiredProperties(defs, {}));
    expect(err.code).toBe(ERROR_CODES.COMPANY_REQUIRED_PROPERTY_MISSING);
    expect(err.details).toEqual([{ path: 'customFields.region', message: 'required' }]);
  });

  it('a property with a "show only when" rule is required only when the rule holds', () => {
    expect(() => assertRequiredProperties(defs, { region: 'us' })).not.toThrow();
    const err = thrown(() => assertRequiredProperties(defs, { region: 'eu' }));
    expect(err.details).toEqual([{ path: 'customFields.vat', message: 'required' }]);
    expect(() => assertRequiredProperties(defs, { region: 'eu', vat: 'DE123' })).not.toThrow();
  });

  it('passes when the workspace defined nothing', () => {
    expect(() => assertRequiredProperties([], {})).not.toThrow();
  });
});
