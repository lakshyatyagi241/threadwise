import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  SessionResponse,
  WizardAudienceCount,
  WizardAudienceSources,
  WizardCreditCheck,
  WizardDraft,
  WizardDraftResponse,
  WizardSender,
  WizardTemplate,
} from '@crm/contracts';
import { EMPTY_WIZARD_DRAFT } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';

/** Test fixtures and a renderer with the providers the wizard screens need (the repo's tests render to static markup). */

export const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const NOW = new Date('2026-10-06T08:00:00Z');

export const ALL_PERMISSIONS = [
  'camp.campaigns.read',
  'camp.campaigns.create',
  'camp.campaigns.test',
  'camp.campaigns.control',
];

export function session(
  perms: string[] = ALL_PERMISSIONS,
  timezone: string | null = 'Asia/Kolkata',
) {
  return {
    permissions: Object.fromEntries(perms.map((p) => [p, true])),
    org: { name: 'Acme', timezone },
  } as unknown as SessionResponse;
}

export function html(
  el: ReactElement,
  opts: { locale?: string; qc?: QueryClient; perms?: string[] } = {},
): string {
  const locale = opts.locale ?? 'en';
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={loadMessages(locale)}
      timeZone="UTC"
      now={NOW}
    >
      <QueryClientProvider client={opts.qc ?? new QueryClient()}>
        <SessionProvider session={session(opts.perms)}>
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </SessionProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

export const slot = (
  section: 'header' | 'body' | 'button',
  position: number,
  key = '',
  example: string | null = null,
) => ({
  slot: `${section}.${position}`,
  section,
  position,
  key,
  example,
});

export function template(over: Partial<WizardTemplate> = {}): WizardTemplate {
  return {
    id: uuid(1),
    name: 'order_update',
    language: 'en_US',
    category: 'utility',
    header: null,
    body: 'Hi {{1}}, your order {{2}} is on its way.',
    footer: 'Reply STOP to opt out',
    buttons: [{ type: 'URL', text: 'Track order', url: 'https://x.test/{{1}}' }],
    attachmentType: null,
    attachmentUrl: null,
    senderLabel: '+91 98000 00001',
    slots: [slot('body', 1, 'first_name', 'Asha'), slot('body', 2, 'order_no', 'A-1042')],
    ...over,
  };
}

export const templates = (): WizardTemplate[] => [
  template(),
  template({
    id: uuid(2),
    name: 'summer_sale',
    language: 'hi',
    category: 'marketing',
    body: 'Big summer sale, up to 50% off.',
    slots: [],
    buttons: [],
    senderLabel: null,
  }),
  template({
    id: uuid(3),
    name: 'otp_code',
    language: 'en_US',
    category: 'authentication',
    body: '{{1}} is your code',
    slots: [slot('body', 1, 'code')],
    buttons: [],
  }),
];

export function draft(over: Partial<WizardDraft> = {}): WizardDraft {
  return { ...EMPTY_WIZARD_DRAFT, ...over };
}

export function draftResponse(
  d: Partial<WizardDraft> = {},
  over: Partial<WizardDraftResponse> = {},
): WizardDraftResponse {
  return {
    id: uuid(100),
    status: 'draft',
    draft: draft(d),
    rowVersion: 3,
    createdAt: '2026-10-05T08:00:00.000Z',
    updatedAt: '2026-10-05T08:30:00.000Z',
    ...over,
  };
}

export const sender = (over: Partial<WizardSender> = {}): WizardSender => ({
  key: `waba:${uuid(31)}`,
  label: 'Acme Support',
  phone: '+919000000001',
  engine: 'waba',
  engineLabel: 'Meta',
  isDefault: true,
  ...over,
});

export const sources = (): WizardAudienceSources => ({
  groups: [
    { id: uuid(11), name: 'VIP customers', color: '#7C3AED', memberCount: 120 },
    { id: uuid(12), name: 'Newsletter', color: null, memberCount: 4300 },
  ],
  segments: [{ id: uuid(21), name: 'Active last 30 days', color: null, memberCount: null }],
});

export const count = (over: Partial<WizardAudienceCount> = {}): WizardAudienceCount => ({
  matching: 1000,
  optedOut: 30,
  invalidNumber: 20,
  recipients: 950,
  approximate: false,
  countries: [{ country: 'IN', count: 950 }],
  invalidConditions: [],
  ...over,
});

export const credit = (over: Partial<WizardCreditCheck> = {}): WizardCreditCheck => ({
  currency: 'USD',
  balanceMinor: 50_000,
  billingMode: 'wallet',
  category: 'utility',
  recipients: 950,
  chargeableMessages: 950,
  estimatedCostMinor: 9_500,
  lines: [
    { country: 'IN', messages: 900, unitPriceMinor: 10, subtotalMinor: 9_000 },
    { country: null, messages: 50, unitPriceMinor: 10, subtotalMinor: 500 },
  ],
  sufficient: true,
  shortfallMinor: 0,
  topupUrl: '/billing/top-up',
  ...over,
});

/** The shape a screen takes for a query that has not resolved or has failed. */
export const pending = {
  isPending: true,
  isError: false,
  isFetching: true,
  error: null,
  refetch: () => undefined,
};
export const failed = (error: unknown = new Error('boom')) => ({
  isPending: false,
  isError: true,
  isFetching: false,
  error,
  refetch: () => undefined,
});
export const ready = <T,>(data: T) => ({
  data,
  isPending: false,
  isError: false,
  isFetching: false,
  error: null,
  refetch: () => undefined,
});
