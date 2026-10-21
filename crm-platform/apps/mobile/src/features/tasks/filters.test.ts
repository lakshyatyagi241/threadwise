import {
  NO_CHOICES,
  activeChoiceCount,
  cleanChoices,
  defaultOwner,
  dueRangeOf,
  listRequest,
  type TaskChoices,
} from './filters';

const CONTACT = '11111111-1111-4111-8111-111111111111';

describe('defaults', () => {
  it('starts on my tasks, or on every owner inside one contact', () => {
    expect(defaultOwner('')).toBe('mine');
    expect(defaultOwner(CONTACT)).toBe('all');
  });

  it('counts only the groups that differ from their default', () => {
    expect(activeChoiceCount(NO_CHOICES, '')).toBe(0);
    expect(activeChoiceCount({ status: 'open', owner: 'mine' }, '')).toBe(0);
    expect(activeChoiceCount({ status: 'open', owner: 'all' }, CONTACT)).toBe(0);
    expect(
      activeChoiceCount({ status: 'done', priority: 'high', due: 'today', owner: 'all' }, ''),
    ).toBe(4);
  });

  it('drops a choice that equals its default', () => {
    const choices: TaskChoices = { status: 'open', owner: 'mine', priority: 'low' };
    expect(cleanChoices(choices, '')).toEqual({ priority: 'low' });
    expect(cleanChoices({ owner: 'mine' }, CONTACT)).toEqual({ owner: 'mine' });
  });
});

describe('listRequest', () => {
  it('asks My tasks for the open tasks when nothing is chosen', () => {
    expect(listRequest('', NO_CHOICES, '')).toEqual({
      source: { kind: 'mine' },
      filters: { status: 'open' },
    });
  });

  it('asks a contact for the open tasks of every owner', () => {
    expect(listRequest(CONTACT, NO_CHOICES, '')).toEqual({
      source: { kind: 'contact', contactId: CONTACT },
      filters: { status: 'open' },
    });
  });

  it('turns status, priority and due into the API names', () => {
    expect(
      listRequest('', { status: 'done', priority: 'high', due: 'overdue', owner: 'mine' }, '')
        .filters,
    ).toEqual({ status: 'done', priority: 'high', due: 'overdue' });
    expect(listRequest('', { status: 'all', due: 'none' }, '').filters).toEqual({
      status: 'all',
      due: 'none',
    });
  });

  it('switches from My tasks to the whole list for "All", and filters "Unassigned" there', () => {
    expect(listRequest('', { owner: 'all' }, '')).toEqual({
      source: { kind: 'all' },
      filters: { status: 'open' },
    });
    expect(listRequest('', { owner: 'unassigned' }, '')).toEqual({
      source: { kind: 'all' },
      filters: { status: 'open', unassigned: true },
    });
  });

  it('narrows a contact’s tasks by owner with the API flags', () => {
    expect(listRequest(CONTACT, { owner: 'mine' }, '').filters).toEqual({
      status: 'open',
      mine: true,
    });
    expect(listRequest(CONTACT, { owner: 'unassigned' }, '').filters).toEqual({
      status: 'open',
      unassigned: true,
    });
  });

  it('sends the words typed in the search box, trimmed and cut to the API’s length', () => {
    expect(listRequest('', NO_CHOICES, '  quote ').filters.q).toBe('quote');
    expect(listRequest('', NO_CHOICES, '   ').filters.q).toBeUndefined();
    expect(listRequest('', NO_CHOICES, 'x'.repeat(150)).filters.q).toHaveLength(100);
  });
});

describe('the due tabs', () => {
  // Wednesday 21 Oct 2026, mid-afternoon on the phone's clock.
  const wed = new Date(2026, 9, 21, 15, 30);
  const at = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();

  it('reads tomorrow as that one day, from midnight to midnight', () => {
    expect(dueRangeOf('tomorrow', wed)).toEqual({
      dueFrom: at(2026, 9, 22),
      dueTo: at(2026, 9, 23),
    });
  });

  it('reads this week as today to the end of Sunday', () => {
    expect(dueRangeOf('week', wed)).toEqual({ dueFrom: at(2026, 9, 21), dueTo: at(2026, 9, 26) });
    // A Monday has the whole week ahead; a Sunday has only itself.
    expect(dueRangeOf('week', new Date(2026, 9, 19, 9, 0)).dueTo).toBe(at(2026, 9, 26));
    expect(dueRangeOf('week', new Date(2026, 9, 25, 9, 0))).toEqual({
      dueFrom: at(2026, 9, 25),
      dueTo: at(2026, 9, 26),
    });
  });

  it('sends the API its own words for Overdue and Today, and a range for the other two', () => {
    expect(listRequest('', NO_CHOICES, '', 'overdue', wed).filters).toEqual({
      status: 'open',
      due: 'overdue',
    });
    expect(listRequest('', NO_CHOICES, '', 'today', wed).filters).toEqual({
      status: 'open',
      due: 'today',
    });
    expect(listRequest('', NO_CHOICES, '', 'tomorrow', wed).filters).toEqual({
      status: 'open',
      dueFrom: at(2026, 9, 22),
      dueTo: at(2026, 9, 23),
    });
    expect(listRequest(CONTACT, NO_CHOICES, '', 'week', wed).filters).toMatchObject({
      dueFrom: at(2026, 9, 21),
    });
  });

  it('leaves the list unnarrowed on All, and lets a tab win over the sheet’s due choice', () => {
    expect(listRequest('', NO_CHOICES, '', 'all', wed).filters).toEqual({ status: 'open' });
    expect(listRequest('', { due: 'upcoming' }, '', 'all', wed).filters).toEqual({
      status: 'open',
      due: 'upcoming',
    });
    expect(listRequest('', { due: 'upcoming' }, '', 'today', wed).filters).toEqual({
      status: 'open',
      due: 'today',
    });
  });
});
