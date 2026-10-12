import type {
  ContactActivityResponse,
  ContactFileResponse,
  ContactNoteResponse,
  SessionResponse,
} from '@crm/contracts';
import { aarav } from './contacts-fixtures';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the contact notes, activity and files endpoints, for tests. Fake text only. */

export const contactId = aarav.id;

export const noteA: ContactNoteResponse = {
  id: 'aaaa1111-1111-4111-8111-111111111111',
  contactId,
  body: 'Asked for a demo next week. Prefers a call after 5 pm.',
  createdBy: '6f1c3f0e-6f5c-4d3a-9a4e-2f6f1b0d9a11',
  updatedBy: null,
  rowVersion: 1,
  createdAt: '2026-10-10T09:30:00.000Z',
  updatedAt: '2026-10-10T09:30:00.000Z',
};

/** Changed after it was written. */
export const noteB: ContactNoteResponse = {
  ...noteA,
  id: 'bbbb2222-2222-4222-8222-222222222222',
  body: 'Sent the price list.',
  rowVersion: 3,
  createdAt: '2026-10-08T11:00:00.000Z',
  updatedAt: '2026-10-09T08:15:00.000Z',
};

export const notes: ContactNoteResponse[] = [noteA, noteB];

/** The list envelope of any endpoint of this feature. */
export const pageOf = <T>(data: T[], next: string | null = null) => ({
  data,
  page: { nextCursor: next, hasMore: next !== null, limit: 20 },
});

export const callEntry: ContactActivityResponse = {
  id: 'cccc3333-3333-4333-8333-333333333333',
  contactId,
  activityType: 'call',
  title: 'Called about the demo',
  body: 'Booked for Friday.',
  source: 'user',
  actorId: '6f1c3f0e-6f5c-4d3a-9a4e-2f6f1b0d9a11',
  occurredAt: '2026-10-11T10:00:00.000Z',
  createdAt: '2026-10-11T10:00:00.000Z',
};

/** Written by the system, with a type the app has no word for. */
export const systemEntry: ContactActivityResponse = {
  id: 'dddd4444-4444-4444-8444-444444444444',
  contactId,
  activityType: 'form_submission',
  title: 'Filled in the enquiry form',
  body: null,
  source: 'system',
  actorId: null,
  occurredAt: '2026-10-09T07:00:00.000Z',
  createdAt: '2026-10-09T07:00:00.000Z',
};

export const activities: ContactActivityResponse[] = [callEntry, systemEntry];

export const pdfFile: ContactFileResponse = {
  id: 'eeee5555-5555-4555-8555-555555555555',
  contactId,
  fileName: 'Price list.pdf',
  fileSizeBytes: 12 * 1024,
  storageKey: 'contacts/aarav/price-list.pdf',
  mimeType: 'application/pdf',
  uploadedBy: null,
  createdAt: '2026-10-07T12:00:00.000Z',
};

/** No size and no type recorded. */
export const mysteryFile: ContactFileResponse = {
  ...pdfFile,
  id: 'ffff6666-6666-4666-8666-666666666666',
  fileName: 'scan-001',
  fileSizeBytes: null,
  mimeType: null,
};

export const files: ContactFileResponse[] = [pdfFile, mysteryFile];

const withPermissions = (permissions: SessionResponse['permissions']): SessionResponse => ({
  ...baseSession,
  permissions,
});

/** May read and change contacts (so notes, activity and files) and read tasks. */
export const sessionFull = withPermissions({
  'record.contacts.read': 'all',
  'record.contacts.update': 'all',
  'record.tasks.read': 'all',
});

/** May read contacts only, and not tasks. */
export const sessionReadOnly = withPermissions({ 'record.contacts.read': 'all' });

export const sessionNoContacts = withPermissions({ 'dash.dashboard.read': 'all' });
