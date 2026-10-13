'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Button, EmptyState } from '@crm/ui';
import { useBatches } from './queries';
import { ErrorBlock, LoadingBlock } from './state';

const NS = 'waboo-migration.batches';

/** Newest bulk batches first with their per-status counts; each opens the batch detail. */
export function BatchesList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations(NS);
  const tm = useTranslations('waboo-migration.mode');
  const tbs = useTranslations('waboo-migration.batchStatus');
  const ts = useTranslations('waboo-migration.status');
  const format = useFormatter();
  const q = useBatches();

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.data.length === 0) return <EmptyState title={t('empty')} message={t('emptyHint')} />;

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {q.data.data.map((b) => (
        <li
          key={b.id}
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 ${b.id === selected ? 'bg-muted' : ''}`}
        >
          <div className="min-w-0 flex-1 basis-48">
            <p className="text-sm font-medium">{t('orgs', { count: b.total })}</p>
            <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
              {Object.entries(b.counts).map(([k, n]) => (
                <span key={k}>
                  {ts(k as 'queued')}: <span className="font-mono">{n}</span>
                </span>
              ))}
            </p>
          </div>
          <Badge>{tm(b.mode)}</Badge>
          <Badge
            tone={
              b.status === 'completed'
                ? 'success'
                : b.status === 'failed'
                  ? 'danger'
                  : b.status === 'running'
                    ? 'warning'
                    : 'neutral'
            }
          >
            {tbs(b.status)}
          </Badge>
          <time className="text-xs text-muted-foreground" dateTime={b.runAt ?? b.createdAt}>
            {format.dateTime(new Date(b.runAt ?? b.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
          <Button variant="secondary" size="sm" onClick={() => onSelect(b.id)}>
            {t('open')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
