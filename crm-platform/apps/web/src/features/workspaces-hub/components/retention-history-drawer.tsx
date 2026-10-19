'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import type { OrgLifecycleLogEntry, OrgLifecycleResponse } from '@crm/contracts';
import { Drawer, EmptyState } from '@crm/ui';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { fetchLifecycleLog, lifecycleKeys } from '../api';

/** The reason an operator gave, when the log entry carries one (details is free-form; only a string is shown). */
export const detailReason = (e: Pick<OrgLifecycleLogEntry, 'details'>): string | null =>
  typeof e.details.reason === 'string' && e.details.reason.trim() ? e.details.reason : null;

/** The compliance history of one workspace, newest first: event, stage and reminder number, who, when, and the reason. */
export function RetentionHistoryDrawer({
  row,
  onClose,
}: {
  row: Pick<OrgLifecycleResponse, 'id' | 'name'> | null;
  onClose: () => void;
}) {
  const t = useTranslations('workspaces-hub.retention.history');
  const tc = useTranslations('workspaces-hub.common');
  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={t('title', { name: row?.name ?? '' })}
      closeLabel={tc('close')}
    >
      {row && <HistoryBody id={row.id} />}
    </Drawer>
  );
}

function HistoryBody({ id }: { id: string }) {
  const t = useTranslations('workspaces-hub.retention.history');
  const te = useTranslations('workspaces-hub.retention.event');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const q = useQuery({
    queryKey: lifecycleKeys.log(id),
    queryFn: ({ signal }) => fetchLifecycleLog(id, signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.length === 0)
    return <EmptyState title={t('emptyTitle')} message={t('emptyMessage')} />;
  const when = new Intl.DateTimeFormat(locale, {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <ol className="space-y-3" data-testid="retention-log">
      {q.data.map((e, i) => {
        const reason = detailReason(e);
        return (
          <li key={`${e.createdAt}-${i}`} className="rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">
                {te.has(e.eventType) ? te(e.eventType) : e.eventType}
              </span>
              <time dateTime={e.createdAt} className="text-xs text-muted-foreground">
                {when.format(new Date(e.createdAt))}
              </time>
            </div>
            <dl className="mt-1 space-y-0.5 text-xs text-muted-foreground">
              {e.stage && (
                <div>
                  {t('stage')}: {t(`stages.${e.stage}`)}
                  {e.reminderNo !== null && ` · ${t('reminderNo', { n: e.reminderNo })}`}
                </div>
              )}
              {e.daysInactive !== null && <div>{t('daysInactive', { count: e.daysInactive })}</div>}
              <div>
                {t('by')}: {e.actorRef ?? t('system')} ({e.actorType})
              </div>
              {reason && (
                <div className="text-foreground">
                  {t('reason')}: {reason}
                </div>
              )}
            </dl>
          </li>
        );
      })}
    </ol>
  );
}
