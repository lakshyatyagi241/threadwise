'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button, type ButtonProps } from '@crm/ui';

/** Copies text to the clipboard and says so for two seconds. Falls back to a hidden textarea where the async API is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      area.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({
  text,
  label,
  ...rest
}: { text: string; label?: string } & Omit<ButtonProps, 'onClick' | 'children'>) {
  const t = useTranslations('auth-registration-security.platform.common');
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Button
      variant="secondary"
      size="sm"
      {...rest}
      onClick={async () => {
        setState((await copyText(text)) ? 'copied' : 'failed');
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setState('idle'), 2000);
      }}
    >
      <span aria-live="polite">
        {state === 'copied'
          ? t('copied')
          : state === 'failed'
            ? t('copyFailed')
            : (label ?? t('copy'))}
      </span>
    </Button>
  );
}
