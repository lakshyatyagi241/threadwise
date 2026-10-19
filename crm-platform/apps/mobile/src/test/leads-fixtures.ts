import type {
  LeadEventListResponse,
  LeadEventResponse,
  LeadSourceResponse,
  SessionResponse,
} from '@crm/contracts';
import { session as baseSession } from './dashboard-fixtures';

/** Realistic answers of the lead-source endpoints, for tests. Fake names only. */

export const SOURCE_ID = '91111111-1111-4111-8111-111111111111';
export const CONTACT_ID = '92222222-2222-4222-8222-222222222222';
export const DEAL_ID = '93333333-3333-4333-8333-333333333333';

/** Where the workspace's lead hooks can be reached from outside: set, so the screens show no warning. */
export const hookAddress = { baseUrl: 'https://crm.example.test', problem: null } as const;

export const facebookForm: LeadSourceResponse = {
  id: SOURCE_ID,
  kind: 'webhook',
  providerKey: 'facebook',
  name: 'Facebook lead form',
  status: 'active',
  tokenHint: '4f2a',
  tokenRotatedAt: null,
  hasSecret: true,
  externalIdPath: null,
  mapping: { email: 'email', phone: 'phone_number' },
  defaults: {
    platform: 'Facebook',
    owner: { mode: 'unassigned', userIds: [] },
    deal: { enabled: false, title: '{{name}} ({{source}})' },
    notify: { owner: true, userIds: [] },
    speedToLead: {
      enabled: false,
      channel: 'whatsapp',
      templateId: null,
      senderId: null,
      delayMinutes: 0,
      businessHoursOnly: false,
      maxLeadAgeMinutes: 60,
    },
  },
  rawRetentionDays: 30,
  lastEventAt: '2026-10-15T09:30:00.000Z',
  needsAttention: 2,
  rowVersion: 3,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-10T08:00:00.000Z',
};

export const pausedLanding: LeadSourceResponse = {
  ...facebookForm,
  id: '94444444-4444-4444-8444-444444444444',
  name: 'Landing page',
  providerKey: null,
  status: 'paused',
  hasSecret: false,
  lastEventAt: null,
  needsAttention: 0,
};

const baseEvent: LeadEventResponse = {
  id: 'a1111111-1111-4111-8111-111111111111',
  sourceId: SOURCE_ID,
  externalId: 'lead-1',
  status: 'created',
  reason: null,
  error: null,
  isTest: false,
  contactId: CONTACT_ID,
  dealId: DEAL_ID,
  firstReply: null,
  hasPayload: true,
  payloadExpiresAt: '2026-11-14T09:30:00.000Z',
  attempts: 1,
  duplicateCount: 0,
  receivedAt: '2026-10-15T09:30:00.000Z',
  processedAt: '2026-10-15T09:30:02.000Z',
};

export const createdLead: LeadEventResponse = baseEvent;

export const reviewLead: LeadEventResponse = {
  ...baseEvent,
  id: 'a2222222-2222-4222-8222-222222222222',
  externalId: 'lead-2',
  status: 'needs_review',
  reason: 'no_contact_point',
  contactId: null,
  dealId: null,
  processedAt: null,
};

export const failedLead: LeadEventResponse = {
  ...reviewLead,
  id: 'a3333333-3333-4333-8333-333333333333',
  externalId: 'lead-3',
  status: 'failed',
  reason: 'internal_error',
  error: 'boom',
};

export const purgedReview: LeadEventResponse = {
  ...reviewLead,
  id: 'a4444444-4444-4444-8444-444444444444',
  externalId: 'lead-4',
  hasPayload: false,
};

export const testLead: LeadEventResponse = {
  ...baseEvent,
  id: 'a5555555-5555-4555-8555-555555555555',
  externalId: 'lead-5',
  isTest: true,
  status: 'duplicate',
  duplicateCount: 2,
};

export const events = [createdLead, reviewLead, failedLead, testLead];

export function eventPage(rows: LeadEventResponse[], nextCursor?: string): LeadEventListResponse {
  return {
    data: rows,
    page: { nextCursor: nextCursor ?? null, hasMore: nextCursor !== undefined, limit: 25 },
  };
}

const readPermissions = { 'leads.sources.read': 'all' } as const;

/** May read and manage lead sources, and read contacts and deals. */
export const sessionLeadsManager: SessionResponse = {
  ...baseSession,
  permissions: {
    ...readPermissions,
    'leads.sources.manage': 'all',
    'record.contacts.read': 'all',
    'record.deals.read': 'all',
  },
};

/** May look at lead sources and nothing else. */
export const sessionLeadsReadOnly: SessionResponse = {
  ...baseSession,
  permissions: readPermissions,
};

export const sessionNoLeads: SessionResponse = {
  ...baseSession,
  permissions: { 'dash.dashboard.read': 'all' },
};
