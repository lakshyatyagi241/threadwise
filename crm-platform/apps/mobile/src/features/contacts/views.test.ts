import { ALL_CONTACTS, RECENT_DAYS, isAllContacts, viewFilters, type ChosenView } from './views';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-12T10:00:00.000Z');

describe('viewFilters', () => {
  it('asks for nothing special on All contacts', () => {
    expect(viewFilters(ALL_CONTACTS, USER, NOW)).toEqual({});
  });

  it('asks for the contacts the person owns on My contacts', () => {
    expect(viewFilters({ kind: 'system', id: 'mine' }, USER, NOW)).toEqual({ ownerId: USER });
  });

  it('shows everything on My contacts when nobody is signed in yet', () => {
    expect(viewFilters({ kind: 'system', id: 'mine' }, undefined, NOW)).toEqual({});
  });

  it('looks back a fixed number of days on Recently created', () => {
    expect(RECENT_DAYS).toBe(7);
    expect(viewFilters({ kind: 'system', id: 'recent' }, USER, NOW)).toEqual({
      createdFrom: '2026-10-05',
    });
  });

  it('asks for the opted-out contacts', () => {
    expect(viewFilters({ kind: 'system', id: 'optedOut' }, USER, NOW)).toEqual({
      unsubscribed: true,
    });
  });

  it('hands a saved view to the server as rules text', () => {
    const view: ChosenView = {
      kind: 'custom',
      id: 'v1',
      name: 'Pune',
      filter: { op: 'and', conditions: [{ field: 'city', value: 'Pune' }] },
    };
    expect(viewFilters(view, USER, NOW)).toEqual({ rules: JSON.stringify(view.filter) });
  });

  it('treats a saved view with no conditions as everything', () => {
    expect(viewFilters({ kind: 'custom', id: 'v2', name: 'Empty', filter: {} }, USER, NOW)).toEqual(
      {},
    );
  });
});

describe('isAllContacts', () => {
  it('is true only for the plain list', () => {
    expect(isAllContacts(ALL_CONTACTS)).toBe(true);
    expect(isAllContacts({ kind: 'system', id: 'mine' })).toBe(false);
    expect(isAllContacts({ kind: 'custom', id: 'v', name: 'x', filter: {} })).toBe(false);
  });
});
