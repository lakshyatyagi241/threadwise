import type { ConversationAssignment } from '@crm/contracts';
import { isBotConversation, menuActionsFor, snoozeUntil, STATUS_TARGETS } from './thread-actions';

const ME = '11111111-1111-4111-8111-111111111111';
const nobody: ConversationAssignment = { user: null, team: null, aiAgent: null };
const everything = { canResolve: true, canLabel: true, canAssign: true };

describe('menuActionsFor', () => {
  it('lists the four lines of the reference app, in its order, for a person who may do everything', () => {
    expect(menuActionsFor({ ...everything, status: 'open' })).toEqual([
      'details',
      'status',
      'labels',
      'agent',
    ]);
  });

  it('always offers the details, and nothing else to a person with no other right', () => {
    expect(
      menuActionsFor({ canResolve: false, canLabel: false, canAssign: false, status: 'open' }),
    ).toEqual(['details']);
  });

  it('offers the status line only with the resolve right', () => {
    expect(menuActionsFor({ ...everything, canResolve: false, status: 'open' })).toEqual([
      'details',
      'labels',
      'agent',
    ]);
  });

  it('offers the labels line only with the right to label', () => {
    expect(menuActionsFor({ ...everything, canLabel: false, status: 'open' })).toEqual([
      'details',
      'status',
      'agent',
    ]);
  });

  it('offers the agent line only to a person who may hand a conversation to anyone, not to one who may only claim', () => {
    expect(menuActionsFor({ ...everything, canAssign: false, status: 'open' })).toEqual([
      'details',
      'status',
      'labels',
    ]);
  });

  it('offers a status change from every status (each has a way out)', () => {
    for (const status of ['open', 'pending', 'snoozed', 'resolved', 'closed', 'spam'] as const) {
      expect(menuActionsFor({ ...everything, status })).toContain('status');
    }
  });
});

describe('STATUS_TARGETS', () => {
  it('are the four a person can move a conversation to by hand', () => {
    expect([...STATUS_TARGETS]).toEqual(['open', 'pending', 'resolved', 'closed']);
  });
});

describe('snoozeUntil', () => {
  // Wednesday 14 October 2026, 15:30 on the clock of whoever runs the test.
  const now = new Date(2026, 9, 14, 15, 30, 0);
  const local = (iso: string) => new Date(iso);

  it('is an hour or three hours from now', () => {
    expect(local(snoozeUntil('hour', now)).getTime() - now.getTime()).toBe(3_600_000);
    expect(local(snoozeUntil('threeHours', now)).getTime() - now.getTime()).toBe(10_800_000);
  });

  it('is nine in the morning tomorrow', () => {
    const at = local(snoozeUntil('tomorrow', now));
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual(
      [2026, 9, 15, 9, 0],
    );
  });

  it('is nine in the morning on the next Monday, and a Monday asks for the one after it', () => {
    const wednesday = local(snoozeUntil('nextWeek', now));
    expect([wednesday.getDate(), wednesday.getDay(), wednesday.getHours()]).toEqual([19, 1, 9]);
    const monday = local(snoozeUntil('nextWeek', new Date(2026, 9, 12, 8, 0, 0)));
    expect([monday.getDate(), monday.getDay()]).toEqual([19, 1]);
    const sunday = local(snoozeUntil('nextWeek', new Date(2026, 9, 18, 8, 0, 0)));
    expect([sunday.getDate(), sunday.getDay()]).toEqual([19, 1]);
  });

  it('always ends at least a minute ahead, as the API requires', () => {
    for (const choice of ['hour', 'threeHours', 'tomorrow', 'nextWeek'] as const) {
      expect(local(snoozeUntil(choice, now)).getTime()).toBeGreaterThan(now.getTime() + 60_000);
    }
  });
});

describe('isBotConversation', () => {
  const bot = { id: '33333333-3333-4333-8333-333333333333', name: 'Sales bot' };

  it('is true while an AI agent has it and no person does', () => {
    expect(isBotConversation({ user: null, team: null, aiAgent: bot })).toBe(true);
  });

  it('is false once a person has it, or when there is no AI agent', () => {
    expect(isBotConversation({ user: { id: ME, name: 'A' }, team: null, aiAgent: bot })).toBe(
      false,
    );
    expect(isBotConversation(nobody)).toBe(false);
  });
});
