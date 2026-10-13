'use client';

import { useState } from 'react';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { Button, Spinner, cn, useToast } from '@crm/ui';
import type { ContactImportJob } from '@crm/contracts';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { downloadRejects, downloadSavedExport } from '../api/import-export';
import { useExportHistory, useImportJobs } from '../api/history';
import { downloadBlob } from '../lib/download';
import { formatDateTime } from '../lib/format';
import { ErrorLine } from './error-line';
import { ImportModal } from './import-modal';

const TH =
  'px-3 py-2.5 text-start font-mono text-[10px] font-normal uppercase tracking-[0.14em] text-muted-foreground';
const TD = 'px-3 py-2.5 align-middle';

/** `/import-export` (Settings > Data and security): what was imported and exported, by whom and when. */
export function ImportExportScreen() {
  const t = useTranslations('contacts-attributes-tags.history');
  const canImport = useCan('record.contacts.import');
  const canExport = useCan('record.contacts.export');
  const [importOpen, setImportOpen] = useState(false);
  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        {canImport && <Button onClick={() => setImportOpen(true)}>{t('newImport')}</Button>}
      </header>
      {canImport && <Imports />}
      {canExport && <Exports />}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </section>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-background">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-4 py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

function Imports() {
  const t = useTranslations('contacts-attributes-tags.history');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const { toast } = useToast();
  const q = useImportJobs(true);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data?.data ?? [];

  async function rejects(job: ContactImportJob) {
    setBusy(job.id);
    try {
      downloadBlob('contacts-import-rejects.csv', await downloadRejects(job.id));
    } catch {
      toast(t('rejectsFailed'), 'danger');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={t('imports.title')} hint={t('imports.hint')}>
      {q.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : q.isError ? (
        <div className="p-4">
          <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <Empty text={t('imports.empty')} />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className={TH}>{t('imports.file')}</th>
              <th className={TH}>{t('when')}</th>
              <th className={TH}>{t('imports.status')}</th>
              <th className={cn(TH, 'text-end')}>{t('imports.created')}</th>
              <th className={cn(TH, 'text-end')}>{t('imports.updated')}</th>
              <th className={cn(TH, 'text-end')}>{t('imports.rejected')}</th>
              <th className={TH}>
                <span className="sr-only">{t('imports.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((j) => {
              const rejected = j.invalid + j.duplicatesInFile + j.limitExceeded;
              return (
                <tr key={j.id}>
                  <td className={cn(TD, 'max-w-[16rem] truncate font-medium')} title={j.fileName}>
                    {j.fileName}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                    {formatDateTime(j.createdAt, locale, timeZone)}
                  </td>
                  <td className={TD}>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-xs',
                        j.status === 'completed' && 'bg-success/10 text-success',
                        j.status === 'failed' && 'bg-danger/10 text-danger',
                        (j.status === 'queued' || j.status === 'running') &&
                          'bg-muted text-muted-foreground',
                      )}
                      title={j.error ?? undefined}
                    >
                      {t(`imports.statuses.${j.status}`)}
                    </span>
                  </td>
                  <td className={cn(TD, 'text-end tabular-nums')}>{j.created}</td>
                  <td className={cn(TD, 'text-end tabular-nums')}>{j.updated}</td>
                  <td className={cn(TD, 'text-end tabular-nums')}>{rejected}</td>
                  <td className={cn(TD, 'text-end')}>
                    {j.invalid > 0 && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy === j.id}
                        onClick={() => void rejects(j)}
                      >
                        {busy === j.id && <Spinner />}
                        {t('imports.downloadRejects')}
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function Exports() {
  const t = useTranslations('contacts-attributes-tags.history');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const q = useExportHistory(true);
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const rows = q.data?.data ?? [];

  async function download(fileId: string) {
    setBusy(fileId);
    try {
      downloadBlob('contacts-export.csv', await downloadSavedExport(fileId));
    } catch {
      toast(t('exports.downloadFailed'), 'danger');
      void q.refetch();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Panel title={t('exports.title')} hint={t('exports.hint')}>
      {q.isPending ? (
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      ) : q.isError ? (
        <div className="p-4">
          <ErrorLine error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <Empty text={t('exports.empty')} />
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className={TH}>{t('when')}</th>
              <th className={TH}>{t('exports.by')}</th>
              <th className={cn(TH, 'text-end')}>{t('exports.rows')}</th>
              <th className={TH}>{t('exports.selection')}</th>
              <th className={cn(TH, 'text-end')}>{t('imports.actions')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((e) => (
              <tr key={e.fileId ?? `${e.at}:${e.by ?? ''}:${e.rows}:${e.selection}`}>
                <td className={cn(TD, 'whitespace-nowrap tabular-nums')}>
                  {formatDateTime(e.at, locale, timeZone)}
                </td>
                <td className={TD}>{e.by ?? t('exports.unknown')}</td>
                <td className={cn(TD, 'text-end tabular-nums')}>{e.rows}</td>
                <td className={TD}>{t(`exports.selections.${e.selection}`)}</td>
                <td className={cn(TD, 'text-end')}>
                  {e.fileId ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy === e.fileId}
                      onClick={() => void download(e.fileId!)}
                      title={
                        e.expiresAt
                          ? t('exports.keptUntil', {
                              date: formatDateTime(e.expiresAt, locale, timeZone),
                            })
                          : undefined
                      }
                    >
                      {busy === e.fileId && <Spinner />}
                      {t('exports.download')}
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">{t('exports.noFile')}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
