import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { SessionResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { SessionProvider } from '../shared/session-context';

/**
 * Server-render a client component of the account zone with the real messages
 * of a language and a signed-in session, so a test can assert on what the page
 * says and does without a browser. A message key the component asks for that
 * does not exist fails the render. Data a screen would fetch is "seeded": pass
 * `[queryKey, data]` pairs and the screen renders them as already loaded.
 */

export type Seed = ReadonlyArray<readonly [queryKey: readonly unknown[], data: unknown]>;

export interface RenderOptions {
  locale?: 'en' | 'ar';
  session?: SessionResponse;
  seed?: Seed;
}

export function makeSession(overrides: Partial<SessionResponse> = {}): SessionResponse {
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
      name: 'Acme Co',
      plan: 'starter',
      timezone: 'Asia/Kolkata',
      currency: null,
      messageFooter: null,
      onboardingStep: 'done',
    },
    roles: [],
    permissions: { 'auth.branding.update': 'all' },
    landing: 'dashboard',
    flags: {
      suspended: false,
      emailUnverified: false,
      emailBlocked: false,
      mfaEnrolmentRequired: false,
      passwordChangeRequired: false,
    },
    sessionId: '3a6c9e1f-7b2d-4c85-8e0a-1d4f5b6c7a33',
    effectiveTimezone: 'Asia/Kolkata',
    ...overrides,
  };
}

export function renderAccount(element: ReactElement, options: RenderOptions = {}): string {
  const locale = options.locale ?? 'en';
  const missing: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of options.seed ?? []) client.setQueryData([...key], data);

  // `children` goes inside the props because these providers declare it as a required prop.
  const html = renderToStaticMarkup(
    createElement(NextIntlClientProvider, {
      locale,
      messages: loadMessages(locale),
      timeZone: 'UTC',
      onError: (error: { message: string }) => {
        missing.push(error.message);
      },
      getMessageFallback: ({ namespace, key }: { namespace?: string; key: string }) =>
        `⟦${namespace ? `${namespace}.` : ''}${key}⟧`,
      children: createElement(QueryClientProvider, {
        client,
        children: createElement(SessionProvider, {
          session: options.session ?? makeSession(),
          children: element,
        }),
      }),
    }),
  );
  if (missing.length > 0) throw new Error(`Missing or broken messages:\n${missing.join('\n')}`);
  return html;
}
