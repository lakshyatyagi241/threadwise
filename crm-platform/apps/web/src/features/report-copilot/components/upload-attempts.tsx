'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { REPORT_DOCUMENT_LIMITS, type ReportScope } from '@crm/contracts';
import { Alert, Spinner } from '@crm/ui';
import { AI_KEYS_HREF } from '../lib/access';
import type { Attempt } from '../lib/upload-queue';

const SIZE_MB = REPORT_DOCUMENT_LIMITS.fileBytes / (1024 * 1024);

/**
 * The files being added and how each one went: "Uploading x…", "Added x. Ask me about it" (when `showDone`), or the reason it
 * failed, in the library's own words.
 */
export function UploadAttempts({
  attempts,
  scope,
  onDismiss,
  showDone = false,
}: {
  attempts: readonly Attempt[];
  scope: ReportScope;
  onDismiss: (key: string) => void;
  showDone?: boolean;
}) {
  const t = useTranslations('report-copilot.documents');
  const tk = useTranslations('report-copilot.chat.keyRequired');
  const shown = attempts.filter((a) => showDone || a.status !== 'done');
  if (shown.length === 0) return null;

  const failure = (a: Attempt): string => {
    switch (a.error) {
      case 'keyRequired':
        return tk(scope);
      case 'providerUnsupported':
        return tk('providerUnsupported');
      case 'unreadable':
        return a.detail ? `${a.name}: ${a.detail}` : t('error.unreadable', { name: a.name });
      default:
        return t(`error.${a.error ?? 'generic'}`, { name: a.name, size: SIZE_MB });
    }
  };

  return (
    <ul className="space-y-1.5" aria-live="polite" data-testid="upload-attempts">
      {shown.map((a) => (
        <li key={a.key}>
          {a.status === 'busy' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('uploading', { name: a.name })}
            </p>
          ) : a.status === 'done' ? (
            <Alert tone="success" className="flex flex-wrap items-center justify-between gap-2">
              <span>{t('added', { name: a.name })}</span>
              <button type="button" className="underline" onClick={() => onDismiss(a.key)}>
                {t('dismiss')}
              </button>
            </Alert>
          ) : (
            <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-2">
              <span>{failure(a)}</span>
              <span className="flex items-center gap-2">
                {(a.error === 'keyRequired' || a.error === 'providerUnsupported') && (
                  <Link href={AI_KEYS_HREF[scope]} className="underline">
                    {tk('link')}
                  </Link>
                )}
                <button type="button" className="underline" onClick={() => onDismiss(a.key)}>
                  {t('dismiss')}
                </button>
              </span>
            </Alert>
          )}
        </li>
      ))}
    </ul>
  );
}
