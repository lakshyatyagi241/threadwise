'use client';

import { useTranslations } from 'next-intl';
import type { ApiLibraryLogItem } from '@crm/contracts';
import { Badge, cn } from '@crm/ui';
import { formatDuration } from '../lib/format';
import { MethodBadge, ResultChip, SkeletonRows, StatusCodeBadge, useFormatDate } from './parts';

const TH =
  'px-4 py-2.5 text-start text-xs font-medium uppercase tracking-wide text-muted-foreground';
const TD = 'border-b border-border px-4 py-3';

/** The runs of one API or of all of them. A row opens its detail; the API column is for the page that mixes several APIs. */
export function LogsTable({
  rows,
  loading,
  showApi,
  onOpen,
}: {
  rows: ApiLibraryLogItem[];
  loading?: boolean;
  showApi: boolean;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations('api-library.logs');
  const tc = useTranslations('api-library.common');
  const fmt = useFormatDate();
  const cols = showApi ? 7 : 6;
  return (
    <div className="thin-scrollbar overflow-x-auto">
      <table className="w-full min-w-[52rem] border-separate border-spacing-0 text-sm">
        <caption className="sr-only">{t('caption')}</caption>
        <thead className="bg-muted/40">
          <tr>
            {[
              'requestedOn',
              ...(showApi ? ['api'] : []),
              'url',
              'source',
              'result',
              'statusCode',
              'duration',
            ].map((c) => (
              <th key={c} scope="col" className={cn(TH, 'border-b border-border')}>
                {t(`col.${c}`)}
              </th>
            ))}
          </tr>
        </thead>
        {loading ? (
          <SkeletonRows rows={8} cols={cols} />
        ) : (
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-muted/40 focus-within:bg-muted/40">
                <td className={cn(TD, 'whitespace-nowrap')}>
                  <button
                    type="button"
                    onClick={() => onOpen(r.id)}
                    className="rounded text-start font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={t('openLog', { when: fmt(r.createdAt) })}
                  >
                    {fmt(r.createdAt)}
                  </button>
                </td>
                {showApi && <td className={cn(TD, 'font-medium')}>{r.apiName}</td>}
                <td className={cn(TD, 'max-w-0 w-full')}>
                  <span className="flex min-w-0 items-center gap-2">
                    <MethodBadge method={r.method} />
                    <span
                      className="min-w-0 truncate font-mono text-xs text-muted-foreground"
                      dir="ltr"
                      title={r.url}
                    >
                      {r.url}
                    </span>
                  </span>
                  {r.error && <p className="mt-1 truncate text-xs text-danger">{r.error}</p>}
                </td>
                <td className={TD}>
                  <Badge>{tc(`source.${r.source}`)}</Badge>
                </td>
                <td className={TD}>
                  <ResultChip ok={r.ok} />
                </td>
                <td className={TD}>
                  <StatusCodeBadge code={r.statusCode} />
                </td>
                <td className={cn(TD, 'whitespace-nowrap tabular-nums text-muted-foreground')}>
                  {formatDuration(r.durationMs)}
                </td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
