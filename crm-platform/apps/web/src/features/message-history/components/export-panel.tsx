'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Spinner, useToast } from '@crm/ui';
import { MESSAGE_LOG_EXPORT_TTL_DAYS, type MessageLogExport } from '@crm/contracts';
import { downloadHistoryExport, useHistoryExports } from '../api/history';
import { formatCount, fullStamp } from '../lib/format';
import { DownloadIcon, useErrorText } from './parts';

/** Saves a blob under a name, the way every other export of the app does. */
function saveBlob(fileName: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * The status of the CSV exports of this screen: the file is built in the background (the filters were fixed when it was asked for),
 * so each export shows Preparing, Ready with a Download, Failed with the reason, or Expired. The list refreshes by itself while one is
 * being prepared. The page that the "ready" email links to is this one.
 */
export function ExportPanel({ highlight, tz }: { highlight: string; tz: string }) {
  const t = useTranslations('message-history.exports');
  const locale = useLocale();
  const errorText = useErrorText();
  const { toast } = useToast();
  const q = useHistoryExports(true);
  const [busy, setBusy] = useState<string | null>(null);
  const items = q.data?.data ?? [];
  if (q.isPending || items.length === 0) return null;

  const download = async (e: MessageLogExport) => {
    setBusy(e.id);
    try {
      const { blob, fileName } = await downloadHistoryExport(e.id);
      saveBlob(fileName, blob);
    } catch (err) {
      toast(errorText(err), 'danger');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      aria-label={t('title')}
      data-testid="history-exports"
      className="rounded-md border border-border bg-background"
    >
      <h2 className="border-b border-border px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
        {t('title')}
      </h2>
      <ul className="divide-y divide-border">
        {items.slice(0, 5).map((e) => (
          <li
            key={e.id}
            data-export={e.id}
            data-status={e.status}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <div className="min-w-0">
              <div className="font-medium">
                {e.from === e.to ? e.from : `${e.from} – ${e.to}`}
                {e.id === highlight && (
                  <span className="ms-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] text-brand">
                    {t('fromEmail')}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {t(`status.${e.status}`)}
                {e.status === 'ready' && e.rowCount !== null && (
                  <> · {t('rows', { n: formatCount(e.rowCount, locale) })}</>
                )}
                {e.status === 'ready' && e.expiresAt && (
                  <>
                    {' '}
                    ·{' '}
                    {t('keptUntil', {
                      when: fullStamp(e.expiresAt, locale, tz),
                      days: MESSAGE_LOG_EXPORT_TTL_DAYS,
                    })}
                  </>
                )}
              </div>
              {e.status === 'failed' && e.error && (
                <div className="text-xs text-danger">{e.error}</div>
              )}
            </div>
            {(e.status === 'queued' || e.status === 'running') && (
              <span className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Spinner /> {t('preparing')}
              </span>
            )}
            {e.status === 'ready' && (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy === e.id}
                onClick={() => void download(e)}
              >
                <DownloadIcon /> {t('download')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
