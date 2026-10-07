'use client';

import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import {
  ERROR_CODES,
  WIZARD_CSV_MAX_BYTES,
  WIZARD_CSV_MAX_ROWS,
  WIZARD_CSV_TEMPLATE_HEADERS,
  WIZARD_CSV_TTL_DAYS,
  type WizardCsvRef,
  type WizardCsvReport,
} from '@crm/contracts';
import { Alert, Button, Spinner, cn } from '@crm/ui';
import { downloadBlob, downloadCsv } from '@/features/contacts-attributes-tags/lib/download';
import { ApiError } from '@/lib/api/errors';
import { downloadCsvErrors, uploadCsv, useCsvReport } from '../api/wizard';
import { csvTemplateText } from '../lib/audience';
import { Chip, ErrorBlock } from './parts';

const nf = (n: number) => n.toLocaleString();
const MB = Math.round(WIZARD_CSV_MAX_BYTES / (1024 * 1024));

export const refOf = (r: WizardCsvReport): WizardCsvRef => ({
  id: r.id,
  fileName: r.fileName,
  valid: r.valid,
  duplicate: r.duplicate,
  invalid: r.invalid,
  optedOut: r.optedOut,
});

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'danger' | 'warning' | 'brand';
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-background px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-xl font-semibold tabular-nums',
          tone === 'danger' && value > 0 && 'text-danger',
          tone === 'warning' && value > 0 && 'text-warning',
          tone === 'brand' && 'text-brand',
        )}
      >
        {nf(value)}
      </div>
    </div>
  );
}

/**
 * "Broadcast via CSV": a drop zone (or a file chooser) for a file of numbers. The server parses and validates it (E.164, repeated
 * numbers, invalid rows with their line, opted-out contacts) and answers with a report that is shown as it is: the counts, the first
 * rows and the first problems, with the whole error list as a download. The valid numbers are the audience of this mode.
 */
export function CsvUpload({
  csv,
  onCsv,
  disabled,
}: {
  csv: WizardCsvRef | null;
  onCsv: (csv: WizardCsvRef | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('campaigns.wizard.audience');
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [fresh, setFresh] = useState<WizardCsvReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problem, setProblem] = useState<{
    kind: 'size' | 'type' | 'server';
    detail?: string;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const stored = useCsvReport(csv && fresh?.id !== csv.id ? csv.id : null);
  const report = csv ? (fresh?.id === csv.id ? fresh : (stored.data ?? null)) : null;

  const choose = async (file: File | undefined) => {
    setProblem(null);
    if (!file) return;
    if (file.size > WIZARD_CSV_MAX_BYTES) return setProblem({ kind: 'size' });
    if (!/\.(csv|txt)$/i.test(file.name)) return setProblem({ kind: 'type' });
    setBusy(true);
    try {
      const out = await uploadCsv(file);
      setFresh(out);
      onCsv(refOf(out));
    } catch (e) {
      setProblem({
        kind: 'server',
        detail:
          e instanceof ApiError &&
          (e.code === ERROR_CODES.CON_IMPORT_FILE_INVALID ||
            e.code === ERROR_CODES.CON_IMPORT_TOO_LARGE)
            ? e.message
            : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!disabled && !busy) void choose(e.dataTransfer.files[0]);
  };

  const errors = async () => {
    if (!csv) return;
    setDownloading(true);
    try {
      downloadBlob('broadcast-numbers-errors.csv', await downloadCsvErrors(csv.id));
    } catch {
      setProblem({ kind: 'server' });
    } finally {
      setDownloading(false);
    }
  };

  const template = (
    <button
      type="button"
      onClick={() => downloadCsv('broadcast-numbers-template.csv', csvTemplateText())}
      className="font-semibold text-brand underline-offset-2 hover:underline"
    >
      {t('csvTemplate')}
    </button>
  );

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" data-testid="csv-mode">
      {!report || problem ? (
        <div className="space-y-3">
          <label
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            htmlFor={`${uid}-file`}
            className={cn(
              'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-8 text-center transition',
              'focus-within:ring-2 focus-within:ring-primary hover:bg-muted/50',
              dragging && 'border-brand bg-brand/5',
              (disabled || busy) && 'cursor-not-allowed opacity-60',
            )}
          >
            <span className="text-sm font-semibold">
              {busy ? (
                <span className="inline-flex items-center gap-2">
                  <Spinner /> {t('csvChecking')}
                </span>
              ) : (
                t('csvDrop')
              )}
            </span>
            <span className="rounded-full border border-brand px-3 py-1 text-xs font-semibold text-brand">
              {t('csvChoose')}
            </span>
            <input
              id={`${uid}-file`}
              ref={input}
              type="file"
              accept=".csv,.txt,text/csv"
              className="sr-only"
              disabled={disabled || busy}
              onChange={(e) => {
                void choose(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {t('csvLimits', { mb: MB, rows: nf(WIZARD_CSV_MAX_ROWS), days: WIZARD_CSV_TTL_DAYS })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('csvFormat', { columns: WIZARD_CSV_TEMPLATE_HEADERS.join(', ') })} {template}
          </p>
          {problem && (
            <Alert tone="danger" data-testid="csv-problem">
              {problem.kind === 'size'
                ? t('csvTooBig', { mb: MB })
                : problem.kind === 'type'
                  ? t('csvWrongType')
                  : t('csvRefused')}
              {problem.detail && <span className="mt-1 block text-xs">{problem.detail}</span>}
            </Alert>
          )}
        </div>
      ) : null}

      {csv && !report && stored.isError && (
        <ErrorBlock error={stored.error} onRetry={() => void stored.refetch()} />
      )}
      {csv && !report && stored.isPending && (
        <div role="status" className="text-sm text-muted-foreground">
          {t('csvLoading')}
        </div>
      )}

      {csv && report && !problem && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold" dir="auto">
                {report.fileName}
              </div>
              <div className="text-xs text-muted-foreground">
                {t('csvRows', { count: report.totalRows })}{' '}
                {t('csvKept', { days: WIZARD_CSV_TTL_DAYS })}
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => input.current?.click()}
                disabled={disabled || busy}
              >
                {t('csvReplace')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setFresh(null);
                  onCsv(null);
                }}
                disabled={disabled}
              >
                {t('csvRemove')}
              </Button>
              <input
                ref={input}
                type="file"
                accept=".csv,.txt,text/csv"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(e) => {
                  void choose(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>

          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5"
            data-testid="csv-counts"
          >
            <Tile label={t('csvValid')} value={report.valid} tone="brand" />
            <Tile label={t('csvDuplicate')} value={report.duplicate} tone="warning" />
            <Tile label={t('csvInvalid')} value={report.invalid} tone="danger" />
            <Tile label={t('csvOptedOut')} value={report.optedOut} tone="warning" />
            <Tile label={t('csvNew')} value={report.newContacts} />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('csvNote', { existing: report.existing, fresh: report.newContacts })}
          </p>

          <div className="overflow-hidden rounded-lg border border-border">
            <div className="bg-muted px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('csvPreview', { count: report.preview.length })}
            </div>
            <table className="w-full text-sm">
              <caption className="sr-only">{t('csvPreviewCaption')}</caption>
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">
                    {t('csvLine')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">
                    {t('colMobile')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">
                    {t('csvName')}
                  </th>
                  <th scope="col" className="px-3 py-1.5 text-start font-medium">
                    {t('csvStatus')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.preview.map((r) => (
                  <tr key={r.line}>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{r.line}</td>
                    <td className="px-3 py-1.5">
                      <span dir="ltr">{r.phone}</span>
                    </td>
                    <td className="max-w-[14rem] truncate px-3 py-1.5">{r.name ?? '-'}</td>
                    <td className="px-3 py-1.5">
                      <Chip
                        tone={
                          r.status === 'optedOut'
                            ? 'warning'
                            : r.status === 'new'
                              ? 'brand'
                              : 'neutral'
                        }
                      >
                        {t(`csvRow.${r.status}`)}
                      </Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.issuesTotal > 0 && (
            <div
              className="overflow-hidden rounded-lg border border-danger/30"
              data-testid="csv-issues"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 bg-danger/5 px-3 py-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-danger">
                  {t('csvIssues', { count: report.issuesTotal })}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void errors()}
                  disabled={downloading}
                >
                  {t('csvDownloadErrors')}
                </Button>
              </div>
              <ul className="max-h-40 divide-y divide-border overflow-y-auto text-sm">
                {report.issues.map((i) => (
                  <li key={i.line} className="flex gap-3 px-3 py-1.5">
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">
                      {t('csvLineN', { line: i.line })}
                    </span>
                    <span className="min-w-0 flex-1 truncate" dir="auto">
                      {i.value || '-'}
                    </span>
                    <span className="shrink-0 text-muted-foreground">
                      {t(`csvReason.${i.reason}`)}
                    </span>
                  </li>
                ))}
              </ul>
              {report.issuesTotal > report.issues.length && (
                <p className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                  {t('csvIssuesMore', { count: report.issuesTotal - report.issues.length })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
