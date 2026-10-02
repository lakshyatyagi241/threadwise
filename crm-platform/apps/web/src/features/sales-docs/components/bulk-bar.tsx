'use client';

import { useTranslations } from 'next-intl';
import { Button, Spinner } from '@crm/ui';
import { TrashIcon } from './icons';

export interface BulkBarProps {
  count: number;
  busy: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onClear: () => void;
}

/** Appears over the table while rows are ticked: delete (the only bulk action a document has). */
export function BulkBar(p: BulkBarProps) {
  const t = useTranslations('sales-docs.bulk');
  return (
    <div
      role="region"
      aria-label={t('label')}
      className="flex flex-wrap items-center gap-2 rounded-md border border-brand/30 bg-brand/5 px-3 py-2 text-sm"
    >
      <span className="font-medium" aria-live="polite">
        {t('selected', { count: p.count })}
      </span>
      {p.busy && <Spinner label={t('working')} />}
      {p.canDelete && (
        <Button
          size="sm"
          variant="secondary"
          disabled={p.busy}
          className="text-danger"
          onClick={p.onDelete}
        >
          <TrashIcon /> {t('delete')}
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ms-auto" onClick={p.onClear}>
        {t('clear')}
      </Button>
    </div>
  );
}
