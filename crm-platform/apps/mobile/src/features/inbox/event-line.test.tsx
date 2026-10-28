import type { ConversationEvent } from '@crm/contracts';
import { screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { renderApp } from '@/test/render';
import { assignmentLineText, EventLine, type PeopleNames } from './event-line';

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const ASHA = 'aaaaaaaa-0000-4000-8000-000000000002';
const STRANGER = 'aaaaaaaa-0000-4000-8000-000000000003';

const people: PeopleNames = { meId: ME, names: new Map([[ASHA, 'Asha Verma']]) };
const event = (type: string, payload: Record<string, unknown>): ConversationEvent => ({
  id: 'eeeeeeee-0000-4000-8000-000000000001',
  conversationId: '11111111-1111-4111-8111-111111111111',
  type,
  actor: { kind: 'user', userId: ME, name: 'Demo Owner' },
  payload,
  createdAt: '2026-10-11T09:00:00.000Z',
});

describe('assignmentLineText', () => {
  const t = i18next.t.bind(i18next);

  it('names the person it was assigned to', async () => {
    await renderApp(<EventLine event={event('assigned', { toUserId: ASHA })} people={people} />);
    expect(assignmentLineText(event('assigned', { toUserId: ASHA }), people, t)).toBe(
      'Assigned to Asha Verma',
    );
    expect(assignmentLineText(event('reassigned', { toUserId: ASHA }), people, t)).toBe(
      'Assigned to Asha Verma',
    );
  });

  it('says "you" for the signed-in person', async () => {
    await renderApp(<EventLine event={event('assigned', { toUserId: ME })} people={people} />);
    expect(assignmentLineText(event('assigned', { toUserId: ME }), people, t)).toBe(
      'Assigned to you',
    );
  });

  it('says Unassigned when nobody has it any more', async () => {
    await renderApp(<EventLine event={event('unassigned', { toUserId: null })} people={people} />);
    expect(assignmentLineText(event('unassigned', { toUserId: null }), people, t)).toBe(
      'Unassigned',
    );
  });

  it('falls back to the event word when it has no name for the id, or went to a team', async () => {
    await renderApp(
      <EventLine event={event('assigned', { toUserId: STRANGER })} people={people} />,
    );
    expect(assignmentLineText(event('assigned', { toUserId: STRANGER }), people, t)).toBe(
      'Assigned',
    );
    expect(assignmentLineText(event('reassigned', { toUserId: STRANGER }), people, t)).toBe(
      'Reassigned',
    );
    expect(
      assignmentLineText(event('assigned', { toUserId: null, toTeamId: 'x' }), people, t),
    ).toBe('Assigned');
  });
});

describe('EventLine', () => {
  it('is one labelled line for a screen reader', async () => {
    await renderApp(<EventLine event={event('assigned', { toUserId: ASHA })} people={people} />);
    const line = screen.getByTestId('thread-event-eeeeeeee-0000-4000-8000-000000000001');
    expect(line.props.accessibilityLabel).toBe('Assigned to Asha Verma');
    expect(screen.getByText('Assigned to Asha Verma')).toBeTruthy();
  });
});
