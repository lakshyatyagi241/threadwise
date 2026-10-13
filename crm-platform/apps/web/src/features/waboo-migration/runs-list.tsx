'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { Badge, Button, EmptyState } from '@crm/ui';
import { useRuns } from './queries';
import { StatusBadge, VerdictBadge } from './run-parts';
import { ErrorBlock, LoadingBlock } from './state';

const NS = 'waboo-migration.runs';

/** Newest runs first; each row opens the run detail. Stacks on a phone. */
export function RunsList({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations(NS);
  const tm = useTranslations('waboo-migration.mode');
  const format = useFormatter();
  const q = useRuns();

  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  if (q.data.data.length === 0) return <EmptyState title={t('empty')} message={t('emptyHint')} />;

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {q.data.data.map((r) => (
        <li
          key={r.id}
          className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-3 ${r.id === selected ? 'bg-muted' : ''}`}
        >
          <div className="min-w-0 flex-1 basis-48">
            <p className="truncate font-mono text-sm font-medium">{r.organizationId}</p>
            <p className="truncate font-mono text-xs text-muted-foreground">{r.sourceClient}</p>
          </div>
          <Badge>{tm(r.mode)}</Badge>
          <StatusBadge run={r} />
          <VerdictBadge verdict={r.verdict} />
          <time className="text-xs text-muted-foreground" dateTime={r.runAt ?? r.createdAt}>
            {format.dateTime(new Date(r.runAt ?? r.createdAt), {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </time>
          <Button variant="secondary" size="sm" onClick={() => onSelect(r.id)}>
            {t('open')}
          </Button>
        </li>
      ))}
    </ul>
  );
}
