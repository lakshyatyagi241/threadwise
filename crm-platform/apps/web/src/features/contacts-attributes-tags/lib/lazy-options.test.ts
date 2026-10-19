import { describe, expect, it } from 'vitest';
import type { FieldDependencyResponse, FieldResponse } from '@crm/contracts';
import { hasLazyOptions } from '../api/properties';
import { displayValue, isFieldApplicable } from './field-values';
import { checkDraft, emptyDraft, isUsable } from './property-model';

const field = (over: Partial<FieldResponse> = {}) =>
  ({
    id: 'f1',
    fieldType: 'select',
    isRequired: false,
    isMasked: false,
    isActive: true,
    isSystem: false,
    isHidden: false,
    options: undefined,
    ...over,
  }) as FieldResponse;
const words = { yes: 'Yes', no: 'No' };

describe('a property whose options are not sent with the list', () => {
  it('is told by a count above the options that came', () => {
    expect(hasLazyOptions({ optionCount: 48_000, options: undefined })).toBe(true);
    expect(hasLazyOptions({ optionCount: 3, options: [{}, {}, {}] as never })).toBe(false);
    expect(hasLazyOptions({ options: undefined })).toBe(false);
  });

  it('shows the label read for the stored value, or the stored value itself when none was read', () => {
    const city = field({ optionCount: 48_000 });
    expect(displayValue(city, 'c_1', words, { optionLabels: new Map([['c_1', 'Berlin']]) })).toBe('Berlin');
    expect(displayValue(city, 'c_2', words)).toBe('c_2');
  });

  it('is offered by a rule that names an option of it, since that option cannot be read here', () => {
    const parent = field({ id: 'p', optionCount: 10, options: undefined });
    const dep = { fieldId: 'f1', dependsOnFieldId: 'p', dependsOnOptionId: 'o1', dependsOnValue: null } as FieldDependencyResponse;
    expect(isFieldApplicable({ id: 'f1' }, [dep], new Map([['p', parent]]), {})).toBe(true);
  });

  it('may be saved without its options in the draft', () => {
    const draft = { ...emptyDraft('s1'), label: 'City', type: 'select' as const, options: [] };
    expect(checkDraft(draft, { editing: true, takenKeys: new Set() }).options).toBe('required');
    expect(checkDraft(draft, { editing: true, takenKeys: new Set(), lazyOptions: true }).options).toBeUndefined();
  });
});

describe('a date a property holds', () => {
  it('is shown in the workspace zone, not as the stored UTC text', () => {
    const shown = displayValue(field({ fieldType: 'text' }), '2026-03-16T11:34:31.714Z', words, {
      dateTime: () => 'Mar 16, 2026, 5:04 PM',
    });
    expect(shown).toBe('Mar 16, 2026, 5:04 PM');
  });

  it('leaves ordinary text alone', () => {
    const t = field({ fieldType: 'text' });
    expect(displayValue(t, '2026-03-16', words, { dateTime: () => 'X' })).toBe('2026-03-16');
    expect(displayValue(t, 'hello', words, { dateTime: () => 'X' })).toBe('hello');
  });
});

describe('a hidden property', () => {
  it('is not offered on the contact form or page', () => {
    expect(isUsable(field())).toBe(true);
    expect(isUsable(field({ isHidden: true }))).toBe(false);
  });
});
