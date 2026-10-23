'use client';

import { useState } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Button, EmptyState, Input, Modal, Spinner } from '@crm/ui';
import { formatDateTime } from '@/lib/format-datetime';
import { useAuditEntries } from '../api/hooks';
import { matchesActivity } from '../lib/module-activity';
import { ActorCell, useAuditWords } from './audit-labels';

/**
 * The workspace audit trail of one module (the groups and the segments screens), newest first. The log is read once per open; the
 * search narrows the rows loaded so far in the browser (the log's own `q` matches only the module and action names). Field names only.
 */
export function ModuleActivityDialog({
  open,
  onClose,
  module,
  title,
}: {
  open: boolean;
  onClose: () => void;
  /** The audit module key the screen writes its rows under (`contact_groups`, `segments`). */
  module: string;
  title: string;
}) {
  const t = useTranslations('audit-log.moduleActivity');
  const words = useAuditWords();
  const locale = useLocale();
  const timeZone = useTimeZone();
  const [query, setQuery] = useState('');
  const entries = useAuditEntries({ module }, 0, open);

  const loaded = entries.data?.pages.flatMap((p) => p.data) ?? [];
  const shown = loaded.filter((e) => matchesActivity(e, query, words.action(e.action)));

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg" closeLabel={t('close')}>
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('window')}</p>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('searchPlaceholder')}
          aria-label={t('search')}
          className="h-9 [&::-webkit-search-cancel-button]:hidden"
        />
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {entries.isSuccess ? t('count', { count: shown.length }) : ''}
        </p>

        {entries.isPending ? (
          <div role="status" className="flex items-center gap-2 py-6 text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : entries.isError ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-danger">
              {t('loadFailed')}
            </p>
            <Button variant="secondary" onClick={() => void entries.refetch()}>
              {t('retry')}
            </Button>
          </div>
        ) : loaded.length === 0 ? (
          <EmptyState title={t('emptyTitle')} message={t('empty')} />
        ) : shown.length === 0 ? (
          <EmptyState title={t('emptyFilteredTitle')} message={t('emptyFiltered')} />
        ) : (
          <div className="max-h-[60vh] overflow-auto rounded-md border border-border">
            <table className="w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="sticky top-0 border-b border-border bg-muted px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('colWhen')}
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 border-b border-border bg-muted px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('colWho')}
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 border-b border-border bg-muted px-3 py-2 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {t('colWhat')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.id} className="align-top">
                    <td className="whitespace-nowrap border-b border-border px-3 py-2 tabular-nums text-muted-foreground">
                      {formatDateTime(e.at, locale, timeZone)}
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      <ActorCell entry={e} compact />
                    </td>
                    <td className="border-b border-border px-3 py-2">
                      <span className="font-medium">{words.action(e.action)}</span>
                      {e.changedFields.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {e.changedFields.join(', ')}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {entries.hasNextPage && (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">{t('loadedOnly')}</p>
            <Button
              variant="secondary"
              disabled={entries.isFetchingNextPage}
              onClick={() => void entries.fetchNextPage()}
            >
              {t('loadMore')}
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
