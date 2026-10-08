'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState, type DragEvent } from 'react';
import {
  REPORT_DOCUMENT_EXTENSIONS,
  REPORT_DOCUMENT_LIMITS,
  type ReportDocument,
  type ReportScope,
} from '@crm/contracts';
import { Alert, Badge, Button, ConfirmDialog, EmptyState, Spinner } from '@crm/ui';
import { useDeleteReportDocument, useReportDocuments } from '../api/hooks';
import { libraryErrorKind } from '../lib/errors';
import type { useDocumentUploader } from './use-document-uploader';
import { UploadAttempts } from './upload-attempts';

const MB = 1024 * 1024;
const SIZE_MB = REPORT_DOCUMENT_LIMITS.fileBytes / MB;
const ACCEPT = REPORT_DOCUMENT_EXTENSIONS.map((e) => `.${e}`).join(',');

function sizeText(bytes: number, locale: string): string {
  return bytes >= MB
    ? `${(bytes / MB).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
    : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString(locale)} KB`;
}

/**
 * The document library: drop or choose files, see what the assistant can read, delete what it should forget. Files are read by the
 * server on upload; a file it cannot read is kept as `failed` with the reason, so the list says why instead of hiding it.
 */
export function DocumentsLibrary({
  scope,
  canManage,
  uploader,
}: {
  scope: ReportScope;
  canManage: boolean;
  /** Shared with the chat's "+" menu, so a file added from either shows its progress in both. */
  uploader: ReturnType<typeof useDocumentUploader>;
}) {
  const t = useTranslations('report-copilot.documents');
  const locale = useLocale();
  const list = useReportDocuments(scope);
  const remove = useDeleteReportDocument(scope);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [doomed, setDoomed] = useState<ReportDocument | null>(null);

  const docs = list.data?.data ?? [];
  const max = list.data?.limit ?? REPORT_DOCUMENT_LIMITS.maxDocuments;
  const full = docs.length >= max;

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (full) return;
    void uploader.add([...e.dataTransfer.files]);
  };

  return (
    <section aria-label={t('title')} className="space-y-3" data-testid="report-documents">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t('title')}</h3>
        <p className="text-xs text-muted-foreground">{t('intro')}</p>
        <p className="text-xs text-muted-foreground">
          {t('accepted', {
            extensions: REPORT_DOCUMENT_EXTENSIONS.join(', '),
            size: SIZE_MB,
            max: REPORT_DOCUMENT_LIMITS.maxDocuments,
          })}
        </p>
      </div>

      {canManage ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-5 text-center ${over ? 'border-primary bg-primary/5' : 'border-border'}`}
        >
          <p className="text-sm text-muted-foreground">{t('drop')}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={full}
            onClick={() => input.current?.click()}
          >
            {t('choose')}
          </Button>
          <input
            ref={input}
            type="file"
            multiple
            accept={ACCEPT}
            className="sr-only"
            aria-label={t('choose')}
            data-testid="report-file-input"
            onChange={(e) => {
              void uploader.add([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
          {full && <p className="text-xs text-warning">{t('full', { max })}</p>}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('readOnly')}</p>
      )}

      <UploadAttempts attempts={uploader.attempts} scope={scope} onDismiss={uploader.dismiss} />

      {list.isPending ? (
        <div className="flex justify-center py-4">
          <Spinner label={t('title')} />
        </div>
      ) : list.isError ? (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
          <span>{t('loadError')}</span>
          <Button variant="secondary" size="sm" onClick={() => void list.refetch()}>
            {t('retry')}
          </Button>
        </Alert>
      ) : docs.length === 0 ? (
        <EmptyState title={t('empty.title')} message={t('empty.message')} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('count', { count: docs.length, max })}</p>
          <ul className="divide-y divide-border rounded-md border border-border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 space-y-0.5">
                  <p className="truncate text-sm font-medium" title={d.name}>
                    {d.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {d.extension.toUpperCase()} · {sizeText(d.sizeBytes, locale)}
                    {d.status === 'ready' && ` · ${t('chars', { n: d.charCount })}`}
                  </p>
                  {d.status === 'failed' && d.failureReason && (
                    <p className="text-xs text-danger">{d.failureReason}</p>
                  )}
                  {d.truncated && (
                    <p className="text-xs text-warning">
                      {t('truncated', {
                        chars: REPORT_DOCUMENT_LIMITS.maxChars.toLocaleString(locale),
                      })}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={d.status === 'ready' ? 'success' : 'danger'}>
                    {t(`status.${d.status}`)}
                  </Badge>
                  {canManage && (
                    <button
                      type="button"
                      aria-label={t('delete', { name: d.name })}
                      onClick={() => setDoomed(d)}
                      className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        className="size-4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                      </svg>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <ConfirmDialog
        open={doomed !== null}
        tone="danger"
        busy={remove.isPending}
        title={t('deleteConfirm.title')}
        message={t('deleteConfirm.message', { name: doomed?.name ?? '' })}
        confirmLabel={t('deleteConfirm.confirm')}
        cancelLabel={t('deleteConfirm.cancel')}
        onClose={() => setDoomed(null)}
        onConfirm={() => {
          if (!doomed) return;
          remove.mutate(doomed.id, {
            onSettled: () => setDoomed(null),
          });
        }}
      />
      {remove.isError && (
        <Alert tone="danger">
          {libraryErrorKind(remove.error) === 'forbidden'
            ? t('error.forbidden')
            : t('deleteFailed')}
        </Alert>
      )}
    </section>
  );
}
