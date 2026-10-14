'use client';

import { useTranslations } from 'next-intl';

/**
 * A small, quiet note (not a banner) for the bell panel and the notification preferences: the live connection is down, so alerts come
 * from a one-minute check instead of arriving at once. Nothing renders while live updates work.
 */
export function LivePausedNote({ paused }: { paused: boolean }) {
  const t = useTranslations('notifications.live');
  if (!paused) return null;
  return (
    <p
      role="status"
      data-testid="live-paused"
      className="flex items-start gap-2 text-xs text-muted-foreground"
    >
      <span aria-hidden="true" className="mt-1 size-2 shrink-0 rounded-full bg-warning" />
      <span>{t('paused')}</span>
    </p>
  );
}
