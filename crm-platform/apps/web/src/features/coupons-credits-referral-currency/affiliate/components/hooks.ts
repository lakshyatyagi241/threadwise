'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@crm/ui';
import { useTranslations } from 'next-intl';

/** `value` after it has stopped changing for `ms` (Reference's search waited 220 ms). */
export function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return out;
}

/** Copies a URL to the clipboard and says so; "Could not copy." when the browser refuses. Must run under a ToastProvider. */
export function useCopyLink(copiedKey: 'copied' | 'copiedClipboard' = 'copied') {
  const t = useTranslations('coupons-credits-referral-currency.affiliate.toast');
  const toast = useToast();
  return async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.toast(t(copiedKey), 'success');
    } catch {
      toast.toast(t('copyFailed'), 'danger');
    }
  };
}
