import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { OperatorRole, OperatorSessionResponse } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { OperatorProvider } from './operator-context';
import { ToastProvider } from './ui/toast';

export type Seed = ReadonlyArray<readonly [queryKey: readonly unknown[], data: unknown]>;

export interface RenderOptions {
  locale?: 'en' | 'ar';
  /** The signed-in operator's role; the default is a super admin. */
  role?: OperatorRole;
  /** Query results already "fetched", so a screen that loads its data renders it on the server. */
  seed?: Seed;
}

export function operatorSession(role: OperatorRole = 'super_admin'): OperatorSessionResponse {
  return {
    operator: {
      id: '7f0c8f0e-2b1c-4b64-9d3a-3f2a1b7c9d10',
      email: 'ops@example.com',
      fullName: 'Sam Ops',
      role,
      mfaEnabled: true,
    },
    mfaEnrolmentRequired: false,
    sessionId: '1c9d2e4a-8b6f-4f3a-a1d5-5c7e9b0a2f11',
  };
}

/**
 * Renders a client component to static HTML with the real messages of a language, and fails on any
 * message key the component asks for that does not exist. There is no browser in the unit tests, so
 * this is what proves a screen's text is complete in both languages.
 */
export function renderWithMessages(element: ReactElement, options: RenderOptions = {}): string {
  const locale = options.locale ?? 'en';
  const missing: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of options.seed ?? []) client.setQueryData([...key], data);

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
        children: createElement(OperatorProvider, {
          session: operatorSession(options.role),
          children: createElement(ToastProvider, { children: element }),
        }),
      }),
    }),
  );
  if (missing.length > 0) throw new Error(`Missing or broken messages:\n${missing.join('\n')}`);
  return html;
}
