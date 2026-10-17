import { describe, expect, it } from 'vitest';
import { storedNames, variableNames } from './stored-names';

describe('storedNames', () => {
  it('lists the answer variable and the contact property it is copied to', () => {
    expect(storedNames({ var: 'city', saveProperty: true, propertyKey: 'city_prop' })).toEqual([
      '{{city}}',
      '→ city_prop',
    ]);
  });

  it('shows the result variable of steps that save into `save` or `saveAs`', () => {
    expect(variableNames({ save: 'api_response' })).toEqual(['{{api_response}}']);
    expect(variableNames({ saveAs: 'deal_id' })).toEqual(['{{deal_id}}']);
  });

  it('shows nothing for a step that stores nothing, and never repeats a name', () => {
    expect(storedNames({})).toEqual([]);
    expect(variableNames({ var: 'x', save: 'x' })).toEqual(['{{x}}']);
  });
});
