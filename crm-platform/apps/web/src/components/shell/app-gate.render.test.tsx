import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import en from '../../../messages/en/shell.json';
import ar from '../../../messages/ar/shell.json';

const nav = vi.hoisted(() => ({ path: '/appointments' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.path }));

import { AppGate, closedAppGate, type AppRouteGate } from './app-gate';

const GATES: AppRouteGate[] = [
  { href: '/appointments', feature: 'appointment_booking', labelKey: 'shell.nav.appointments' },
];

/** Static renders with the real English and Arabic messages: no browser, so these prove what is and is not mounted, not how it looks. */
function render(
  path: string,
  enabled: string[] | null,
  marketplaceHref: string | null,
  locale: 'en' | 'ar' = 'en',
) {
  nav.path = path;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === 'en' ? en : ar} timeZone="UTC">
      <AppGate gates={GATES} enabled={enabled} marketplaceHref={marketplaceHref}>
        <div data-testid="the-page">APPOINTMENTS PAGE</div>
      </AppGate>
    </NextIntlClientProvider>,
  );
}

describe('closedAppGate', () => {
  it('closes the app and everything under it while the feature is missing', () => {
    expect(closedAppGate('/appointments', GATES, ['automation'])?.feature).toBe(
      'appointment_booking',
    );
    expect(closedAppGate('/appointments/types/new', GATES, [])?.feature).toBe(
      'appointment_booking',
    );
  });

  it('opens it once the workspace has the feature (plan, purchase or comp)', () => {
    expect(closedAppGate('/appointments', GATES, ['appointment_booking'])).toBeNull();
  });

  it('closes nothing while the entitlements are unknown, or on any other page', () => {
    expect(closedAppGate('/appointments', GATES, null)).toBeNull();
    expect(closedAppGate('/contacts', GATES, [])).toBeNull();
    expect(closedAppGate('/appointments-archive', GATES, [])).toBeNull();
  });
});

describe('AppGate', () => {
  it('never mounts the page of an app the workspace does not have', () => {
    const html = render('/appointments', ['automation'], '/marketplace/apps');
    expect(html).not.toContain('APPOINTMENTS PAGE');
    expect(html).toContain('data-testid="app-unavailable"');
    expect(html).toContain('Appointments isn&#x27;t part of your workspace');
  });

  it('also closes a nested address of the app', () => {
    const html = render('/appointments/booking-types/create', [], '/marketplace/apps');
    expect(html).not.toContain('APPOINTMENTS PAGE');
    expect(html).toContain('app-unavailable');
  });

  it('sends a person who may open the Marketplace there, and nobody else', () => {
    expect(render('/appointments', [], '/marketplace/apps')).toContain('href="/marketplace/apps"');
    const noAccess = render('/appointments', [], null);
    expect(noAccess).not.toContain('/marketplace');
    expect(noAccess).toContain('Ask a workspace admin');
  });

  it('renders the page untouched when the app is owned, and on pages of other areas', () => {
    expect(render('/appointments', ['appointment_booking'], '/marketplace/apps')).toContain(
      'APPOINTMENTS PAGE',
    );
    expect(render('/contacts', [], '/marketplace/apps')).toContain('APPOINTMENTS PAGE');
  });

  it('says it in Arabic too, with the app named in Arabic', () => {
    const html = render('/appointments', [], '/marketplace/apps', 'ar');
    expect(html).toContain('المواعيد');
    expect(html).not.toContain('APPOINTMENTS PAGE');
  });
});
