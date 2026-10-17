import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type {
  ContactFileResponse,
  ContactMeetingResponse,
  ContactNoteResponse,
  SessionResponse,
} from '@crm/contracts';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { FILE_KEYS } from '../../api/files';
import { MEETING_KEYS } from '../../api/meetings';
import { NOTE_KEYS } from '../../api/notes';
import type { ContactRow } from '../../api/schemas';
import { FilesSection } from './files-section';
import { MeetingsPanel } from './meetings-section';
import { NotesSection } from './notes-section';

/** Notes, Meetings and Files sections of the contact quick view / details page, rendered to markup (English). */

type Tree = { [key: string]: string | Tree };
const read = (file: string): Tree =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', 'en', file), 'utf8')) as Tree;
function merge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      typeof v === 'object' && typeof b === 'object' ? merge(b as Tree, v as Tree) : (v as Tree);
  }
  return out;
}
const MESSAGES = merge(
  read('contacts-attributes-tags.json'),
  read('contacts-attributes-tags.contact-notes.json'),
);

const ME = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '294dca7c-5806-4548-9035-dcca9befc7b1';
const UPDATE = 'record.contacts.update';

const session = (permissions: string[]) =>
  ({
    user: { id: ME, email: 'asha@x.test', fullName: 'Asha Rao', displayName: null },
    org: { timezone: null },
    permissions: Object.fromEntries(permissions.map((p) => [p, 'all'])),
  }) as unknown as SessionResponse;

const contact = { id: CONTACT_ID, name: 'Aarav Sharma', rowVersion: 4 } as unknown as ContactRow;

const PAGE = { nextCursor: null, hasMore: false, limit: 50 };
/** What `useCursorList` reads from the cache for an unfiltered list. */
const seedList = (qc: QueryClient, key: readonly unknown[], data: unknown[], hasMore = false) =>
  qc.setQueryData([...key, {}], {
    pages: [{ data, page: { ...PAGE, hasMore, nextCursor: hasMore ? 'next' : null } }],
    pageParams: [undefined],
  });

function render(
  el: ReactElement,
  opts: { permissions?: string[]; seed?: (qc: QueryClient) => void } = {},
) {
  const qc = new QueryClient();
  opts.seed?.(qc);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <SessionProvider session={session(opts.permissions ?? [])}>
        <NextIntlClientProvider locale="en" messages={MESSAGES} timeZone="UTC">
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </NextIntlClientProvider>
      </SessionProvider>
    </QueryClientProvider>,
  );
}

const NO_PHYSICAL = /\b(?:ml|mr|pl|pr)-\d|\b(?:left|right)-\d/;

const note = (over: Partial<ContactNoteResponse> = {}): ContactNoteResponse => ({
  id: '5b0d0f6e-0000-4000-8000-000000000001',
  contactId: CONTACT_ID,
  body: 'Asked for a quote.\nCall back on Monday.',
  createdBy: ME,
  updatedBy: null,
  rowVersion: 1,
  createdAt: '2026-10-16T09:30:00.000Z',
  updatedAt: '2026-10-16T09:30:00.000Z',
  ...over,
});

const meeting = (over: Partial<ContactMeetingResponse> = {}): ContactMeetingResponse => ({
  id: '6c1e1a7f-0000-4000-8000-000000000001',
  contactId: CONTACT_ID,
  title: 'Product demo',
  startsAt: '2026-10-20T10:00:00.000Z',
  endsAt: '2026-10-20T11:00:00.000Z',
  location: 'Room 4',
  createdBy: ME,
  rowVersion: 3,
  createdAt: '2026-10-16T09:30:00.000Z',
  updatedAt: '2026-10-16T09:30:00.000Z',
  ...over,
});

const file = (over: Partial<ContactFileResponse> = {}): ContactFileResponse => ({
  id: '7d2f2b80-0000-4000-8000-000000000001',
  contactId: CONTACT_ID,
  fileName: 'Quote 2026.pdf',
  fileSizeBytes: 2_516_582,
  storageKey: 'org/contacts/quote-2026.pdf',
  mimeType: 'application/pdf',
  uploadedBy: 'abcdef12-0000-4000-8000-000000000009',
  createdAt: '2026-10-15T08:00:00.000Z',
  ...over,
});

describe('Notes section', () => {
  it('shows a loading status while the notes are fetched', () => {
    const out = render(<NotesSection contact={contact} variant="page" />);
    expect(out).toContain('role="status"');
    expect(out).toContain('aria-label="Loading notes"');
  });

  it('shows the empty state and the composer to people who can update', () => {
    const out = render(<NotesSection contact={contact} variant="page" />, {
      permissions: [UPDATE],
      seed: (qc) => seedList(qc, NOTE_KEYS.list(CONTACT_ID), []),
    });
    expect(out).toContain('No notes yet. Write the first one above.');
    expect(out).toContain('<textarea');
    expect(out).toContain('maxLength="10000"');
    expect(out).toContain('Save note');
    // Nothing typed yet: the save button is disabled.
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>Save note<\/button>/);
    expect(out).toContain('Press Ctrl+Enter');
  });

  it('shows the plain empty state without a composer to people who only read', () => {
    const out = render(<NotesSection contact={contact} variant="page" />, {
      permissions: ['record.contacts.read'],
      seed: (qc) => seedList(qc, NOTE_KEYS.list(CONTACT_ID), []),
    });
    expect(out).toContain('No notes yet.');
    expect(out).not.toContain('Write the first one');
    expect(out).not.toContain('<textarea');
    expect(out).not.toContain('Save note');
  });

  it('lists the notes with their text kept as written, edit and delete for people who can update', () => {
    const edited = note({
      id: '5b0d0f6e-0000-4000-8000-000000000002',
      body: 'Second note',
      rowVersion: 2,
      updatedAt: '2026-10-17T10:00:00.000Z',
    });
    const out = render(<NotesSection contact={contact} variant="drawer" />, {
      permissions: [UPDATE],
      seed: (qc) => seedList(qc, NOTE_KEYS.list(CONTACT_ID), [note(), edited]),
    });
    expect(out).toContain('Asked for a quote.\nCall back on Monday.');
    expect(out).toContain('whitespace-pre-wrap');
    expect(out).toContain('dir="auto"');
    expect(out).toContain('Added Oct 16, 2026');
    expect(out).toContain('Edited Oct 17, 2026');
    expect(out).toContain('>Edit<');
    expect(out).toContain('>Delete<');
    expect(out).toContain('aria-label="Edit the note added Oct 16, 2026');
    expect(out).toContain('aria-label="Delete the note added Oct 16, 2026');
    // The delete confirmation is in the markup (closed) with its own wording.
    expect(out).toContain('Delete this note?');
    expect(out).not.toMatch(NO_PHYSICAL);
  });

  it('shows the notes but no composer, edit or delete without the update permission', () => {
    const out = render(<NotesSection contact={contact} variant="page" />, {
      permissions: ['record.contacts.read'],
      seed: (qc) => seedList(qc, NOTE_KEYS.list(CONTACT_ID), [note()]),
    });
    expect(out).toContain('Asked for a quote.');
    expect(out).not.toContain('<textarea');
    expect(out).not.toContain('>Edit<');
    expect(out).not.toContain('>Delete<');
  });

  it('offers Load more when there is another page', () => {
    const more = render(<NotesSection contact={contact} variant="page" />, {
      seed: (qc) => seedList(qc, NOTE_KEYS.list(CONTACT_ID), [note()], true),
    });
    expect(more).toContain('Load more');
    const last = render(<NotesSection contact={contact} variant="page" />, {
      seed: (qc) => seedList(qc, NOTE_KEYS.list(CONTACT_ID), [note()]),
    });
    expect(last).not.toContain('Load more');
  });
});

describe('Meetings panel (inline, no dialog)', () => {
  it('lists meetings with the time range and the location, and Schedule meeting for people who can update', () => {
    const out = render(<MeetingsPanel contact={contact} />, {
      permissions: [UPDATE],
      seed: (qc) => seedList(qc, MEETING_KEYS.list(CONTACT_ID), [meeting()]),
    });
    expect(out).toContain('Meetings');
    expect(out).toContain('Product demo');
    expect(out).toContain('Oct 20, 2026');
    expect(out).toContain('At Room 4');
    expect(out).toContain('Schedule meeting');
    expect(out).toContain('aria-label="Edit the meeting Product demo"');
    expect(out).toContain('aria-label="Delete the meeting Product demo"');
    // Scheduling is a row, closed until asked for; the only dialog in the panel is the delete confirmation.
    expect(out).not.toContain('datetime-local');
    expect(out).not.toContain('aria-label="Schedule a meeting"');
    expect(out.match(/<dialog/g)).toHaveLength(1);
    expect(out).not.toMatch(NO_PHYSICAL);
  });

  it('a meeting link is a real link that opens in a new tab; a place stays plain text', () => {
    const out = render(<MeetingsPanel contact={contact} />, {
      seed: (qc) =>
        seedList(qc, MEETING_KEYS.list(CONTACT_ID), [
          meeting({ location: 'https://meet.example.com/abc' }),
        ]),
    });
    expect(out).toContain('href="https://meet.example.com/abc"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    const place = render(<MeetingsPanel contact={contact} />, {
      seed: (qc) => seedList(qc, MEETING_KEYS.list(CONTACT_ID), [meeting()]),
    });
    expect(place).not.toContain('href="Room 4"');
  });

  it('is read-only without the update permission', () => {
    const out = render(<MeetingsPanel contact={contact} />, {
      permissions: ['record.contacts.read'],
      seed: (qc) => seedList(qc, MEETING_KEYS.list(CONTACT_ID), [meeting()]),
    });
    expect(out).toContain('Product demo');
    expect(out).not.toContain('Schedule meeting');
    expect(out).not.toContain('>Edit<');
    expect(out).not.toContain('>Delete<');
    expect(out).not.toContain('datetime-local');
  });

  it('shows the empty state', () => {
    const out = render(<MeetingsPanel contact={contact} />, {
      permissions: [UPDATE],
      seed: (qc) => seedList(qc, MEETING_KEYS.list(CONTACT_ID), []),
    });
    expect(out).toContain('No meetings yet. Use Schedule meeting to add one.');
  });

  it('a meeting without times says so, under its own heading', () => {
    const out = render(<MeetingsPanel contact={contact} />, {
      seed: (qc) =>
        seedList(qc, MEETING_KEYS.list(CONTACT_ID), [
          meeting({ startsAt: null, endsAt: null, location: null }),
        ]),
    });
    expect(out).toContain('No time set');
    expect(out).toContain('No date');
    expect(out).not.toContain('At ');
  });

  it('splits upcoming (soonest first) from past (latest first)', () => {
    const next = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const later = new Date(Date.now() + 9 * 86_400_000).toISOString();
    const ago = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const out = render(<MeetingsPanel contact={contact} />, {
      seed: (qc) =>
        seedList(qc, MEETING_KEYS.list(CONTACT_ID), [
          meeting({
            id: 'a0000000-0000-4000-8000-000000000001',
            title: 'Later one',
            startsAt: later,
            endsAt: null,
          }),
          meeting({
            id: 'a0000000-0000-4000-8000-000000000002',
            title: 'Done one',
            startsAt: ago,
            endsAt: null,
          }),
          meeting({
            id: 'a0000000-0000-4000-8000-000000000003',
            title: 'Next one',
            startsAt: next,
            endsAt: null,
          }),
        ]),
    });
    expect(out.indexOf('Upcoming')).toBeLessThan(out.indexOf('Past'));
    expect(out.indexOf('Next one')).toBeLessThan(out.indexOf('Later one'));
    expect(out.indexOf('Later one')).toBeLessThan(out.indexOf('Done one'));
  });
});

describe('Files section', () => {
  it('lists name, size, type, date and uploader, with no upload control and no delete for readers', () => {
    const out = render(<FilesSection contact={contact} variant="page" />, {
      permissions: ['record.contacts.read'],
      seed: (qc) => seedList(qc, FILE_KEYS.list(CONTACT_ID), [file()]),
    });
    expect(out).toContain('Quote 2026.pdf');
    expect(out).toMatch(/2\.4\s?MB/);
    expect(out).toContain('application/pdf');
    expect(out).toContain('Uploaded Oct 15, 2026');
    expect(out).toContain('By abcdef12');
    expect(out).not.toContain('type="file"');
    expect(out).not.toMatch(/upload(?! ?ed)/i);
    expect(out).not.toContain('>Remove<');
    expect(out).not.toMatch(NO_PHYSICAL);
  });

  it('offers removal, behind a confirmation, to people who can update', () => {
    const out = render(<FilesSection contact={contact} variant="drawer" />, {
      permissions: [UPDATE],
      seed: (qc) => seedList(qc, FILE_KEYS.list(CONTACT_ID), [file()]),
    });
    expect(out).toContain('>Remove<');
    expect(out).toContain('aria-label="Remove the file Quote 2026.pdf"');
    expect(out).toContain('Remove this file?');
    expect(out).not.toContain('type="file"');
  });

  it('falls back to the extension for the type and says when the size is unknown', () => {
    const out = render(<FilesSection contact={contact} variant="page" />, {
      seed: (qc) =>
        seedList(qc, FILE_KEYS.list(CONTACT_ID), [file({ mimeType: null, fileSizeBytes: null })]),
    });
    expect(out).toContain('Size unknown');
    expect(out).toContain('>PDF<');
  });

  it('shows the empty state', () => {
    const out = render(<FilesSection contact={contact} variant="page" />, {
      seed: (qc) => seedList(qc, FILE_KEYS.list(CONTACT_ID), []),
    });
    expect(out).toContain('No files on this contact.');
  });
});
