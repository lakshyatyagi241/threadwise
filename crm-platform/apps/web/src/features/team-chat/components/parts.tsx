'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@crm/ui';
import { errorCode } from '../api/hooks';
import { errorKind } from '../lib/errors';
import { avatarColor, initials } from '../lib/format';

/** The coloured initials circle; the colour is fixed per person. */
export function Avatar({
  id,
  name,
  size = 'md',
}: {
  id: string;
  name: string;
  size?: 'sm' | 'md';
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        avatarColor(id),
        size === 'sm' ? 'size-7 text-[11px]' : 'size-9 text-xs',
      )}
    >
      {initials(name)}
    </span>
  );
}

/** A thrown error (or an error code) as a sentence, chosen by code. */
export function useErrorText() {
  const t = useTranslations('team-chat.errors');
  return (error: unknown) => t(errorKind(typeof error === 'string' ? error : errorCode(error)));
}

/** The current time, refreshed each minute: the "today / another day" rule and the edit window follow it. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}
