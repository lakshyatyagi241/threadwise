'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  AUDIT_LOG_EXPORT_TTL_DAYS,
  type AuditLogExport,
  type AuditLogExportStatus,
  type AuditLogFilters,
} from '@crm/contracts';
import { Alert, Badge, Button, Spinner } from '@crm/ui';
import { useAuditExports, useRequestExport } from '../api/hooks';
import { auditLogExportFileUrl } from '../api/service';
import { errorKey } from '../lib/errors';

const TONE: Record<AuditLogExportStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  queued: 'neutral',
  running: 'warning',
  ready: 'success',
  failed: 'danger',
  expired: 'neutral',
};

/**
 * "Export CSV": prepares the filtered window in the background (the worker builds it, an email says when it is ready), then lists the
 * prepared files with their status and a download link. Only for people with `audit.log.export` (the parent decides).
 */
export function AuditExports({ filters }: { filters: AuditLogFilters }) {
  const t = useTranslations('audit-log');
  const locale = useLocale();
  const list = useAuditExports(true);
  const request = useRequestExport();
  const [requested, setRequested] = useState(false);

  const exports = list.data?.data ?? [];
  const busy = exports.some((e) => e.status === 'queued' || e.status === 'running');
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  return (
    <section
      className="space-y-3 rounded-md border border-border p-4"
      aria-labelledby="audit-exports-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="audit-exports-title" className="text-base font-semibold">
            {t('export.title')}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t('export.note', { days: AUDIT_LOG_EXPORT_TTL_DAYS })}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={request.isPending || busy}
          onClick={() => {
            setRequested(false);
            request.mutate(filters, { onSuccess: () => setRequested(true) });
          }}
        >
          {(request.isPending || busy) && <Spinner />}
          {busy ? t('export.preparing') : t('export.button')}
        </Button>
      </div>

      {requested && !request.isError && (
        <Alert tone="success">{t('export.requested')}</Alert>
      )}
      {request.isError && <Alert tone="danger">{t(`errors.${errorKey(request.error)}`)}</Alert>}

      {list.isError ? (
        <Alert tone="danger">{t(`errors.${errorKey(list.error)}`)}</Alert>
      ) : exports.length === 0 ? (
        !list.isPending && <p className="text-sm text-muted-foreground">{t('export.none')}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="audit-exports">
          {exports.map((e) => (
            <ExportRow key={e.id} e={e} when={when} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExportRow({ e, when }: { e: AuditLogExport; when: (iso: string | null) => string }) {
  const t = useTranslations('audit-log');
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={TONE[e.status]}>{t(`export.status.${e.status}`)}</Badge>
          <span className="text-muted-foreground">{when(e.requestedAt)}</span>
        </div>
        {e.status === 'ready' && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('export.rows', { count: e.rowCount ?? 0 })}
            {e.expiresAt ? ` - ${t('export.expires', { date: when(e.expiresAt) })}` : ''}
          </p>
        )}
        {e.status === 'failed' && (
          <p className="mt-0.5 text-xs text-danger">{t('export.failed')}</p>
        )}
      </div>
      {e.status === 'ready' && (
        <a
          href={auditLogExportFileUrl(e.id)}
          download
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t('export.download')}
        </a>
      )}
    </li>
  );
}
