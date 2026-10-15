'use client';

import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  REVENUE_EXPORT_TTL_DAYS,
  type RequestRevenueExport,
  type RevenueExport,
  type RevenueExportStatus,
} from '@crm/contracts';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { revenueExportFileUrl } from '../api/service';
import { useRequestRevenueExport, useRevenueExports } from '../api/hooks';
import { errorKey } from '../lib/errors';

const TONE: Record<RevenueExportStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  queued: 'neutral',
  running: 'warning',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

const KINDS = [
  {
    id: 'csv-payments',
    body: { format: 'csv', csvKind: 'payments' },
    label: 'csvPayments',
    hint: 'csvPaymentsHint',
  },
  {
    id: 'csv-summary',
    body: { format: 'csv', csvKind: 'summary' },
    label: 'csvSummary',
    hint: 'csvSummaryHint',
  },
  { id: 'pdf', body: { format: 'pdf', csvKind: 'payments' }, label: 'pdf', hint: 'pdfHint' },
] as const satisfies ReadonlyArray<{
  id: string;
  body: Pick<RequestRevenueExport, 'format' | 'csvKind'>;
  label: string;
  hint: string;
}>;

const kindOf = (e: RevenueExport): 'pdf' | 'csv-payments' | 'csv-summary' =>
  e.format === 'pdf' ? 'pdf' : e.csvKind === 'summary' ? 'csv-summary' : 'csv-payments';

/**
 * "Download this report": prepares a CSV (the payments, or the table on screen) or a PDF with the filters above. The worker builds
 * it and an email says when it is ready; the person's recent files are listed here with their status and a download link. Only for
 * people with `record.payments.export` (the parent decides).
 */
export function RevenueExports({
  body,
}: {
  /** Builds the request for one of the files from the filters on screen. */
  body: (file: Pick<RequestRevenueExport, 'format' | 'csvKind'>) => RequestRevenueExport;
}) {
  const t = useTranslations('crm-revenue.export');
  const te = useTranslations('crm-revenue.errors');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const list = useRevenueExports(true);
  const request = useRequestRevenueExport();
  const [requested, setRequested] = useState(false);

  const exports = list.data?.data ?? [];
  const busy = exports.some((e) => e.status === 'queued' || e.status === 'running');
  const when = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone })
      : '';

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-background p-4"
      aria-labelledby="revenue-exports-title"
    >
      <div>
        <h2 id="revenue-exports-title" className="text-sm font-semibold">
          {t('title')}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t('note', { days: REVENUE_EXPORT_TTL_DAYS })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <Button
            key={k.id}
            variant="secondary"
            disabled={request.isPending || busy}
            title={t(k.hint)}
            data-testid={`export-${k.id}`}
            onClick={() => {
              setRequested(false);
              request.mutate(body(k.body), { onSuccess: () => setRequested(true) });
            }}
          >
            {(request.isPending || busy) && <Spinner />}
            {t(k.label)}
          </Button>
        ))}
      </div>
      {busy && <p className="text-xs text-muted-foreground">{t('preparing')}</p>}
      {requested && !request.isError && <Alert tone="success">{t('requested')}</Alert>}
      {request.isError && <Alert tone="danger">{te(errorKey(request.error))}</Alert>}

      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('recent')}</h3>
        {list.isError ? (
          <Alert tone="danger">{te(errorKey(list.error))}</Alert>
        ) : exports.length === 0 ? (
          !list.isPending && <p className="mt-1 text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="revenue-exports">
            {exports.map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[e.status]}>{t(`status.${e.status}`)}</Badge>
                    <span className="font-medium">{t(`kind.${kindOf(e)}`)}</span>
                    <span className="text-muted-foreground">
                      {t('range', { from: e.filters.fromDate, to: e.filters.toDate })}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {when(e.requestedAt)}
                    {e.status === 'ready' && e.rowCount !== null
                      ? ` - ${t('rows', { count: e.rowCount })}`
                      : ''}
                    {e.status === 'ready' && e.expiresAt
                      ? ` - ${t('expires', { date: when(e.expiresAt) })}`
                      : ''}
                  </p>
                  {e.status === 'failed' && (
                    <p className="mt-0.5 text-xs text-danger">{t('failed')}</p>
                  )}
                </div>
                {e.status === 'ready' && (
                  <a
                    href={revenueExportFileUrl(e.id)}
                    download
                    className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {t('download')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
