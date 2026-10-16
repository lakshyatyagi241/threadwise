import { NO_CHOICES, OWNER_MINE, OWNER_NONE, activeChoiceCount, filtersOf } from './filters';

const ME = '6f1c3f0e-6f5c-4d3a-9a4e-2f6f1b0d9a11';

describe('filtersOf', () => {
  it('sends nothing when nothing is chosen and nothing is typed', () => {
    expect(filtersOf(NO_CHOICES, '', ME)).toEqual({});
    expect(filtersOf(NO_CHOICES, '   ', ME)).toEqual({});
  });

  it('turns "mine" into the caller\'s id and "none" into the unassigned flag, never both', () => {
    expect(filtersOf({ owner: OWNER_MINE }, '', ME)).toEqual({ ownerId: ME });
    expect(filtersOf({ owner: OWNER_NONE }, '', ME)).toEqual({ unassigned: true });
  });

  it("sends a named member as that member's id", () => {
    expect(filtersOf({ owner: 'member-1' }, '', ME)).toEqual({ ownerId: 'member-1' });
  });

  it('leaves the owner out for "mine" while the caller is not known yet', () => {
    expect(filtersOf({ owner: OWNER_MINE }, '', undefined)).toEqual({});
  });

  it('passes the source and the trimmed search words, cut to what the API allows', () => {
    expect(filtersOf({ source: 'inbox' }, '  acme ', ME)).toEqual({ q: 'acme', source: 'inbox' });
    expect(filtersOf(NO_CHOICES, 'x'.repeat(150), ME).q).toHaveLength(100);
  });

  it('does not send the status: it belongs to the list request', () => {
    expect(filtersOf({ status: 'won' }, '', ME)).toEqual({});
  });
});

describe('activeChoiceCount', () => {
  it('counts the groups that narrow the deals', () => {
    expect(activeChoiceCount(NO_CHOICES, false)).toBe(0);
    expect(activeChoiceCount({ owner: OWNER_MINE, source: 'api' }, false)).toBe(2);
  });

  it('counts the status only in the list view, where it applies', () => {
    expect(activeChoiceCount({ status: 'won' }, false)).toBe(0);
    expect(activeChoiceCount({ status: 'won' }, true)).toBe(1);
  });
});
