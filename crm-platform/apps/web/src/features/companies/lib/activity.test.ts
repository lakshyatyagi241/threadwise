import { describe, expect, it } from 'vitest';
import { changeViews } from './activity';

describe('changeViews (the activity card)', () => {
  it('a known field is a before and after, empty as null', () => {
    expect(
      changeViews({
        changes: [
          { field: 'industry', old: 'Retail', new: 'Software' },
          { field: 'phone', old: null, new: '123' },
          { field: 'owner', old: 'Asha', new: null },
        ],
      }),
    ).toEqual([
      { kind: 'field', field: 'industry', old: 'Retail', new: 'Software' },
      { kind: 'field', field: 'phone', old: null, new: '123' },
      { kind: 'field', field: 'owner', old: 'Asha', new: null },
    ]);
  });

  it('a contact link names the contact it added and the one it removed', () => {
    const c = { id: 'c1', name: 'Ana' };
    expect(
      changeViews({
        changes: [
          { field: 'contactLinked', old: null, new: c },
          { field: 'contactUnlinked', old: { id: 'c2', name: null }, new: null },
        ],
      }),
    ).toEqual([
      { kind: 'contactLinked', contact: c },
      { kind: 'contactUnlinked', contact: { id: 'c2', name: null } },
    ]);
  });

  it('a link with no readable contact is left out; a field it does not know is kept, never dropped', () => {
    expect(
      changeViews({
        changes: [
          { field: 'contactLinked', old: null, new: 'not an object' },
          { field: 'somethingNew', old: 1, new: 2 },
        ],
      }),
    ).toEqual([{ kind: 'other', field: 'somethingNew' }]);
  });

  it('a change of company properties names the properties, never their values', () => {
    expect(
      changeViews({
        changes: [{ field: 'customFieldKeys', old: null, new: ['tier', 'seats'] }],
      }),
    ).toEqual([{ kind: 'properties', keys: ['tier', 'seats'] }]);
    expect(changeViews({ changes: [{ field: 'customFieldKeys', old: null, new: 'x' }] })).toEqual(
      [],
    );
  });

  it('numbers and booleans become text', () => {
    expect(changeViews({ changes: [{ field: 'name', old: 5, new: true }] })).toEqual([
      { kind: 'field', field: 'name', old: '5', new: 'true' },
    ]);
  });
});
