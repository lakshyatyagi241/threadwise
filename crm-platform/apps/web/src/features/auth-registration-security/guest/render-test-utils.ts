import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { SessionProvider } from '../shared/session-context';

/**
 * Server-renders a guest or gate component with the real messages of a language, so a test can assert on what a
 * visitor would see (text, structure, classes) without a browser. A message key the component asks for that does
 * not exist fails the render, which also keeps the code and the message files in step. Effects do not run, so
 * this covers the first paint, not interaction.
 */
export function renderGuest(
  element: ReactElement,
  options: {
    locale?: 'en' | 'ar';
    session?: SessionResponse;
    seed?: Array<[unknown[], unknown]>;
  } = {},
): string {
  const locale = options.locale ?? 'en';
  const missing: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of options.seed ?? []) client.setQueryData(key, data);

  let tree: ReactElement = createElement(QueryClientProvider, { client, children: element });
  if (options.session) {
    tree = createElement(SessionProvider, { session: options.session, children: tree });
  }
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: loadMessages(locale),
      timeZone: 'UTC',
      onError: (error: { message: string }) => {
        missing.push(error.message);
      },
      getMessageFallback: ({ namespace, key }: { namespace?: string; key: string }) =>
        `[[${namespace ? `${namespace}.` : ''}${key}]]`,
      children: tree,
    }),
  );
  if (missing.length > 0) throw new Error(`Missing or broken messages:\n${missing.join('\n')}`);
  return html;
}

/** A sign-in configuration as `GET /auth/registration-config` returns it, with overrides. */
export function makeConfig(over: Record<string, unknown> = {}) {
  return {
    appName: 'Acme CRM',
    registrationOpen: true,
    emailVerification: 'off',
    trialDays: 14,
    rememberMeEnabled: true,
    otp: { enabled: false },
    captcha: null,
    social: { google: true, facebook: true },
    defaultCountryIso: null,
    authPages: {
      variant: 1,
      login: { accent: '#a78bfa' },
      register: {},
      forgot: {},
      defaulted: { login: [], register: [], forgot: [] },
      extra: { login: {}, register: {}, forgot: {} },
    },
    links: { terms: '/legal/terms', privacy: '/legal/privacy', cookies: null },
    ...over,
  } as import('@crm/contracts').RegistrationConfigResponse;
}

export function makeSession(over: Partial<SessionResponse> = {}): SessionResponse {
  return {
    user: {
      id: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11',
      email: 'asha@acme.test',
      fullName: 'Asha Rao',
      displayName: null,
      phone: null,
      locale: null,
      timezone: null,
      theme: 'paper',
      avatarUrl: null,
      emailVerified: true,
      mfaEnabled: false,
    },
    org: {
      id: '9d1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e22',
      slug: 'acme',
      name: 'Acme Studio',
      plan: 'starter',
      timezone: null,
      currency: null,
      messageFooter: null,
      onboardingStep: 'workspace',
    },
    roles: [],
    permissions: { 'admin.settings.manage': 'all' },
    landing: 'onboarding',
    flags: {
      suspended: false,
      emailUnverified: false,
      emailBlocked: false,
      mfaEnrolmentRequired: false,
      passwordChangeRequired: false,
    },
    sessionId: '3a6c9e1f-7b2d-4c85-8e0a-1d4f5b6c7a33',
    effectiveTimezone: 'UTC',
    ...over,
  };
}
