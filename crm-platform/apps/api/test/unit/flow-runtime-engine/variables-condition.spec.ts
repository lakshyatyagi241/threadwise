import { describe, expect, it } from 'vitest';
import { evaluateConditions } from '../../../src/modules/flow-runtime-engine/runtime/condition';
import {
  asText,
  interpolate,
  isSet,
  resolveVariable,
  type VariableBag,
} from '../../../src/modules/flow-runtime-engine/runtime/variables';

// Ported from WaDesk node/test/flow-condition.mjs and flow-condition-messy.mjs.
const sheets = (): VariableBag => ({
  phone: '27797400465',
  user_message: 'hi',
  customer: { Customer_ID: 'CUST-NLA-0007', Mobile_Number: '27797400465', Notes: '' },
  'customer.Customer_ID': 'CUST-NLA-0007',
  'customer.Mobile_Number': '27797400465',
  'customer.Notes': '',
});
const nested = (): VariableBag => ({
  user_message: 'hi',
  customer: { Customer_ID: 'CUST-NLA-0007', address: { city: 'Cape Town', zip: '' } },
});
const ev = (bag: VariableBag, variable: unknown, operator: string, value?: string) =>
  evaluateConditions(bag, [{ variable, operator, value }]);

describe('conditions', () => {
  it('the reported reproduction: Is set on a Sheets row cell', () => {
    expect(ev(sheets(), 'customer.Customer_ID', 'exists')).toBe(true);
    expect(ev(sheets(), 'customer', 'exists')).toBe(true);
  });

  it('flat variables and empty cells', () => {
    expect(ev(sheets(), 'phone', 'equals', '27797400465')).toBe(true);
    expect(ev(sheets(), 'phone', 'equals', '111')).toBe(false);
    expect(ev(sheets(), 'nope', 'exists')).toBe(false);
    expect(ev(sheets(), 'customer.Notes', 'exists')).toBe(false);
    expect(ev(sheets(), 'customer.Notes', 'is_not_set')).toBe(true);
  });

  it('nested objects without flat keys', () => {
    expect(ev(nested(), 'customer.address.city', 'exists')).toBe(true);
    expect(ev(nested(), 'customer.address.zip', 'exists')).toBe(false);
    expect(ev(nested(), 'customer.address.country', 'exists')).toBe(false);
    expect(ev(nested(), 'customer.Customer_ID.nope', 'exists')).toBe(false);
  });

  it('presence tests do not read user_message, comparisons do', () => {
    expect(ev(sheets(), 'missing_var', 'is_set')).toBe(false);
    expect(ev(sheets(), 'missing_var', 'is_not_set')).toBe(true);
    expect(ev(sheets(), 'missing_var', 'is_empty')).toBe(false);
    expect(ev({ user_message: 'YES' }, '', 'equals', 'yes')).toBe(true);
    expect(ev({ user_message: 'YES' }, 'answer', 'contains', 'ye')).toBe(true);
  });

  it('the builder and the older operator names', () => {
    const nums = { total: '150', user_message: '' };
    expect(ev(nums, 'total', 'gt', '100')).toBe(true);
    expect(ev(nums, 'total', 'gt', '200')).toBe(false);
    expect(ev(nums, 'total', 'lt', '200')).toBe(true);
    expect(ev(nums, 'total', 'greater_than', '100')).toBe(true);
    expect(ev(nums, 'total', 'less_than', '200')).toBe(true);
    expect(ev(sheets(), 'phone', 'not_contains', 'zzz')).toBe(true);
    expect(ev(sheets(), 'phone', 'starts_with', '277')).toBe(true);
    expect(ev(sheets(), 'phone', 'ends_with', '465')).toBe(true);
    expect(ev(sheets(), 'phone', 'Is set')).toBe(true);
    expect(ev(sheets(), 'phone', 'IS_SET')).toBe(true);
    expect(ev(sheets(), 'phone', 'bogus_op', 'x')).toBe(false);
  });

  it('forgives braces, spaces and casing in the variable box', () => {
    expect(ev(sheets(), '{{customer.Customer_ID}}', 'exists')).toBe(true);
    expect(ev(sheets(), '{{ customer.Customer_ID }}', 'exists')).toBe(true);
    expect(ev(sheets(), '  customer . Customer_ID ', 'exists')).toBe(true);
    expect(ev(nested(), 'CUSTOMER.customer_id', 'exists')).toBe(true);
    expect(ev(sheets(), '', 'exists')).toBe(false);
    expect(ev(sheets(), null, 'exists')).toBe(false);
  });

  it('AND and OR chains', () => {
    const set = { variable: 'customer.Customer_ID', operator: 'exists' };
    const match = { variable: 'phone', operator: 'equals', value: '27797400465' };
    const nope = { variable: 'phone', operator: 'equals', value: 'wrong' };
    expect(evaluateConditions(sheets(), [set, match], ['AND'])).toBe(true);
    expect(evaluateConditions(sheets(), [set, nope], ['AND'])).toBe(false);
    expect(evaluateConditions(sheets(), [set, nope], ['OR'])).toBe(true);
    expect(evaluateConditions(sheets(), [nope, nope], ['OR'])).toBe(false);
    expect(evaluateConditions(sheets(), [set, nope], [])).toBe(false);
    expect(evaluateConditions(sheets(), [], [])).toBe(false);
    expect(evaluateConditions(sheets(), [set, match], null as unknown as [])).toBe(true);
  });
});

describe('variables', () => {
  it('never reads the prototype', () => {
    expect(resolveVariable({}, '__proto__.polluted')).toBeUndefined();
    expect(resolveVariable({ customer: {} }, 'customer.toString')).toBeUndefined();
    expect(ev({ user_message: '' }, '__proto__.polluted', 'exists')).toBe(false);
  });

  it('interpolates nested, flat and case-insensitive tags', () => {
    expect(interpolate('{{customer.Customer_ID}}', sheets())).toBe('CUST-NLA-0007');
    expect(interpolate('{{customer.address.city}}', nested())).toBe('Cape Town');
    expect(interpolate('{{CUSTOMER.customer_id}}', nested())).toBe('CUST-NLA-0007');
    expect(interpolate('hi {{nope}}!', sheets())).toBe('hi !');
    expect(interpolate('{{customer}}', nested()).startsWith('{"Customer_ID"')).toBe(true);
  });

  it('renders arrays comma-joined and indexes into webhook results', () => {
    expect(asText(['a', 'b'])).toBe('a,b');
    const r = { r: { items: [{ id: 5 }] }, 'r.items.length': 1, 'r.items.0.id': 5 };
    expect(interpolate('{{r.items.0.id}} {{r.items.length}}', r)).toBe('5 1');
  });

  it('escapes for a JSON body', () => {
    expect(interpolate('{"a":"{{x}}"}', { x: 'he said "hi"\n' }, { escape: 'json' })).toBe(
      '{"a":"he said \\"hi\\"\\n"}',
    );
  });

  it('isSet: the text 0 is set, blanks are not', () => {
    expect(isSet('0')).toBe(true);
    expect(isSet('  ')).toBe(false);
    expect(isSet([])).toBe(false);
    expect(isSet({})).toBe(false);
    expect(isSet(0)).toBe(true);
  });
});
