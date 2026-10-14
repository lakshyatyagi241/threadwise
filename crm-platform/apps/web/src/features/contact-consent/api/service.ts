import { z } from 'zod';
import type {
  ConsentNotice,
  ConsentNoticeScope,
  ConsentExport,
  ConsentExportList,
  ConsentSettings,
  ContactConsent,
  RecordConsentInput,
  SaveConsentNoticeInput,
  TestConsentMessageInput,
  TestConsentMessageResult,
  UpdateConsentSettingsInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api/client';

/** The contracts type responses as interfaces, so the boundary check is the fields each screen leans on. */
const shape = <T>(...required: string[]): z.ZodType<T, z.ZodTypeDef, unknown> =>
  z.custom<T>(
    (v) =>
      typeof v === 'object' &&
      v !== null &&
      required.every((k) => k in (v as Record<string, unknown>)),
    'Unexpected response',
  );

const settings = shape<ConsentSettings>('detectionEnabled', 'optOutKeywords', 'footerText');
const tested = shape<TestConsentMessageResult>('outcome', 'match');
const contactConsent = shape<ContactConsent>('contactId', 'states', 'events');
export interface ComposerConsentConfig {
  footerText: Record<string, string>;
  footerDefaultOn: boolean;
  requireConsentForMarketing: boolean;
  optOutKeywords: Record<string, string[]>;
}
const composer = shape<ComposerConsentConfig>('footerText', 'footerDefaultOn');

const noticeShape = shape<ConsentNotice>('scope', 'ref', 'enabled', 'text', 'version');

const exportsList = shape<ConsentExportList>('data', 'needsAsync');
const oneExport = shape<ConsentExport>('id', 'status');

const BASE = '/contact-consent';
const enc = encodeURIComponent;

export const consentApi = {
  settings: (signal?: AbortSignal) => apiFetch(`${BASE}/settings`, { schema: settings, signal }),
  saveSettings: (input: UpdateConsentSettingsInput) =>
    apiFetch(`${BASE}/settings`, { method: 'PATCH', body: input, schema: settings }),
  test: (input: TestConsentMessageInput) =>
    apiFetch(`${BASE}/settings/test`, { method: 'POST', body: input, schema: tested }),
  composerConfig: (signal?: AbortSignal) =>
    apiFetch(`${BASE}/composer-config`, { schema: composer, signal }),
  exports: (signal?: AbortSignal) => apiFetch(`${BASE}/exports`, { schema: exportsList, signal }),
  requestExport: () => apiFetch(`${BASE}/exports`, { method: 'POST', body: {}, schema: oneExport }),
  forContact: (contactId: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/contacts/${enc(contactId)}`, { schema: contactConsent, signal }),
  notice: (scope: ConsentNoticeScope, ref: string, signal?: AbortSignal) =>
    apiFetch(`${BASE}/notices/${scope}/${enc(ref)}`, { schema: noticeShape, signal }),
  saveNotice: (scope: ConsentNoticeScope, ref: string, input: SaveConsentNoticeInput) =>
    apiFetch(`${BASE}/notices/${scope}/${enc(ref)}`, {
      method: 'PUT',
      body: input,
      schema: noticeShape,
    }),
  record: (
    contactId: string,
    input: Partial<RecordConsentInput> & { action: 'granted' | 'withdrawn' },
  ) =>
    apiFetch(`${BASE}/contacts/${enc(contactId)}/events`, {
      method: 'POST',
      body: input,
      schema: contactConsent,
    }),
};

/** The finished asynchronous export, as a same-origin download link. */
export const consentExportFileUrl = (exportId: string) =>
  `/api/v2${BASE}/exports/${enc(exportId)}/download`;

/** Same-origin download links (the proxy attaches the session): the CSV proof of a contact and of the workspace. */
export const consentExportUrl = (contactId?: string) =>
  contactId ? `/api/v2${BASE}/contacts/${enc(contactId)}/export` : `/api/v2${BASE}/export`;
