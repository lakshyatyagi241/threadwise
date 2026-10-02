'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@crm/ui';

/** Previous / Next over a cursor list; "Next" is on only while the API says there is more. */
export function PagerBar({
  page,
  hasPrev,
  hasNext,
  busy,
  onPrev,
  onNext,
}: {
  page: number;
  hasPrev: boolean;
  hasNext: boolean;
  busy?: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  const t = useTranslations('wallet-message-billing.common');
  return (
    <nav aria-label={t('pagination')} className="flex items-center justify-between gap-2 pt-2">
      <Button variant="secondary" size="sm" onClick={onPrev} disabled={!hasPrev || busy}>
        {t('previous')}
      </Button>
      <span className="text-xs text-muted-foreground" aria-live="polite">
        {t('pageN', { page })}
      </span>
      <Button variant="secondary" size="sm" onClick={onNext} disabled={!hasNext || busy}>
        {t('next')}
      </Button>
    </nav>
  );
}
