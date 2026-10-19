import {
  CONTACT_ID,
  CONVERSATION_ID,
  TASK_ID,
  deviceDown,
  newLead,
  newMessage,
  taskAssigned,
} from '@/test/notifications-fixtures';
import {
  formatRowTime,
  groupByDay,
  isKnownType,
  lookOf,
  notificationTarget,
  sectionOf,
} from './notification-model';

const NOW = new Date('2026-10-16T12:00:00');

describe('where a notification opens', () => {
  it('opens the thread of a chat notification', () => {
    expect(notificationTarget(newMessage)).toEqual({
      pathname: '/conversation/[id]',
      params: { id: CONVERSATION_ID },
    });
  });

  it('falls back to the subject when the data has no conversation id', () => {
    expect(
      notificationTarget({
        type: 'conversation_assigned',
        data: {},
        subject: { kind: 'conversation', id: CONVERSATION_ID },
      }),
    ).toEqual({ pathname: '/conversation/[id]', params: { id: CONVERSATION_ID } });
  });

  it('opens the thread of a snoozed chat that woke up', () => {
    expect(
      notificationTarget({ type: 'snooze_wake', data: { conversationId: CONVERSATION_ID } }),
    ).toEqual({
      pathname: '/conversation/[id]',
      params: { id: CONVERSATION_ID },
    });
  });

  it('opens the task of a task notification, ignoring the web path the server sent', () => {
    expect(notificationTarget(taskAssigned)).toEqual({
      pathname: '/task/[id]',
      params: { id: TASK_ID },
    });
  });

  it('opens the contact of a lead', () => {
    expect(notificationTarget(newLead)).toEqual({
      pathname: '/contact/[id]',
      params: { id: CONTACT_ID },
    });
  });

  it('opens nothing for a type the app has no screen for, or an id that is not one', () => {
    expect(notificationTarget(deviceDown)).toBeNull();
    expect(
      notificationTarget({ type: 'new_message', data: { conversationId: '../admin' } }),
    ).toBeNull();
    expect(notificationTarget({ type: 'task_due', data: null })).toBeNull();
  });
});

describe('what the app knows about a type', () => {
  it('knows the catalogue types and not a newer one', () => {
    expect(isKnownType('new_message')).toBe(true);
    expect(isKnownType('quote_expired')).toBe(false);
    expect(lookOf('quote_expired')).toEqual({ icon: 'notifications-outline', tone: 'info' });
  });

  it('marks failures as danger and finished work as success', () => {
    expect(lookOf('broadcast_failed').tone).toBe('danger');
    expect(lookOf('broadcast_completed').tone).toBe('success');
  });
});

describe('day sections', () => {
  it('places a moment by the calendar day, not by 24-hour distance', () => {
    expect(sectionOf(new Date('2026-10-16T00:05:00'), NOW)).toBe('today');
    expect(sectionOf(new Date('2026-10-15T23:55:00'), NOW)).toBe('yesterday');
    expect(sectionOf(new Date('2026-10-12T10:00:00'), NOW)).toBe('thisWeek');
    expect(sectionOf(new Date('2026-10-09T10:00:00'), NOW)).toBe('older');
  });

  it('groups in section order, leaves empty sections out and keeps the order inside one', () => {
    // Built from local calendar days so the test gives the same answer in every time zone.
    const at = (day: number, hour: number) => new Date(2026, 9, day, hour).toISOString();
    const rows = [
      { ...newMessage, id: 'a', createdAt: at(16, 11) },
      { ...newMessage, id: 'b', createdAt: at(16, 8) },
      { ...newMessage, id: 'c', createdAt: at(10, 8) },
      { ...newMessage, id: 'd', createdAt: at(1, 8) },
    ];
    const groups = groupByDay(rows, NOW);
    expect(groups.map((g) => g.section)).toEqual(['today', 'thisWeek', 'older']);
    expect(groups[0].data.map((r) => r.id)).toEqual(['a', 'b']);
    expect(groupByDay([], NOW)).toEqual([]);
  });

  it('shows the clock for recent rows and the date for old ones', () => {
    expect(formatRowTime('2026-10-16T09:05:00', 'today', 'en')).toMatch(/9:05/);
    expect(formatRowTime('2026-10-01T09:05:00', 'older', 'en')).toMatch(/1/);
    expect(formatRowTime('not a date', 'today', 'en')).toBe('');
  });
});
