'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import type { SaveStatus } from '../lib/autosave';

/** "Draft saved", "Saving..." or "Could not save", announced politely; nothing before the first change. */
export function SaveIndicator({ status, onRetry }: { status: SaveStatus; onRetry: () => void }) {
  const t = useTranslations('campaigns.wizard.save');
  const key =
    status === 'saved'
      ? 'saved'
      : status === 'saving' || status === 'pending'
        ? 'saving'
        : status === 'error' || status === 'conflict'
          ? 'failed'
          : null;
  return (
    <span
      aria-live="polite"
      data-testid="save-indicator"
      className={cn(
        'inline-flex items-center gap-2 text-xs',
        key === 'failed' ? 'text-danger' : 'text-muted-foreground',
      )}
    >
      {key && t(key)}
      {status === 'error' && (
        <button
          type="button"
          onClick={onRetry}
          className="font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('retry')}
        </button>
      )}
    </span>
  );
}
