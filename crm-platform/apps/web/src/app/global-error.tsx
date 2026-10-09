'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect, useState } from 'react';
import en from '../../messages/en/common.json';
import { DEFAULT_LOCALE, LOCALE_COOKIE, dirOf, isLocale } from '@/i18n/locales';

type Fatal = (typeof en)['common']['fatal'];

/** The locale the provider would have used: the same cookie `i18n/request.ts` reads, falling back to the default. */
function cookieLocale(): string {
  const raw = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${LOCALE_COOKIE}=`))
    ?.slice(LOCALE_COOKIE.length + 1);
  const value = raw ? decodeURIComponent(raw) : undefined;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * The last resort: a rendering error that no nearer boundary caught. Reports it and shows a plain page; the layout (and with
 * it the theme and translations) failed, so this must not depend on either. Strings come straight from the `common` message
 * slice: English is bundled so the first paint always has text, and the visitor's locale file (when one exists) replaces it
 * once loaded.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  const [locale, setLocale] = useState<string>(DEFAULT_LOCALE);
  const [text, setText] = useState<Fatal>(en.common.fatal);

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  useEffect(() => {
    const wanted = cookieLocale();
    if (wanted === DEFAULT_LOCALE) return;
    let live = true;
    import(`../../messages/${wanted}/common.json`)
      .then((m: { default: { common?: { fatal?: Partial<Fatal> } } }) => {
        if (!live) return;
        setLocale(wanted);
        setText({ ...en.common.fatal, ...m.default.common?.fatal });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  return (
    <html lang={locale} dir={dirOf(locale)}>
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: '15vh auto',
          maxWidth: 480,
          padding: 24,
        }}
      >
        <h1 style={{ fontSize: 22 }}>{text.title}</h1>
        <p style={{ color: '#555' }}>
          {error.digest ? text.bodyWithDigest.replace('{digest}', error.digest) : text.body}
        </p>
        <a href="/">{text.home}</a>
      </body>
    </html>
  );
}
