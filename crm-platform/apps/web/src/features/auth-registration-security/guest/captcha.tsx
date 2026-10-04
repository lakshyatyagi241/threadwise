'use client';

import type { RegistrationConfigResponse } from '@crm/contracts';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * reCAPTCHA gate for login, sign-up and forgot-password (TW-AUTH-003). The configuration comes from
 * `GET /auth/registration-config` (`captcha: null` means off). v2 shows the checkbox, v3 runs
 * invisibly and asks Google for a token with the action name when the form is submitted.
 */

export type CaptchaAction = 'login' | 'register' | 'forgot' | 'contact';

/** Google's terms for using reCAPTCHA ask for these two links next to the invisible badge's notice. */
export const GOOGLE_PRIVACY_URL = 'https://policies.google.com/privacy';
export const GOOGLE_TERMS_URL = 'https://policies.google.com/terms';
export type CaptchaConfig = NonNullable<RegistrationConfigResponse['captcha']>;

interface Grecaptcha {
  ready(cb: () => void): void;
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark';
      callback?: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
    },
  ): number;
  reset(widgetId?: number): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}

/** Not declared on `Window`: another part of the app may declare it too, and the two declarations would clash. */
const lib = (): Grecaptcha | undefined =>
  (window as unknown as { grecaptcha?: Grecaptcha }).grecaptcha;

/**
 * How long a submit waits for the v3 token in total (loading the library and asking Google for the token). When
 * the budget runs out the form is submitted anyway and the server decides, as in Reference.
 */
export const SCRIPT_WAIT_MS = 6000;
const scripts = new Map<string, Promise<Grecaptcha>>();

export function recaptchaScriptUrl(config: CaptchaConfig, locale: string): string {
  const render = config.version === 'v3' ? encodeURIComponent(config.siteKey) : 'explicit';
  return `https://www.google.com/recaptcha/api.js?render=${render}&hl=${encodeURIComponent(locale)}`;
}

function loadScript(url: string): Promise<Grecaptcha> {
  const cached = scripts.get(url);
  if (cached) return cached;
  const promise = new Promise<Grecaptcha>((resolve, reject) => {
    const done = () => {
      const g = lib();
      if (!g) return reject(new Error('reCAPTCHA unavailable'));
      g.ready(() => resolve(g));
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`);
    if (existing) {
      if (lib()) done();
      else {
        existing.addEventListener('load', done, { once: true });
        existing.addEventListener('error', () => reject(new Error('reCAPTCHA failed to load')), {
          once: true,
        });
      }
      return;
    }
    const el = document.createElement('script');
    el.src = url;
    el.async = true;
    el.defer = true;
    el.onload = done;
    el.onerror = () => reject(new Error('reCAPTCHA failed to load'));
    document.head.appendChild(el);
  });
  // A failed load must be retried next time, not remembered.
  promise.catch(() => scripts.delete(url));
  scripts.set(url, promise);
  return promise;
}

/** Rejects with `timeout` when `p` has not settled within `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

export interface CaptchaGate {
  /** False when the platform has no captcha configured: the gate renders nothing and `token()` is undefined. */
  enabled: boolean;
  /** The checkbox (v2) or the "protected by reCAPTCHA" notice (v3). Place it just above the submit button. */
  widget: ReactNode;
  /** The token to send as `captchaToken`. v2: the solved checkbox (undefined until solved). v3: runs `execute`. */
  token: () => Promise<string | undefined>;
  /** True when a v2 checkbox still needs to be ticked before submitting. */
  needsInteraction: boolean;
  /** Clears a used v2 token (a token works once). */
  reset: () => void;
}

export function useCaptcha(config: CaptchaConfig | null, action: CaptchaAction): CaptchaGate {
  const t = useTranslations('auth-registration-security.guest.captcha');
  const locale = useLocale();
  /** The v2 mount point. A state (callback ref) so the widget is drawn again whenever the form re-mounts it. */
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const widgetId = useRef<number | null>(null);
  const [solved, setSolvedState] = useState(false);
  /** The token itself is never rendered, so it lives in a ref; `solved` only drives the UI. */
  const solvedToken = useRef<string | null>(null);
  const setSolved = useCallback((token: string | null) => {
    solvedToken.current = token;
    setSolvedState(Boolean(token));
  }, []);

  const version = config?.version;
  const siteKey = config?.siteKey;

  useEffect(() => {
    if (!version || !siteKey) return;
    const url = recaptchaScriptUrl({ version, siteKey }, locale);
    let cancelled = false;
    const mount = host;
    // Warm the library up so submitting does not wait for it.
    loadScript(url)
      .then((g) => {
        if (cancelled || version !== 'v2' || !mount || widgetId.current !== null) return;
        widgetId.current = g.render(mount, {
          sitekey: siteKey,
          theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          callback: (token) => setSolved(token),
          'expired-callback': () => setSolved(null),
          'error-callback': () => setSolved(null),
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (mount) mount.innerHTML = '';
      widgetId.current = null;
      setSolved(null);
    };
  }, [version, siteKey, locale, host, setSolved]);

  const token = useCallback(async (): Promise<string | undefined> => {
    if (!version || !siteKey) return undefined;
    if (version === 'v2') return solvedToken.current ?? undefined;
    try {
      // One budget for both steps: a slow library plus a slow answer must not hold the form for twice as long.
      return await withTimeout(
        loadScript(recaptchaScriptUrl({ version, siteKey }, locale)).then((g) =>
          g.execute(siteKey, { action }),
        ),
        SCRIPT_WAIT_MS,
      );
    } catch {
      // Could not get a token: submit without one and let the server refuse it with a clear error.
      return undefined;
    }
  }, [version, siteKey, locale, action]);

  const reset = useCallback(() => {
    setSolved(null);
    if (widgetId.current !== null) lib()?.reset(widgetId.current);
  }, [setSolved]);

  if (!config) {
    return { enabled: false, widget: null, token, needsInteraction: false, reset };
  }

  const widget =
    config.version === 'v2' ? (
      <div className="overflow-x-auto" data-testid="recaptcha-v2">
        <div ref={setHost} />
      </div>
    ) : (
      <p className="text-[10px] leading-snug text-(--auth-ink-500)" data-testid="recaptcha-v3">
        {t.rich('protected', {
          privacy: (chunks) => (
            <a
              href={GOOGLE_PRIVACY_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--auth-link) hover:underline"
            >
              {chunks}
            </a>
          ),
          terms: (chunks) => (
            <a
              href={GOOGLE_TERMS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-(--auth-link) hover:underline"
            >
              {chunks}
            </a>
          ),
        })}
      </p>
    );

  return {
    enabled: true,
    widget,
    token,
    needsInteraction: config.version === 'v2' && !solved,
    reset,
  };
}
