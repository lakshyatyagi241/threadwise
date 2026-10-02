'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import {
  ACCEPT_ALL,
  CONSENT_CHANGE_EVENT,
  DECLINE_OPTIONAL,
  OPEN_PREFERENCES_EVENT,
  doNotTrack,
  parseConsent,
  readConsent,
  readConsentRaw,
  writeConsent,
  type ConsentChoice,
} from './cookie-consent';
import { safeUrl } from './safe-url';
import { Button, LINK, cn } from './ui';

/** The main answers are set in capitals with wide spacing (spacing is dropped for scripts that do not use it). */
const CAPS = 'uppercase tracking-wider rtl:tracking-normal';

/** Before the browser has been asked (server render and hydration): show nothing rather than guess. */
const UNREAD = Symbol('unread');

function subscribeConsent(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, onChange);
}

/**
 * Cookie notice for guest pages (shown until the visitor decides): a bar at the bottom with Decline, Customize
 * and Accept all, and a preferences dialog with one switch per optional category. The choice is remembered for a
 * year in storage and in a cookie. A browser that asks not to be tracked is treated as having declined, without
 * showing anything.
 */
export function CookieBanner({ learnMoreUrl }: { learnMoreUrl: string | null }) {
  const t = useTranslations('auth-registration-security.guest.consent');
  const stored = useSyncExternalStore<string | null | typeof UNREAD>(
    subscribeConsent,
    readConsentRaw,
    () => UNREAD,
  );
  const decided = stored !== UNREAD && parseConsent(stored) !== null;
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const learnMore = safeUrl(learnMoreUrl);

  // A browser that asks not to be tracked has declined already; nothing is shown and the choice is recorded.
  useEffect(() => {
    if (stored === UNREAD || decided) return;
    const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
    if (
      doNotTrack({ doNotTrack: nav.doNotTrack, globalPrivacyControl: nav.globalPrivacyControl })
    ) {
      writeConsent(DECLINE_OPTIONAL);
    }
  }, [stored, decided]);

  const openPreferences = useCallback(() => {
    const current = readConsent();
    setAnalytics(current?.analytics ?? false);
    setMarketing(current?.marketing ?? false);
    setPrefsOpen(true);
  }, []);

  useEffect(() => {
    window.addEventListener(OPEN_PREFERENCES_EVENT, openPreferences);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, openPreferences);
  }, [openPreferences]);

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (prefsOpen && !el.open) el.showModal();
    if (!prefsOpen && el.open) el.close();
  }, [prefsOpen]);

  function decide(choice: Pick<ConsentChoice, 'analytics' | 'marketing'>) {
    writeConsent(choice);
    setPrefsOpen(false);
  }

  const showBar = stored !== UNREAD && !decided && !prefsOpen;

  return (
    <>
      {showBar && (
        <div
          role="region"
          aria-label={t('label')}
          className="fixed start-1/2 bottom-3 z-[75] w-[min(960px,calc(100%-1.5rem))] -translate-x-1/2 rounded-2xl border border-border bg-background/95 px-5 py-3.5 shadow-(--auth-shadow-pop) backdrop-blur rtl:translate-x-1/2"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <svg
                viewBox="0 0 24 24"
                className="mt-0.5 size-5 shrink-0 text-(--auth-link)"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="9" />
                <circle cx="9" cy="9" r="0.6" fill="currentColor" />
                <circle cx="14" cy="13" r="0.6" fill="currentColor" />
                <circle cx="10" cy="15" r="0.6" fill="currentColor" />
                <circle cx="15.5" cy="9.5" r="0.6" fill="currentColor" />
              </svg>
              <div className="min-w-0">
                <p className="text-[14px] font-semibold leading-snug">{t('title')}</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-(--auth-ink-600)">
                  {t('message')}{' '}
                  {learnMore && (
                    <a
                      href={learnMore}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(LINK, 'whitespace-nowrap')}
                    >
                      {t('learnMore')}
                    </a>
                  )}
                </p>
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto">
              <Button
                variant="secondary"
                size="sm"
                className={CAPS}
                onClick={() => decide(DECLINE_OPTIONAL)}
              >
                {t('decline')}
              </Button>
              <Button variant="secondary" size="sm" onClick={openPreferences}>
                {t('customize')}
              </Button>
              <Button
                size="sm"
                className={cn(CAPS, 'px-4 font-bold')}
                onClick={() => decide(ACCEPT_ALL)}
              >
                {t('acceptAll')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => setPrefsOpen(false)}
        onClick={(e) => {
          if (e.target === dialog.current) dialog.current?.close();
        }}
        className="m-auto w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-border bg-background p-0 text-foreground shadow-(--auth-shadow-pop) backdrop:bg-(--auth-overlay)"
      >
        <div className="border-b border-border px-6 pt-5 pb-3">
          <h2 id={titleId} className="font-serif text-[19px] font-semibold leading-tight">
            {t('prefsTitle')}
          </h2>
        </div>
        <div className="space-y-4 px-6 py-4">
          <p className="text-[12.5px] leading-relaxed text-(--auth-ink-700)">{t('message')}</p>
          <CategoryRow name={t('necessary')} hint={t('necessaryHint')} checked locked />
          <CategoryRow
            name={t('analytics')}
            hint={t('analyticsHint')}
            checked={analytics}
            onChange={setAnalytics}
          />
          <CategoryRow
            name={t('marketing')}
            hint={t('marketingHint')}
            checked={marketing}
            onChange={setMarketing}
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/40 px-6 py-3">
          <Button variant="secondary" size="sm" onClick={() => decide(DECLINE_OPTIONAL)}>
            {t('rejectAll')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="border-primary text-(--auth-link)"
            onClick={() => decide({ analytics, marketing })}
          >
            {t('save')}
          </Button>
          <Button
            size="sm"
            className={cn(CAPS, 'px-4 font-bold')}
            onClick={() => decide(ACCEPT_ALL)}
          >
            {t('acceptAll')}
          </Button>
        </div>
      </dialog>
    </>
  );
}

function CategoryRow({
  name,
  hint,
  checked,
  locked = false,
  onChange,
}: {
  name: string;
  hint: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13px] font-semibold">
          {name}
        </label>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">{hint}</p>
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
        className={cn(
          'relative mt-0.5 h-5 w-10 shrink-0 cursor-pointer appearance-none rounded-full bg-(--auth-paper-200) transition',
          'before:absolute before:start-0.5 before:top-0.5 before:size-4 before:rounded-full before:bg-(--auth-paper-0) before:transition-transform',
          'checked:bg-primary checked:before:translate-x-5 rtl:checked:before:-translate-x-5',
          'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-80',
        )}
      />
    </div>
  );
}
