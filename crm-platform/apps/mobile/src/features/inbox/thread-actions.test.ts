import type { ConversationAssignment } from '@crm/contracts';
import { isBotConversation, menuActionsFor, snoozeUntil } from './thread-actions';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const nobody: ConversationAssignment = { user: null, team: null, aiAgent: null };
const person = (id: string): ConversationAssignment => ({
  user: { id, name: 'Someone' },
  team: null,
  aiAgent: null,
});
const everything = { canAssign: true, canAssignSelf: true, canResolve: true, meId: ME };

describe('menuActionsFor', () => {
  it('offers everything for an open conversation someone else has', () => {
    expect(menuActionsFor({ ...everything, status: 'open', assignment: person(OTHER) })).toEqual([
      'assignToMe',
      'changeAgent',
      'unassign',
      'pending',
      'close',
    ]);
  });

  it('does not offer to assign a conversation to the person who already has it', () => {
    expect(menuActionsFor({ ...everything, status: 'open', assignment: person(ME) })).toEqual([
      'changeAgent',
      'unassign',
      'pending',
      'close',
    ]);
  });

  it('offers no unassign when nobody has it', () => {
    expect(menuActionsFor({ ...everything, status: 'open', assignment: nobody })).toEqual([
      'assignToMe',
      'changeAgent',
      'pending',
      'close',
    ]);
  });

  it('lets a person who may only claim claim, and never take it from someone', () => {
    expect(
      menuActionsFor({
        ...everything,
        canAssign: false,
        status: 'open',
        assignment: person(OTHER),
      }),
    ).toEqual(['assignToMe', 'pending', 'close']);
  });

  it('offers only the status moves that are legal from the current status', () => {
    const actions = (status: 'pending' | 'resolved' | 'closed') =>
      menuActionsFor({ ...everything, status, assignment: person(ME) });
    expect(actions('pending')).not.toContain('pending');
    expect(actions('closed')).not.toContain('close');
  });

  it('offers no status moves without the resolve permission', () => {
    expect(
      menuActionsFor({ ...everything, canResolve: false, status: 'open', assignment: person(ME) }),
    ).toEqual(['changeAgent', 'unassign']);
  });

  it('offers nothing to a person with no right to assign or resolve', () => {
    expect(
      menuActionsFor({
        meId: ME,
        canAssign: false,
        canAssignSelf: false,
        canResolve: false,
        status: 'open',
        assignment: nobody,
      }),
    ).toEqual([]);
  });
});

describe('menuActionsFor: priority and snooze', () => {
  const triage = { ...everything, canPriority: true, canSnooze: true };

  it('offers priority and snooze after the assignment lines, to a person who may', () => {
    expect(menuActionsFor({ ...triage, status: 'open', assignment: nobody })).toEqual([
      'assignToMe',
      'changeAgent',
      'priority',
      'snooze',
      'pending',
      'close',
    ]);
  });

  it('offers no snooze for a thread that is already finished, and a wake-up for a parked one', () => {
    expect(menuActionsFor({ ...triage, status: 'resolved', assignment: nobody })).not.toContain(
      'snooze',
    );
    const parked = menuActionsFor({ ...triage, status: 'snoozed', assignment: nobody });
    expect(parked).toContain('wake');
    expect(parked).not.toContain('snooze');
  });

  it('offers neither without the right to', () => {
    const actions = menuActionsFor({ ...everything, status: 'open', assignment: nobody });
    expect(actions).not.toContain('priority');
    expect(actions).not.toContain('snooze');
  });

  it('offers no wake-up to a person who may not move statuses', () => {
    expect(
      menuActionsFor({ ...triage, canResolve: false, status: 'snoozed', assignment: nobody }),
    ).not.toContain('wake');
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
