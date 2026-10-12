'use client';

import { useTranslations } from 'next-intl';
import { MAIL_ATTACHMENTS_MAX_COUNT, MAIL_ATTACHMENT_MAX_BYTES } from '@crm/contracts';
import { cn } from '@crm/ui';
import type { Refusal, StagedFile } from '../lib/staged-attachments';
import { composerErrorKey } from '../lib/composer-errors';

export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The files of the reply being written: one row each with its size, an upload bar, the reason when one failed, Retry and Remove.
 * Files that were refused before an upload (too big, too many, not allowed) are named above the list.
 */
export function AttachmentTray({
  files,
  refusals,
  onRemove,
  onRetry,
  onDismissRefusals,
}: {
  files: readonly StagedFile[];
  refusals: readonly Refusal[];
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
  onDismissRefusals: () => void;
}) {
  const t = useTranslations('email.composer.attach');
  const e = useTranslations('email.composer.error');
  if (files.length === 0 && refusals.length === 0) return null;
  return (
    <div data-testid="email-attach-tray" className="mx-3 mt-2 space-y-1">
      {refusals.length > 0 && (
        <div
          role="alert"
          data-testid="email-attach-refused"
          className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger"
        >
          <ul className="min-w-0 flex-1">
            {refusals.map((r, i) => (
              <li key={`${r.name}-${i}`} className="break-words">
                {t(`refused.${r.reason}`, {
                  name: r.name,
                  max: humanBytes(MAIL_ATTACHMENT_MAX_BYTES),
                  count: MAIL_ATTACHMENTS_MAX_COUNT,
                })}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={onDismissRefusals}
            className="rounded underline focus-visible:ring-2 focus-visible:ring-danger"
          >
            {t('dismiss')}
          </button>
        </div>
      )}
      {files.length > 0 && (
        <ul aria-label={t('list', { count: files.length })} className="space-y-1">
          {files.map((f) => {
            const key = f.error ? composerErrorKey(f.error) : null;
            return (
              <li
                key={f.key}
                data-testid="email-attach-item"
                data-status={f.status}
                className={cn(
                  'flex items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-1.5 text-xs',
                  f.status === 'failed' ? 'border-danger/50' : 'border-border',
                )}
              >
                <span dir="auto" className="min-w-0 flex-1 truncate">
                  {f.name}
                </span>
                <span className="shrink-0 text-muted-foreground">{humanBytes(f.size)}</span>
                {f.status === 'uploading' && (
                  <span
                    role="progressbar"
                    aria-label={t('uploading', { name: f.name })}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={f.progress}
                    className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-border"
                  >
                    <span className="block h-full bg-primary" style={{ width: `${f.progress}%` }} />
                  </span>
                )}
                {f.status === 'ready' && (
                  <span className="shrink-0 text-success">{t('ready')}</span>
                )}
                {f.status === 'failed' && (
                  <>
                    <span role="alert" className="shrink-0 text-danger">
                      {key ? e(key) : t('failed')}
                    </span>
                    {f.file && (
                      <button
                        type="button"
                        data-testid="email-attach-retry"
                        onClick={() => onRetry(f.key)}
                        className="shrink-0 rounded font-medium underline focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        {t('retry')}
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  data-testid="email-attach-remove"
                  aria-label={t('remove', { name: f.name })}
                  title={t('remove', { name: f.name })}
                  onClick={() => onRemove(f.key)}
                  className="shrink-0 rounded px-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
