'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PublicSiteConfig } from '@crm/contracts';
import { Button, Modal, Switch } from '@crm/ui';
import {
  CONSENT_COOKIE,
  choice,
  consentCookie,
  effectiveConsent,
  firstVisit,
  readConsent,
  type Consent,
} from './consent';
import { buildTrackers, consentUpdateSnippet, type TrackerIds } from './trackers';

const NS = 'platform-settings-branding-storage.cookie';

/** The console never loads banners or trackers (WD-SET-030, 033: not on the admin layout). */
const isConsole = (path: string) => path === '/admin' || path.startsWith('/admin/');

type Ui = 'none' | 'bar' | 'modal' | 'prefs';

declare global {
  interface Window {
    crmCookieConsent?: {
      get: () => Consent | null;
      has: (c: 'analytics' | 'marketing') => boolean;
      open: () => void;
    };
  }
}

function addScript(s: { src?: string; inline?: string; attrs?: Record<string, string> }) {
  const el = document.createElement('script');
  if (s.src) el.src = s.src;
  if (s.inline) el.text = s.inline;
  for (const [k, v] of Object.entries(s.attrs ?? {})) el.setAttribute(k, v);
  document.head.appendChild(el);
}

/**
 * The cookie banner, the preferences dialog and the tracker loader, in one client component (WD-SET-030, 033). The choice
 * is stored in a first-party cookie; scripts load as soon as it allows them, with no page reload (WaDesk reloaded so the
 * server could print them). Taking a permission back does reload, because a loaded tracker cannot be unloaded.
 */
export function SiteRuntime({
  banner,
  analytics,
}: {
  banner: PublicSiteConfig['cookieBanner'];
  analytics: PublicSiteConfig['analytics'];
}) {
  const t = useTranslations(NS);
  const path = usePathname();
  const off = isConsole(path);
  const [stored, setStored] = useState<Consent | null>(null);
  const [ready, setReady] = useState(false);
  const [ui, setUi] = useState<Ui>('none');
  const [draft, setDraft] = useState({ analytics: false, marketing: false });
  const injected = useRef<Set<string>>(new Set());
  const granted = useRef({ analytics: false, marketing: false });

  const persist = useCallback((c: Consent) => {
    document.cookie = consentCookie(c, window.location.protocol === 'https:');
    setStored(c);
    setUi('none');
  }, []);

  // First load: read the cookie, then decide what to show (rule 2).
  useEffect(() => {
    if (off) return;
    const existing = readConsent(document.cookie);
    // Reading the cookie is only possible in the browser, after hydration: the one legitimate setState-in-effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStored(existing);
    setReady(true);
    const dnt =
      navigator.doNotTrack === '1' || (window as { doNotTrack?: string }).doNotTrack === '1';
    const action = firstVisit({
      bannerEnabled: banner.enabled,
      stored: existing,
      respectDoNotTrack: banner.respectDoNotTrack,
      doNotTrack: dnt,
      style: banner.style,
    });
    if (action === 'reject') persist(choice(false, false));
    else if (action === 'bar' || action === 'modal') setUi(action);
  }, [off, banner.enabled, banner.respectDoNotTrack, banner.style, persist]);

  // The reopen hook other pages use ("Cookie preferences" links) and the public handle.
  useEffect(() => {
    if (off) return;
    const open = () => {
      setDraft({ analytics: stored?.analytics ?? false, marketing: stored?.marketing ?? false });
      setUi('prefs');
    };
    window.crmCookieConsent = {
      get: () => stored,
      has: (c) => effectiveConsent(banner.enabled, stored)[c],
      open,
    };
    const onClick = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.('[data-cookie-prefs-open]')) {
        e.preventDefault();
        open();
      }
    };
    document.addEventListener('click', onClick);
    return () => {
      document.removeEventListener('click', onClick);
      delete window.crmCookieConsent;
    };
  }, [off, stored, banner.enabled]);

  // Trackers: load what the current choice allows, once each; reload when a permission is withdrawn.
  useEffect(() => {
    if (off || !ready) return;
    const consent = effectiveConsent(banner.enabled, stored);
    if (
      (granted.current.analytics && !consent.analytics) ||
      (granted.current.marketing && !consent.marketing)
    ) {
      window.location.reload();
      return;
    }
    const plan = buildTrackers(analytics as TrackerIds, consent);
    const googleWasLoaded = injected.current.has('google-consent');
    for (const s of plan) {
      if (injected.current.has(s.key)) continue;
      injected.current.add(s.key);
      addScript(s);
      if (s.pixel) {
        const img = document.createElement('img');
        img.src = s.pixel;
        img.alt = '';
        img.width = 1;
        img.height = 1;
        img.style.display = 'none';
        document.body.appendChild(img);
      }
    }
    // A choice made after the Google tag loaded is told to it as a consent update.
    if (
      googleWasLoaded &&
      (consent.analytics !== granted.current.analytics ||
        consent.marketing !== granted.current.marketing)
    ) {
      addScript({ inline: consentUpdateSnippet(consent) });
    }
    granted.current = { analytics: consent.analytics, marketing: consent.marketing };
  }, [off, ready, stored, banner.enabled, analytics]);

  if (off || !ready || !banner.enabled) return null;

  const learnMore = banner.cookiesPolicyUrl || banner.policyUrl;
  const prefs = ui === 'prefs' || ui === 'modal';
  return (
    <>
      {ui === 'bar' && (
        <div
          role="region"
          aria-label={t('title')}
          data-testid="cookie-bar"
          className={`fixed inset-x-3 z-50 mx-auto flex max-w-3xl flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-4 shadow-xl ${banner.style === 'top-bar' ? 'top-3' : 'bottom-3'}`}
        >
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{t('title')}</p>
            <p className="text-muted-foreground">
              {banner.message}{' '}
              {learnMore && (
                <a href={learnMore} className="text-primary underline-offset-2 hover:underline">
                  {t('learnMore')}
                </a>
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => persist(choice(false, false))}>
              {t('decline')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setDraft({ analytics: false, marketing: false });
                setUi('prefs');
              }}
            >
              {t('customize')}
            </Button>
            <Button size="sm" onClick={() => persist(choice(true, true))}>
              {t('acceptAll')}
            </Button>
          </div>
        </div>
      )}
      <Modal
        open={prefs}
        onClose={() => setUi(stored ? 'none' : ui === 'prefs' ? 'bar' : 'none')}
        title={t('preferences')}
        eyebrow={t('title')}
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => persist(choice(false, false))}>
              {t('rejectAll')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => persist(choice(draft.analytics, draft.marketing))}
            >
              {t('save')}
            </Button>
            <Button size="sm" onClick={() => persist(choice(true, true))}>
              {t('acceptAll')}
            </Button>
          </div>
        }
      >
        <p className="mb-3 text-sm text-muted-foreground">{banner.message}</p>
        <ul className="space-y-2" data-cookie={CONSENT_COOKIE}>
          {(
            [
              ['necessary', true, true],
              ['analytics', draft.analytics, false],
              ['marketing', draft.marketing, false],
            ] as const
          ).map(([k, on, locked]) => (
            <li
              key={k}
              className="flex items-start justify-between gap-3 rounded-md border border-border p-3"
            >
              <div>
                <p className="text-sm font-medium">{t(`categories.${k}.title`)}</p>
                <p className="text-xs text-muted-foreground">{t(`categories.${k}.body`)}</p>
              </div>
              <Switch
                checked={on}
                disabled={locked}
                label={t(`categories.${k}.title`)}
                onCheckedChange={(v) => setDraft((d) => ({ ...d, [k]: v }))}
              />
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
