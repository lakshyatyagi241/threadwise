import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type {
  ContactActivityResponse,
  ContactNoteResponse,
  FieldHistoryEntry,
  TaskResponse,
} from '@crm/contracts';
import {
  makeSession,
  renderAccount as render,
} from '@/features/auth-registration-security/account/render-test-utils';
import type { ReactElement } from 'react';

/** The screens ask for a toast; a ToastProvider stands around every render. */
const renderAccount: typeof render = (element: ReactElement, options) =>
  render(<ToastProvider dismissLabel="Dismiss">{element}</ToastProvider>, options).replace(
    /<div aria-live="polite"[^>]*><\/div>/,
    '',
  );
import { FIELD_HISTORY_KEY } from '../../../api/field-history';
import { MEETING_KEYS } from '../../../api/meetings';
import { NOTE_KEYS } from '../../../api/notes';
import type { ContactRow } from '../../../api/schemas';
import {
  fromActivity,
  fromConsentEvent,
  fromConversation,
  fromFieldHistory,
  fromMeeting,
  fromNote,
  fromTask,
  fromWhatsappCall,
  type TimelineEntry,
} from '../../../lib/timeline';
import { ActivityFeed } from './activity-feed';
import { ComposeBox } from './compose-box';
import { TimelineRow } from './timeline-row';

/** The timeline's pieces, in English and Arabic, from the real messages (a missing key fails the render). */

const ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const OTHER = '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11';
const can = (...keys: string[]) =>
  makeSession({ permissions: Object.fromEntries(keys.map((k) => [k, 'all'])) });

const contact = {
  id: ID,
  name: 'Priya Sharma',
  firstName: 'Priya',
  lastName: 'Sharma',
  email: 'priya@example.com',
  phone: '+919876543210',
  customFields: {},
  rowVersion: 1,
} as unknown as ContactRow;

const page = (data: unknown[], hasMore = false) => ({
  pages: [{ data, page: { hasMore, nextCursor: hasMore ? 'next' : null, limit: 50 } }],
  pageParams: [undefined],
});

const activity = (over: Partial<ContactActivityResponse>): ContactActivityResponse => ({
  id: '11111111-1111-4111-8111-111111111111',
  contactId: ID,
  activityType: 'manual',
  title: 'Something happened',
  body: null,
  source: 'user',
  actorId: null,
  occurredAt: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  ...over,
});

const note = (body: string, createdAt = new Date().toISOString()): ContactNoteResponse => ({
  id: '22222222-2222-4222-8222-222222222222',
  contactId: ID,
  body,
  createdBy: null,
  updatedBy: null,
  rowVersion: 1,
  createdAt,
  updatedAt: createdAt,
});

const task = (over: Partial<TaskResponse> = {}): TaskResponse =>
  ({
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Send the quote',
    notes: null,
    priority: 'medium',
    status: 'open',
    dueAt: '2099-01-01T10:00:00.000Z',
    doneAt: null,
    remindedAt: null,
    bucket: null,
    overdue: false,
    assignee: { id: OTHER, name: 'Asha Rao' },
    createdBy: null,
    contact: null,
    deal: null,
    company: null,
    source: 'manual',
    rowVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  }) as TaskResponse;

const row = (entry: TimelineEntry, locale: 'en' | 'ar' = 'en', permissions: string[] = []) =>
  renderAccount(<TimelineRow entry={entry} contact={contact} />, {
    locale,
    session: can(...permissions),
    seed: [[['cat', 'status-options'], []]],
  });

describe('TimelineRow', () => {
  it('shows a note as one line, opens the rest on a click, and marks an edited note', () => {
    const long = `Wants a discount on the annual plan\nand asked for a call on Friday`;
    const out = row(fromNote(note(long)));
    expect(out).toContain('Note: Wants a discount on the annual plan');
    expect(out).toContain('aria-expanded="false"');
    const short = row(fromNote(note('Called back')));
    expect(short).toContain('Note: Called back');
    expect(short).not.toContain('aria-expanded');
    const edited = fromNote({ ...note('x'), updatedAt: new Date(Date.now() + 1000).toISOString() });
    expect(row(edited)).toContain('Edited');
  });

  it('draws an open task with its due date and a tick, and an overdue one in red', () => {
    const open = row(fromTask(task()), 'en', ['record.tasks.update']);
    expect(open).toContain('Send the quote');
    expect(open).toContain('role="checkbox"');
    expect(open).toContain('aria-checked="false"');
    expect(open).toContain('Due ');
    expect(open).toContain('by Asha Rao');
    expect(open).toContain(`href="/tasks?tab=all&amp;status=all&amp;task=${task().id}"`);
    const late = row(fromTask(task({ overdue: true, dueAt: '2020-01-01T10:00:00.000Z' })));
    expect(late).toContain('Overdue, was due');
    expect(late).toContain('text-danger');
    const done = row(fromTask(task({ status: 'done', doneAt: '2026-10-05T10:00:00.000Z' })));
    expect(done).toContain('Task done: Send the quote');
    expect(done).toContain('aria-checked="true"');
    expect(done).toContain('line-through');
  });

  it('says what a call was: direction, outcome, length, source, and the notes under it', () => {
    const wa = row(
      fromWhatsappCall({
        id: '44444444-4444-4444-8444-444444444444',
        direction: 'inbound',
        status: 'no-answer',
        customerPhone: '919876543210',
        ourPhone: '911234567890',
        contactId: ID,
        contactName: 'Priya',
        numberId: null,
        numberLabel: null,
        handlerType: 'operator',
        handlerId: null,
        handlerName: 'Asha Rao',
        startedAt: new Date().toISOString(),
        durationSec: 0,
        endReason: null,
        hasRecording: false,
      }),
    );
    expect(wa).toContain('Incoming call · No answer');
    expect(wa).toContain('WhatsApp');
    expect(wa).toContain('by Asha Rao');

    const logged = row(
      fromActivity(
        activity({
          activityType: 'call_manual',
          title: 'Outbound call, Connected, 4 min, by Priya',
          body: 'Asked for a quote on the premium plan and wants it by Friday so the team can decide',
        }),
      ),
    );
    expect(logged).toContain('Outbound call, Connected, 4 min, by Priya');
    expect(logged).toContain('>Logged<');
    expect(logged).toContain('Asked for a quote');
  });

  it('links a conversation to its thread with the last words and the unread count', () => {
    const out = row(
      fromConversation({
        id: '55555555-5555-4555-8555-555555555555',
        channel: { id: OTHER, kind: 'whatsapp_cloud', name: 'Shop' },
        preview: 'Can you send the price list?',
        unreadCount: 2,
        lastMessageAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never),
    );
    expect(out).toContain('Conversation on WhatsApp');
    expect(out).toContain('href="/inbox?c=55555555-5555-4555-8555-555555555555"');
    expect(out).toContain('Can you send the price list?');
    expect(out).toContain('2 unread');
  });

  it('words a stage change, several field changes together, and a consent change', () => {
    const change = (fields: Array<[string, unknown, unknown]>): FieldHistoryEntry[] =>
      fields.map(([fieldKey, oldValue, newValue]) => ({
        fieldKey,
        oldValue,
        newValue,
        actorType: 'user',
        changedByUserId: null,
        changedAt: '2026-10-03T10:00:00.000Z',
      }));
    expect(row(fromFieldHistory(change([['lifecycleStage', 'new', 'qualified']]))[0]!)).toContain(
      'Stage changed from New to Qualified',
    );
    const many = row(
      fromFieldHistory(
        change([
          ['email', 'a@x.test', 'b@x.test'],
          ['phone', null, '+911'],
        ]),
      )[0]!,
    );
    expect(many).toContain('2 details updated');
    expect(many).toContain('aria-expanded="false"');
    expect(
      row(
        fromConsentEvent({
          id: '66666666-6666-4666-8666-666666666666',
          contactId: ID,
          channel: 'whatsapp',
          purpose: 'marketing',
          action: 'withdrawn',
          source: 'keyword',
          evidence: {},
          actor: null,
          note: null,
          occurredAt: '2026-10-03T10:00:00.000Z',
          recordedAt: '2026-10-03T10:00:00.000Z',
        }),
      ),
    ).toContain('WhatsApp consent withdrawn');
  });

  it('plans a meeting, and reads in Arabic', () => {
    const upcoming = fromMeeting(
      {
        id: '77777777-7777-4777-8777-777777777777',
        contactId: ID,
        title: 'Demo',
        startsAt: '2099-02-01T10:00:00.000Z',
        endsAt: null,
        location: 'https://meet.example/abc',
        createdBy: null,
        rowVersion: 1,
        createdAt: '2026-10-01T10:00:00.000Z',
        updatedAt: '2026-10-01T10:00:00.000Z',
      },
      new Date(),
    );
    expect(row(upcoming)).toContain('Meeting: Demo');
    expect(row(fromNote(note('مرحبا')), 'ar')).toContain('مرحبا');
  });
});

describe('ActivityFeed', () => {
  const draw = (
    seed: Array<[readonly unknown[], unknown]>,
    permissions: string[] = ['record.contacts.read'],
    locale: 'en' | 'ar' = 'en',
    preview = false,
  ) =>
    renderAccount(
      <ActivityFeed
        contact={contact}
        preview={preview}
        onViewAll={() => undefined}
        onCompose={() => undefined}
      />,
      {
        locale,
        session: can(...permissions),
        seed: [
          [[...NOTE_KEYS.list(ID), {}], page([])],
          [[...MEETING_KEYS.list(ID), {}], page([])],
          [[...FIELD_HISTORY_KEY(ID), { limit: 50 }], page([])],
          [['cat', 'activities', ID, {}], page([])],
          ...seed,
        ],
      },
    );

  it('puts the filter pills and the search first, then the groups, newest first', () => {
    const today = new Date().toISOString();
    const out = draw([
      [
        [...NOTE_KEYS.list(ID), {}],
        page([
          note('First note', today),
          {
            ...note('Old note', '2020-01-01T10:00:00.000Z'),
            id: '99999999-9999-4999-8999-999999999999',
          },
        ]),
      ],
    ]);
    for (const name of ['All', 'Messages', 'Calls', 'Notes', 'Tasks', 'Meetings', 'Changes']) {
      expect(out, name).toContain(`>${name}</button>`);
    }
    expect(out).toContain('aria-label="Search this contact&#x27;s activity"');
    expect(out).toContain('>Today<');
    expect(out).toContain('>Earlier<');
    expect(out.indexOf('Note: First note')).toBeLessThan(out.indexOf('Note: Old note'));
    expect(out.indexOf('>All</button>')).toBeLessThan(out.indexOf('Note: First note'));
    expect(out.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('is a friendly start when nothing has happened, with the actions the person can take', () => {
    const out = draw([], ['record.contacts.read', 'record.contacts.update']);
    expect(out).toContain('No activity yet');
    expect(out).toContain('Everything you do with Priya will show up here');
    expect(out).toContain('Add a note');
    expect(out).toContain('Schedule a meeting');
    // no call logging, no tasks: never offered
    expect(out).not.toContain('Log a call');
    expect(out).not.toContain('Add a task');
    const withCalls = draw(
      [],
      ['record.contacts.read', 'record.contacts.update', 'call.logs.create'],
    );
    expect(withCalls).toContain('Log a call');
    expect(withCalls.match(/Add a note|Log a call|Add a task|Schedule a meeting/g)).toHaveLength(3);
  });

  it('offers Load more when a source has older pages, and nothing newer is held back from view', () => {
    const out = draw([
      [
        ['cat', 'activities', ID, {}],
        page([activity({ occurredAt: new Date().toISOString(), title: 'Quote sent' })], true),
      ],
    ]);
    expect(out).toContain('Load more');
    expect(out).toContain('Quote sent');
  });

  it('as the overview preview: recent activity, a link to all of it, no filters', () => {
    const out = draw(
      [[[...NOTE_KEYS.list(ID), {}], page([note('First note')])]],
      ['record.contacts.read'],
      'en',
      true,
    );
    expect(out).toContain('Recent activity');
    expect(out).toContain('View all activity');
    expect(out).not.toContain('aria-pressed');
    expect(out).not.toContain('type="search"');
  });

  it('reads in Arabic with logical spacing only', () => {
    const out = draw([], ['record.contacts.read'], 'ar');
    expect(out).not.toMatch(/\b(?:ml|mr|pl|pr)-\d/);
  });
});

describe('ComposeBox', () => {
  const draw = (permissions: string[], locale: 'en' | 'ar' = 'en') =>
    renderAccount(<ComposeBox contact={contact} />, { locale, session: can(...permissions) });

  it('has Note and Meeting for someone who may update contacts, Task and Call only with their permissions', () => {
    const base = draw(['record.contacts.update']);
    expect(base).toContain('role="tablist"');
    expect(base).toContain('>Note<');
    expect(base).toContain('>Meeting<');
    expect(base).not.toContain('>Task<');
    expect(base).not.toContain('>Call<');
    const all = draw([
      'record.contacts.update',
      'record.tasks.create',
      'record.tasks.read',
      'call.logs.create',
    ]);
    const tabs = [...all.matchAll(/id="compose-tab-(\w+)"/g)].map((m) => m[1]);
    expect(tabs).toEqual(['note', 'task', 'call', 'meeting']);
    expect(all.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(all).toMatch(/id="compose-tab-note"[^>]*aria-selected="true"/);
  });

  it('is left out when the person can add nothing', () => {
    expect(draw([])).toBe('');
  });

  it('opens on the note box with its own hint, and reads in Arabic', () => {
    expect(draw(['record.contacts.update'])).toContain('<textarea');
    expect(draw(['record.contacts.update'], 'ar')).toContain('role="tablist"');
  });
});
