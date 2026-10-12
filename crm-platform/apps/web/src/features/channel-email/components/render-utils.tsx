import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';

/** Renders with the real messages of a language and fails on any message key the component asks for that does not exist. */
export function render(
  element: ReactElement,
  opts: { locale?: string; seed?: ReadonlyArray<readonly [readonly unknown[], unknown]> } = {},
): string {
  const locale = opts.locale ?? 'en';
  const missing: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [key, data] of opts.seed ?? []) client.setQueryData([...key], data);
  const html = renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={loadMessages(locale)}
      timeZone="UTC"
      onError={(e) => missing.push(e.message)}
    >
      <QueryClientProvider client={client}>
        <ToastProvider dismissLabel="Dismiss">{element}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  ).replace(/<!-- -->/g, '');
  if (missing.length > 0) throw new Error(`Missing or broken messages:\n${missing.join('\n')}`);
  return html;
}
