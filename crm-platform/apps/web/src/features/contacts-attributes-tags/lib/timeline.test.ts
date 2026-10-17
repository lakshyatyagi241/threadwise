import { describe, expect, it } from 'vitest';
import type {
  ContactActivityResponse,
  ContactMeetingResponse,
  ContactNoteResponse,
  FieldHistoryEntry,
  TaskResponse,
} from '@crm/contracts';
import {
  dayGroupOf,
  fromActivity,
  fromFieldHistory,
  fromMeeting,
  fromNote,
  fromTask,
  groupByDay,
  kindsOf,
  mergeFeed,
  sourcesFor,
  visibleEntries,
  type FeedSource,
  type TimelineEntry,
} from './timeline';

const ID = '11111111-1111-4111-8111-111111111111';

const activity = (over: Partial<ContactActivityResponse>): ContactActivityResponse => ({
  id: ID,
  contactId: ID,
  activityType: 'manual',
  title: 'Something',
  body: null,
  source: 'user',
  actorId: null,
  occurredAt: '2026-10-10T10:00:00.000Z',
  createdAt: '2026-10-10T10:00:00.000Z',
  ...over,
});

const note = (id: string, createdAt: string, body = 'Called back'): ContactNoteResponse => ({
  id,
  contactId: ID,
  body,
  createdBy: null,
  updatedBy: null,
  rowVersion: 1,
  createdAt,
  updatedAt: createdAt,
});

const task = (over: Partial<TaskResponse>): TaskResponse =>
  ({
    id: ID,
    title: 'Send quote',
    notes: null,
    priority: 'medium',
    status: 'open',
    dueAt: null,
    doneAt: null,
    remindedAt: null,
    bucket: null,
    overdue: false,
    assignee: null,
    createdBy: null,
    contact: null,
    deal: null,
    company: null,
    source: 'manual',
    rowVersion: 1,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...over,
  }) as TaskResponse;

const meeting = (over: Partial<ContactMeetingResponse>): ContactMeetingResponse => ({
  id: ID,
  contactId: ID,
  title: 'Demo',
  startsAt: null,
  endsAt: null,
  location: null,
  createdBy: null,
  rowVersion: 1,
  createdAt: '2026-10-02T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  ...over,
});

describe('entries', () => {
  it('reads e-mail, logged calls and everything else out of the activity feed', () => {
    expect(fromActivity(activity({ activityType: 'email_sent' })).data).toMatchObject({
      type: 'email',
      direction: 'sent',
    });
    expect(fromActivity(activity({ activityType: 'email_received' })).kind).toBe('email');
    const call = fromActivity(
      activity({ activityType: 'call_manual', title: 'Outbound call, Connected, 4 min' }),
    );
    expect(call.kind).toBe('call');
    expect(call.data).toMatchObject({ source: 'manual', direction: 'outbound' });
    expect(fromActivity(activity({ activityType: 'call_telephony' })).data).toMatchObject({
      source: 'telephony',
    });
    expect(fromActivity(activity({ activityType: 'form_submission' })).kind).toBe('other');
  });

  it('keeps an open task and an upcoming meeting "up next", a done task and a past meeting on the timeline', () => {
    expect(fromTask(task({})).upNext).toBe(true);
    const done = fromTask(task({ status: 'done', doneAt: '2026-10-05T10:00:00.000Z' }));
    expect(done.upNext).toBe(false);
    expect(done.at).toBe('2026-10-05T10:00:00.000Z');

    const now = new Date('2026-10-10T12:00:00.000Z');
    expect(fromMeeting(meeting({ startsAt: '2026-10-12T10:00:00.000Z' }), now).upNext).toBe(true);
    const past = fromMeeting(meeting({ startsAt: '2026-10-08T10:00:00.000Z' }), now);
    expect(past.upNext).toBe(false);
    expect(past.at).toBe('2026-10-08T10:00:00.000Z');
    // No start: placed where it was logged.
    expect(fromMeeting(meeting({}), now).at).toBe('2026-10-02T09:00:00.000Z');
  });

  it('marks an edited note', () => {
    const n = fromNote({
      ...note('a', '2026-10-01T10:00:00.000Z'),
      updatedAt: '2026-10-02T10:00:00.000Z',
    });
    expect(n.data).toMatchObject({ type: 'note', edited: true });
  });

  it('puts field edits of one save on one line', () => {
    const e = (fieldKey: string, changedAt: string): FieldHistoryEntry => ({
      fieldKey,
      oldValue: 'a',
      newValue: 'b',
      actorType: 'user',
      changedByUserId: ID,
      changedAt,
    });
    const out = fromFieldHistory([
      e('email', '2026-10-03T10:00:00.000Z'),
      e('phone', '2026-10-03T10:00:00.000Z'),
      e('lifecycleStage', '2026-10-04T10:00:00.000Z'),
    ]);
    expect(out).toHaveLength(2);
    const first = out.find((x) => x.at === '2026-10-03T10:00:00.000Z')!;
    expect(first.data).toMatchObject({ type: 'change' });
    expect(first.data.type === 'change' && first.data.fields.map((f) => f.key)).toEqual([
      'email',
      'phone',
    ]);
  });
});

describe('filters', () => {
  it('maps a pill to its kinds and to the sources it needs', () => {
    expect(kindsOf('all')).toBeNull();
    expect([...kindsOf('messages')!].sort()).toEqual(['email', 'message']);
    expect([...kindsOf('changes')!].sort()).toEqual(['change', 'consent']);
    expect([...sourcesFor('notes')]).toEqual(['notes']);
    expect(sourcesFor('all').size).toBe(9);
    expect(sourcesFor('calls').has('whatsappCalls')).toBe(true);
    expect(sourcesFor('calls').has('notes')).toBe(false);
  });

  it('filters by kind and needs every typed word', () => {
    const entries: TimelineEntry[] = [
      fromNote(note('n1', '2026-10-01T10:00:00.000Z', 'Wants a discount on the annual plan')),
      fromTask(task({ id: 't1', title: 'Send annual quote' })),
      fromActivity(activity({ activityType: 'email_sent', title: 'Quote sent' })),
    ];
    expect(visibleEntries(entries, 'notes', '')).toHaveLength(1);
    expect(visibleEntries(entries, 'all', 'annual')).toHaveLength(2);
    expect(visibleEntries(entries, 'all', 'annual quote')).toHaveLength(1);
    expect(visibleEntries(entries, 'tasks', 'discount')).toHaveLength(0);
    expect(visibleEntries(entries, 'all', 'ANNUAL  plan')).toHaveLength(1);
  });
});

describe('mergeFeed', () => {
  const n = (id: string, at: string) => fromNote(note(id, at));
  const src = (id: FeedSource['id'], entries: TimelineEntry[], hasMore = false): FeedSource => ({
    id,
    entries,
    hasMore,
  });

  it('orders by time, newest first, and splits off the up-next ones, soonest due first', () => {
    const feed = mergeFeed([
      src('notes', [n('a', '2026-10-01T10:00:00.000Z'), n('b', '2026-10-05T10:00:00.000Z')]),
      src('tasksOpen', [
        fromTask(task({ id: 'late', dueAt: '2026-10-20T10:00:00.000Z' })),
        fromTask(task({ id: 'soon', dueAt: '2026-10-11T10:00:00.000Z' })),
        fromTask(task({ id: 'nodue', dueAt: null })),
      ]),
    ]);
    expect(feed.dated.map((e) => e.id)).toEqual(['note:b', 'note:a']);
    expect(feed.upNext.map((e) => e.id)).toEqual(['task:soon', 'task:late', 'task:nodue']);
    expect(feed.canLoadMore).toBe(false);
    expect(feed.next).toEqual([]);
  });

  it('holds back entries older than what a source with more pages has loaded', () => {
    // The activity feed is loaded down to 10-08 and has older pages; notes are complete down to 09-01.
    const feed = mergeFeed([
      src(
        'activities',
        [
          fromActivity(activity({ id: 'x', occurredAt: '2026-10-09T10:00:00.000Z' })),
          fromActivity(activity({ id: 'y', occurredAt: '2026-10-08T10:00:00.000Z' })),
        ],
        true,
      ),
      src('notes', [n('a', '2026-10-07T10:00:00.000Z'), n('b', '2026-09-01T10:00:00.000Z')]),
    ]);
    // An older activity could still be at 10-07.5: the 10-07 note waits.
    expect(feed.dated.map((e) => e.at)).toEqual([
      '2026-10-09T10:00:00.000Z',
      '2026-10-08T10:00:00.000Z',
    ]);
    expect(feed.canLoadMore).toBe(true);
    expect(feed.next).toEqual(['activities']);
  });

  it('asks the source that limits the horizon, not all of them', () => {
    const feed = mergeFeed([
      src('activities', [fromActivity(activity({ occurredAt: '2026-10-09T10:00:00.000Z' }))], true),
      src('notes', [n('a', '2026-10-02T10:00:00.000Z')], true),
    ]);
    // Horizon is the newer of the two oldest-loaded instants (10-09, from the activities).
    expect(feed.next).toEqual(['activities']);
    expect(feed.dated).toHaveLength(1);
  });

  it('shows everything once no source has older pages', () => {
    const feed = mergeFeed([
      src('notes', [n('a', '2026-01-01T10:00:00.000Z')]),
      src('activities', [fromActivity(activity({ occurredAt: '2026-10-09T10:00:00.000Z' }))]),
    ]);
    expect(feed.dated).toHaveLength(2);
  });

  it('withholds the dated entries while a source with more pages has none loaded', () => {
    const feed = mergeFeed([
      src('notes', [n('a', '2026-10-01T10:00:00.000Z')]),
      src('activities', [], true),
    ]);
    expect(feed.dated).toEqual([]);
    expect(feed.next).toEqual(['activities']);
  });
});

describe('day groups', () => {
  // Wednesday 14 Oct 2026, noon in Asia/Kolkata.
  const now = new Date('2026-10-14T06:30:00.000Z');
  const zone = 'Asia/Kolkata';
  it('names today, yesterday, this week and earlier', () => {
    expect(dayGroupOf('2026-10-14T01:00:00.000Z', now, zone)).toBe('today');
    expect(dayGroupOf('2026-10-13T10:00:00.000Z', now, zone)).toBe('yesterday');
    expect(dayGroupOf('2026-10-12T10:00:00.000Z', now, zone)).toBe('thisWeek'); // Monday
    expect(dayGroupOf('2026-10-11T10:00:00.000Z', now, zone)).toBe('earlier'); // Sunday of last week
    expect(dayGroupOf('2026-09-01T10:00:00.000Z', now, zone)).toBe('earlier');
  });

  it('counts the day on the clock of the zone', () => {
    // 00:30 IST on the 14th is still the 13th in UTC.
    expect(dayGroupOf('2026-10-13T19:00:00.000Z', now, zone)).toBe('today');
    expect(dayGroupOf('2026-10-13T19:00:00.000Z', now, 'UTC')).toBe('yesterday');
  });

  it('reads the future as today, and a Monday has no "this week" before yesterday', () => {
    expect(dayGroupOf('2026-10-20T10:00:00.000Z', now, zone)).toBe('today');
    const monday = new Date('2026-10-12T06:30:00.000Z');
    expect(dayGroupOf('2026-10-11T10:00:00.000Z', monday, zone)).toBe('yesterday');
    expect(dayGroupOf('2026-10-10T10:00:00.000Z', monday, zone)).toBe('earlier');
    expect(dayGroupOf('not a date', now, zone)).toBe('earlier');
  });

  it('groups in order and leaves empty groups out', () => {
    const entries = [
      fromNote(note('a', '2026-10-14T05:00:00.000Z')),
      fromNote(note('b', '2026-10-13T05:00:00.000Z')),
      fromNote(note('c', '2026-08-01T05:00:00.000Z')),
    ];
    const buckets = groupByDay(entries, now, zone);
    expect(buckets.map((b) => b.group)).toEqual(['today', 'yesterday', 'earlier']);
    expect(buckets[0]!.entries).toHaveLength(1);
  });
});
