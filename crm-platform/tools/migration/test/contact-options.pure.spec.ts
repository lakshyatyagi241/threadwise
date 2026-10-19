import { describe, expect, it } from 'vitest';
import { optionValueOf } from '../transform/contacts';
import type { SourceIndex } from '../transform/source-index';

// shapes from the real Waboo workspace support+demo: a contact holds the option ID ("Ckr5KyAE"), not the value
const idx = {
  optionsByField: new Map([
    ['country_region', new Map([['Ckr5KyAE', { value: 'United States', label: 'United States' }], ['LrFpKrW9', { value: 'United Kingdom', label: 'United Kingdom' }]])],
    ['email_confirmed', new Map([['dHuUVsn6', { value: 'yes', label: 'Yes' }], ['YKry8tTA', { value: 'no', label: 'No' }]])],
    ['tags', new Map([['t1', { value: 'vip', label: 'VIP' }], ['t2', { value: 'cold', label: 'Cold' }]])],
  ]),
  fieldsByName: new Map<string, unknown>([
    ['country_region', { type: 'dropdown' }],
    ['email_confirmed', { type: 'checkbox' }],
    ['tags', { type: 'multiselect' }],
    ['city', { type: 'string' }],
  ]),
} as unknown as SourceIndex;

const people = {
  ...idx,
  userNames: new Map([['40f715b8-4a2b-446e-9ff8-40c66bab6abb', 'WABO DEMO']]),
  stageByKey: new Map([['keyxUqSr', { label: 'Lead', value: 'lead' }]]),
} as unknown as SourceIndex;

describe('optionValueOf: ids that name a person or a stage', () => {
  it('Created By / Updated By show the person, Original Lifecycle Stage the stage label', () => {
    expect(optionValueOf('created_by', '40f715b8-4a2b-446e-9ff8-40c66bab6abb', people)).toBe('WABO DEMO');
    expect(optionValueOf('updated_by', 'unknown-user', people)).toBe('unknown-user');
    expect(optionValueOf('original_lifecycle_stage', 'keyxUqSr', people)).toBe('Lead');
  });
});

describe('optionValueOf', () => {
  it('turns the option id of a dropdown into the option value', () => {
    expect(optionValueOf('country_region', 'Ckr5KyAE', idx)).toBe('United States');
    expect(optionValueOf('country_region', 'LrFpKrW9', idx)).toBe('United Kingdom');
  });
  it('turns a checkbox option into a boolean', () => {
    expect(optionValueOf('email_confirmed', 'dHuUVsn6', idx)).toBe(true);
    expect(optionValueOf('email_confirmed', 'YKry8tTA', idx)).toBe(false);
  });
  it('translates every id of a multiselect', () => {
    expect(optionValueOf('tags', ['t1', 't2', 'free text'], idx)).toEqual(['vip', 'cold', 'free text']);
  });
  it('keeps what is not an option id and what has no options', () => {
    expect(optionValueOf('country_region', 'India', idx)).toBe('India');
    expect(optionValueOf('city', 'Pune', idx)).toBe('Pune');
    expect(optionValueOf('country_region', null, idx)).toBeNull();
  });
});
