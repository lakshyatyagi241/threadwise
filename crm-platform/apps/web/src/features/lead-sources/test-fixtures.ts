import type {
  AttributionTouch,
  MetaLeadAdsOverview,
  MetaLeadForm,
  MetaLeadPage,
  MetaLeadQuestion,
  MetaLeadSourceHealth,
  ContactAttributionResponse,
  LeadEventResponse,
  LeadMappingPreviewResponse,
  LeadSourceResponse,
} from '@crm/contracts';

/** Shared test data: a lead source, its events, a mapping preview and an attribution, with the fields the screens read. */

/** A stable uuid per number, so a test can name a row and find it in the HTML. */
export const ID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function source(overrides: Partial<LeadSourceResponse> = {}): LeadSourceResponse {
  return {
    id: ID(1),
    kind: 'webhook',
    providerKey: null,
    name: 'Zapier: Facebook lead ads',
    status: 'active',
    tokenHint: 'x9Qk',
    tokenRotatedAt: '2026-10-03T09:00:00.000Z',
    hasSecret: true,
    externalIdPath: 'lead.id',
    mapping: {
      name: 'lead.full_name',
      phone: 'lead.mobile',
      customFields: { budget: 'lead.budget' },
    },
    defaults: {
      countryCode: '91',
      platform: 'Facebook',
      lifecycleStage: null,
      tag: 'Lead',
      owner: { mode: 'unassigned', userIds: [] },
      deal: { enabled: false, pipelineId: null, stageId: null, title: '{{name}} ({{source}})' },
      notify: { owner: true, userIds: [] },
      speedToLead: {
        enabled: false,
        channel: 'whatsapp',
        templateId: null,
        senderId: null,
        delayMinutes: 0,
        businessHoursOnly: false,
      },
    },
    rawRetentionDays: 30,
    lastEventAt: '2026-10-03T09:30:00.000Z',
    needsAttention: 0,
    rowVersion: 4,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-03T09:00:00.000Z',
    ...overrides,
  };
}

export function event(overrides: Partial<LeadEventResponse> = {}): LeadEventResponse {
  return {
    id: ID(100),
    sourceId: ID(1),
    externalId: 'lead-100',
    status: 'created',
    reason: null,
    error: null,
    isTest: false,
    contactId: ID(200),
    dealId: null,
    hasPayload: true,
    payloadExpiresAt: '2026-11-02T09:30:00.000Z',
    firstReply: null,
    attempts: 1,
    duplicateCount: 0,
    receivedAt: '2026-10-03T09:30:00.000Z',
    processedAt: '2026-10-03T09:30:01.000Z',
    ...overrides,
  };
}

export function preview(
  overrides: Partial<LeadMappingPreviewResponse> = {},
): LeadMappingPreviewResponse {
  return {
    basedOn: 'payload',
    eventId: null,
    externalId: 'h:abc',
    contact: {
      name: 'Asha Rao',
      firstName: null,
      lastName: null,
      email: 'asha@example.test',
      phoneRaw: '98765 43210',
      phone: '+919876543210',
    },
    customFields: { budget: 5000, interested: true },
    attribution: { platform: 'Facebook', campaign: 'Launch', adset: null, ad: null, form: null },
    availablePaths: ['lead.full_name', 'lead.mobile', 'lead.budget'],
    usable: true,
    reasons: [],
    ...overrides,
  };
}

export function touch(overrides: Partial<AttributionTouch> = {}): AttributionTouch {
  return {
    id: ID(300),
    platform: 'facebook',
    sourceLabel: 'facebook',
    campaign: 'Launch',
    adset: 'AS-1',
    ad: 'Ad-1',
    form: 'F-1',
    leadSourceId: ID(1),
    capturedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

export function attribution(
  overrides: Partial<ContactAttributionResponse> = {},
): ContactAttributionResponse {
  const only = touch();
  return { first: only, latest: only, touches: [only], total: 1, ...overrides };
}

/** A token and a path that must never appear on a page after the reveal was dismissed. */
export const SECRET_TOKEN = 'tkn_9fA2c7Z1pQw8LmN4';
export const SECRET_PATH = `/v2/public/lead-hooks/${SECRET_TOKEN}`;

// --- Meta lead forms ------------------------------------------------------------------------------------------------------------

export function metaPage(
  overrides: Partial<Omit<MetaLeadPage, 'sync'>> & { sync?: Partial<MetaLeadPage['sync']> } = {},
): MetaLeadPage {
  const { sync, ...rest } = overrides;
  return {
    id: ID(500),
    pageId: '1100220033',
    name: 'Acme Studio',
    pictureUrl: null,
    pageStatus: 'connected',
    leadAccess: 'granted',
    missingScopes: [],
    sync: {
      enabled: true,
      state: 'subscribed',
      subscribedAt: '2026-10-02T09:00:00.000Z',
      lastLeadAt: '2026-10-03T09:30:00.000Z',
      lastSweepAt: '2026-10-03T10:00:00.000Z',
      lastError: null,
      formsConnected: 1,
      ...sync,
    },
    ...rest,
  };
}

export function metaQuestion(overrides: Partial<MetaLeadQuestion> = {}): MetaLeadQuestion {
  return {
    key: 'full_name',
    label: 'Full name',
    type: 'FULL_NAME',
    suggestedTarget: 'name',
    ...overrides,
  };
}

export const META_QUESTIONS: MetaLeadQuestion[] = [
  metaQuestion(),
  metaQuestion({ key: 'email', label: 'Email', type: 'EMAIL', suggestedTarget: 'email' }),
  metaQuestion({
    key: 'phone_number',
    label: 'Phone number',
    type: 'PHONE',
    suggestedTarget: 'phone',
  }),
  metaQuestion({
    key: 'what_is_your_budget',
    label: 'What is your budget?',
    type: 'CUSTOM',
    suggestedTarget: null,
  }),
];

export function metaForm(overrides: Partial<MetaLeadForm> = {}): MetaLeadForm {
  return {
    formId: '9900110022',
    name: 'Spring offer',
    status: 'ACTIVE',
    locale: 'en_US',
    leadsCount: 42,
    createdTime: '2026-09-01T09:00:00.000Z',
    questions: META_QUESTIONS,
    hasConsentCheckbox: false,
    connected: false,
    sourceId: null,
    lastLeadAt: null,
    lastError: null,
    ...overrides,
  };
}

export function metaOverview(overrides: Partial<MetaLeadAdsOverview> = {}): MetaLeadAdsOverview {
  return {
    configured: true,
    webhookUrl: 'https://api.acme.test/v2/public/facebook/webhook',
    verifyTokenConfigured: true,
    graphVersion: 'v21.0',
    requiredScopes: ['leads_retrieval', 'pages_manage_ads', 'pages_read_engagement'],
    usesLoginConfiguration: false,
    pages: [metaPage()],
    ...overrides,
  };
}

export function metaHealth(overrides: Partial<MetaLeadSourceHealth> = {}): MetaLeadSourceHealth {
  return {
    connected: true,
    pageId: '1100220033',
    pageName: 'Acme Studio',
    formId: '9900110022',
    formName: 'Spring offer',
    pageRef: ID(500),
    leadAccess: 'granted',
    state: 'subscribed',
    subscribed: true,
    lastLeadAt: '2026-10-03T09:30:00.000Z',
    lastError: null,
    ...overrides,
  };
}
