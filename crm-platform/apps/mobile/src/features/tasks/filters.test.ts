import {
  NO_CHOICES,
  activeChoiceCount,
  cleanChoices,
  defaultOwner,
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
