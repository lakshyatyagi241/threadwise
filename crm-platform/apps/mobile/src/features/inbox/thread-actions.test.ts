import type { ConversationAssignment } from '@crm/contracts';
import { isBotConversation, menuActionsFor } from './thread-actions';

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
      'unassign',
      'pending',
      'close',
    ]);
  });

  it('does not offer to assign a conversation to the person who already has it', () => {
    expect(menuActionsFor({ ...everything, status: 'open', assignment: person(ME) })).toEqual([
      'unassign',
      'pending',
      'close',
    ]);
  });

  it('offers no unassign when nobody has it', () => {
    expect(menuActionsFor({ ...everything, status: 'open', assignment: nobody })).toEqual([
      'assignToMe',
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
    ).toEqual(['unassign']);
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
