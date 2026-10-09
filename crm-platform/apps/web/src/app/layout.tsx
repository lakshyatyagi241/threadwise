import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages, getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { dirOf } from '@/i18n/locales';
import { THEME_COOKIE } from '@/lib/auth/cookies';
import { getSiteConfig } from '@/features/platform-settings-branding-storage/site/site-config';
import { SiteHead } from '@/features/platform-settings-branding-storage/site/site-head';
import { SiteRuntime } from '@/features/platform-settings-branding-storage/site/site-runtime';
import {
  siteMetadata,
  siteViewport,
} from '@/features/platform-settings-branding-storage/site/seo-metadata';
import { Providers } from './providers';
import './globals.css';

/** The site-wide tags come from the platform settings (WD-SET-026, 027, 036); without them the page still has a title. */
export async function generateMetadata(): Promise<Metadata> {
  const cfg = await getSiteConfig();
  return cfg ? siteMetadata(cfg) : { title: (await getTranslations('common'))('appName') };
}

export async function generateViewport(): Promise<Viewport> {
  const cfg = await getSiteConfig();
  return cfg ? siteViewport(cfg) : {};
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const theme = (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
  const site = await getSiteConfig();
  return (
    <html lang={locale} dir={dirOf(locale)} data-theme={theme}>
      <head>{site && <SiteHead cfg={site} />}</head>
      <body className="bg-background text-foreground antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
          {site && <SiteRuntime banner={site.cookieBanner} analytics={site.analytics} />}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
