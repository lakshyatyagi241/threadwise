import type {
  ContactListResponse,
  ContactResponse,
  SessionResponse,
  TagResponse,
} from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the contacts endpoints, for tests. Fake names, numbers and addresses only. */

const base: ContactResponse = {
  id: '11111111-1111-4111-8111-111111111111',
  displayId: 'CON-0001',
  name: 'Aarav Sharma',
  firstName: 'Aarav',
  lastName: 'Sharma',
  email: 'aarav@example.test',
  phone: '+919812345678',
  companyId: null,
  ownerId: null,
  lifecycleState: 'active',
  lifecycleStage: 'qualified',
  lifecycleStageDate: '2026-10-01T09:00:00.000Z',
  previousLifecycleStage: null,
  previousLifecycleStageDate: null,
  status: 'Open',
  lostReason: null,
  otherLostReason: null,
  wonAt: null,
  lostAt: null,
  leadScore: 40,
  whatsappSubscriptionStatus: 'subscribed',
  smsSubscriptionStatus: null,
  emailSubscriptionStatus: null,
  emailConfirmed: false,
  faxNumber: null,
  lastActivityAt: '2026-10-10T14:30:00.000Z',
  customFields: { city: 'Pune', vip: true },
  source: 'import',
  isUnsubscribed: false,
  isArchived: false,
  rowVersion: 3,
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-10-10T14:30:00.000Z',
};

export const aarav: ContactResponse = {
  ...base,
  tags: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'VIP', color: null }],
};

/** Only a phone: the row falls back to the number as its name. */
export const phoneOnly: ContactResponse = {
  ...base,
  id: '22222222-2222-4222-8222-222222222222',
  displayId: 'CON-0002',
  name: null,
  firstName: null,
  lastName: null,
  email: null,
  phone: '+919800000002',
  customFields: {},
  tags: [],
};

/** First and last name but no display name, only an email. */
export const emailOnly: ContactResponse = {
  ...base,
  id: '33333333-3333-4333-8333-333333333333',
  displayId: 'CON-0003',
  name: null,
  firstName: 'Meera',
  lastName: 'Iyer',
  email: 'meera@example.test',
  phone: null,
  customFields: {},
  tags: [],
};

export const nobody: ContactResponse = {
  ...base,
  id: '44444444-4444-4444-8444-444444444444',
  displayId: 'CON-0004',
  name: null,
  firstName: null,
  lastName: null,
  email: null,
  phone: null,
  customFields: {},
  tags: [],
};

export const contacts: ContactResponse[] = [aarav, phoneOnly, emailOnly];

export const page = (
  data: ContactResponse[],
  next: string | null = null,
  meta?: ContactListResponse['meta'],
): ContactListResponse => ({
  data,
  page: { nextCursor: next, hasMore: next !== null, limit: 50 },
  ...(meta ? { meta } : {}),
});

export const vipTag: TagResponse = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  name: 'VIP',
  color: null,
  rowVersion: 1,
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
};

/** A session that may read, add and edit contacts. */
export const sessionFull: SessionResponse = {
  ...baseSession,
  permissions: {
    'record.contacts.read': 'all',
    'record.contacts.create': 'all',
    'record.contacts.update': 'all',
  },
};

export const sessionReadOnly: SessionResponse = {
  ...baseSession,
  permissions: { 'record.contacts.read': 'all' },
};

export const sessionNoContacts: SessionResponse = {
  ...baseSession,
  permissions: { 'dash.dashboard.read': 'all' },
};
