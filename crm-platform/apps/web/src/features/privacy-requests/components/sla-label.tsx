'use client';

import { useTranslations } from 'next-intl';
import type { PrivacyRequest } from '@crm/contracts';
import { cn } from '@crm/ui';
import { isOpen } from '../lib/model';

/** The clock of a request: days left, due today, or overdue in red. A closed request shows "Closed". */
export function SlaLabel({
  request,
  className,
}: {
  request: Pick<PrivacyRequest, 'status' | 'daysLeft' | 'overdue'>;
  className?: string;
}) {
  const t = useTranslations('privacy-requests.sla');
  if (!isOpen(request) || request.daysLeft === null) {
    return <span className={cn('text-muted-foreground', className)}>{t('closed')}</span>;
  }
  if (request.overdue || request.daysLeft < 0) {
    return (
      <span className={cn('font-medium text-danger', className)} data-sla="overdue">
        {t('overdue', { count: Math.max(1, Math.abs(request.daysLeft)) })}
      </span>
    );
  }
  return (
    <span className={className} data-sla="open">
      {request.daysLeft === 0 ? t('dueToday') : t('daysLeft', { count: request.daysLeft })}
    </span>
  );
}
