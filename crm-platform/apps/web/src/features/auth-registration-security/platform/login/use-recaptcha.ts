'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A small reCAPTCHA loader for the operator sign-in page. v2 renders the checkbox widget into
 * a container; v3 is invisible and mints a token on submit. The script is added once per page,
 * only when the platform has captcha configured, and never before.
 */
interface Grecaptcha {
  ready(cb: () => void): void;
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      theme?: 'light' | 'dark';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): number;
  reset(widgetId?: number): void;
  execute(siteKey: string, options: { action: string }): Promise<string>;
}
declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
  }
}

export interface CaptchaConfig {
  version: 'v2' | 'v3';
  siteKey: string;
}

const loading = new Map<string, Promise<Grecaptcha>>();

/** v3 needs the site key in the script address; v2 draws its widget on demand. */
export function recaptchaSrc(config: CaptchaConfig): string {
  return config.version === 'v3'
    ? `https://www.google.com/recaptcha/api.js?render=${encodeURIComponent(config.siteKey)}`
    : 'https://www.google.com/recaptcha/api.js?render=explicit';
}

/** Forgets cached loads. Only the tests need this. */
export function resetRecaptchaLoader(): void {
  loading.clear();
}

export function loadRecaptcha(config: CaptchaConfig): Promise<Grecaptcha> {
  const src = recaptchaSrc(config);
  const cached = loading.get(src);
  if (cached) return cached;
  const promise = new Promise<Grecaptcha>((resolve, reject) => {
    const done = () => {
      const g = window.grecaptcha;
      if (g) g.ready(() => resolve(g));
      else reject(new Error('reCAPTCHA did not initialise'));
    };
    if (window.grecaptcha) return done();
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = done;
    script.onerror = () => {
      script.remove();
      reject(new Error('reCAPTCHA failed to load'));
    };
    document.head.appendChild(script);
  });
  loading.set(src, promise);
  promise.catch(() => loading.delete(src));
  return promise;
}

export type CaptchaStatus = 'off' | 'loading' | 'ready' | 'error';

/** The v3 action name the API expects for operator sign-in. */
export const OPERATOR_CAPTCHA_ACTION = 'operator';

type LoadState = 'pending' | 'ready' | 'failed';

export function useRecaptcha(config: CaptchaConfig | null) {
  const version = config?.version;
  const siteKey = config?.siteKey;
  const [load, setLoad] = useState<{ state: LoadState; attempt: number }>({
    state: 'pending',
    attempt: 0,
  });
  const [solved, setSolved] = useState(false);
  const token = useRef<string | null>(null);
  const widget = useRef<number | null>(null);
  const renderedInto = useRef<HTMLElement | null>(null);
  const api = useRef<Grecaptcha | null>(null);

  useEffect(() => {
    if (!version || !siteKey) return;
    let cancelled = false;
    loadRecaptcha({ version, siteKey }).then(
      (g) => {
        api.current = g;
        if (!cancelled) setLoad((l) => ({ ...l, state: 'ready' }));
      },
      () => {
        if (!cancelled) setLoad((l) => ({ ...l, state: 'failed' }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [version, siteKey, load.attempt]);

  const status: CaptchaStatus = !version
    ? 'off'
    : load.state === 'ready'
      ? 'ready'
      : load.state === 'failed'
        ? 'error'
        : 'loading';

  // v2: draw the checkbox when the container mounts (React calls this ref callback with the element).
  const setContainer = useCallback(
    (el: HTMLDivElement | null) => {
      const g = api.current;
      if (!el || !g || version !== 'v2' || !siteKey || renderedInto.current === el) return;
      renderedInto.current = el;
      widget.current = g.render(el, {
        sitekey: siteKey,
        theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
        callback: (value) => {
          token.current = value;
          setSolved(true);
        },
        'expired-callback': () => {
          token.current = null;
          setSolved(false);
        },
        'error-callback': () => {
          token.current = null;
          setSolved(false);
        },
      });
    },
    // `status` re-runs the callback identity once the script is ready, so the container is drawn then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, siteKey, status],
  );

  /** v2: the solved token (or undefined). v3: runs the invisible check. */
  const getToken = useCallback(async (): Promise<string | undefined> => {
    const g = api.current;
    if (!g || !version || !siteKey) return undefined;
    if (version === 'v3')
      return g.execute(siteKey, { action: OPERATOR_CAPTCHA_ACTION }).catch(() => undefined);
    return token.current ?? undefined;
  }, [version, siteKey]);

  /** A token is single-use: clear the widget after any attempt the server saw. */
  const reset = useCallback(() => {
    token.current = null;
    setSolved(false);
    if (widget.current !== null) api.current?.reset(widget.current);
  }, []);

  const retry = useCallback(
    () => setLoad((l) => ({ state: 'pending', attempt: l.attempt + 1 })),
    [],
  );

  return { status, solved, setContainer, getToken, reset, retry };
}
