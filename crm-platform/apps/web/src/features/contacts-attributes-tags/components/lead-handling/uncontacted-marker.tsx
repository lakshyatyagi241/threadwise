'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';

/**
 * The quiet "Uncontacted" marker (BL-290): nobody on the team has reached this contact yet. Drawn only for a contact that carries it,
 * so a workspace that never switches the feature on never sees it. `dot`: a small amber dot beside a name in a list row (the word is
 * in the tooltip and for screen readers). `chip`: the word, in the record header and the quick view.
 */
export function UncontactedMarker({
  since,
  variant = 'chip',
  className,
}: {
  /** ISO timestamp the contact became uncontacted, or null for a contacted contact (nothing is drawn). */
  since: string | null | undefined;
  variant?: 'dot' | 'chip';
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.leadHandling.uncontacted');
  const format = useFormatter();
  if (!since) return null;
  const date = new Date(since);
  const title = Number.isNaN(date.getTime())
    ? t('chipTitle')
    : t('waitingSince', { date: format.dateTime(date, { dateStyle: 'medium' }) });
  if (variant === 'dot') {
    return (
      <span title={title} className={cn('inline-flex shrink-0 items-center', className)}>
        <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
        <span className="sr-only">{t('chip')}</span>
      </span>
    );
  }
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs font-medium text-foreground',
        className,
      )}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-warning" />
      {t('chip')}
    </span>
  );
}
