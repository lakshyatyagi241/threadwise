import type { ReactElement } from 'react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadMessages } from '@/i18n/messages';

/** The real merged English messages, so assertions can keep the literal English wording. */
export const enMessages = loadMessages('en');

/** Wraps a tree in the intl provider with locale `en` and the real English messages. */
export function WithIntl({ children }: { children: ReactElement }): ReactElement {
  return (
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={enMessages as never}>
      {children}
    </NextIntlClientProvider>
  );
}

/** `renderToStaticMarkup` of an element inside the English intl provider. */
export const renderIntl = (ui: ReactElement): string =>
  renderToStaticMarkup(<WithIntl>{ui}</WithIntl>);

/** A real translator for helpers that take one, e.g. `translator('flb.builder.shell.aiError')`. */
export function translator(namespace: string) {
  return createTranslator({
    locale: 'en',
    timeZone: 'UTC',
    messages: enMessages as never,
    namespace: namespace as never,
  }) as unknown as (key: string, values?: Record<string, string | number>) => string;
}
