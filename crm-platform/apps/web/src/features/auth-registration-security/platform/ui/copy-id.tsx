'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { copyText } from './copy-button';

/**
 * A short id with a small copy button: the row stays compact, the full value is one click away.
 * `what` names the thing for the button's accessible name ("Copy request id").
 */
export function CopyId({
  value,
  shown,
  what,
}: {
  /** The full value that is copied. */
  value: string;
  /** What is written in the row (a shortened form); defaults to the full value, null shows only the button. */
  shown?: string | null;
  what: string;
}) {
  const t = useTranslations('auth-registration-security.platform.common');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="inline-flex items-center gap-1">
      {shown !== null && (
        <code dir="ltr" title={value} className="font-mono">
          {shown ?? value}
        </code>
      )}
      <button
        type="button"
        onClick={async () => {
          setState((await copyText(value)) ? 'copied' : 'failed');
          clearTimeout(timer.current);
          timer.current = setTimeout(() => setState('idle'), 2000);
        }}
        aria-label={t('copyWhat', { what })}
        className="rounded px-1 text-[11px] text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span aria-live="polite">
          {state === 'copied' ? t('copied') : state === 'failed' ? t('copyFailed') : t('copy')}
        </span>
      </button>
    </span>
  );
}
