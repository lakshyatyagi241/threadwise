'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { HistoryImportStatus } from '@crm/contracts';
import { Badge, Button, ConfirmDialog, Spinner, useToast } from '@crm/ui';
import { useCancelHistoryImport, useHistoryImport } from '../api/history';
import {
  canCancelHistory,
  hasHistoryCounts,
  historyErrorKey,
  historyPercent,
  historyTone,
} from '../lib/history-model';
import { formatWhen } from '../lib/format';
import { ErrorNotice } from './error-notice';
import { useErrorText, type ErrorText } from './use-error-text';

const NS = 'whatsapp-devices-baileys.history';

/**
 * "Imported chats" on the number's page: what the opt-in import did and is doing (counts, progress, window), why it stopped when it did,
 * and a cancel while it can still take batches. Media is never imported and the card says so. The numbers are the run's own counters.
 */
export function HistoryImportCard({
  deviceId,
  canCancel,
  inboxHref = '/inbox',
}: {
  deviceId: string;
  canCancel: boolean;
  inboxHref?: string;
}) {
  const t = useTranslations(`${NS}.card`);
  const te = useTranslations(NS);
  const locale = useLocale();
  const timeZone = useTimeZone();
  const { toast } = useToast();
  const errorText = useErrorText();
  const q = useHistoryImport(deviceId);
  const cancel = useCancelHistoryImport();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<ErrorText | null>(null);

  if (q.isPending) return null;
  if (q.isError || !q.data) return null;
  const s: HistoryImportStatus = q.data.status;
  const when = (iso: string | null) => formatWhen(iso, locale, timeZone);
  const errKey = historyErrorKey(s);
  const percent = historyPercent(s);

  const doCancel = () => {
    setError(null);
    cancel.mutate(deviceId, {
      onSuccess: () => {
        setConfirm(false);
        toast(t('cancelDone'), 'info');
      },
      onError: (e) => {
        setConfirm(false);
        setError(errorText(e));
      },
    });
  };

  return (
    <section
      className="space-y-3 rounded-md border border-border p-4"
      aria-label={t('title')}
      data-testid="history-card"
      data-state={s.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <Badge tone={historyTone(s.state)}>{t(`state.${s.state}`)}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{t(`body.${s.state}`)}</p>

      {(s.state === 'running' || s.state === 'idle') && (
        <div
          role="progressbar"
          aria-label={t('progress', { percent })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      )}
      {s.state === 'running' && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Spinner /> {t('progress', { percent })}
        </p>
      )}

      {hasHistoryCounts(s) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="history-counts">
          <li>{t('chats', { count: s.chats })}</li>
          <li>{t('contacts', { count: s.contacts })}</li>
          <li>{t('messages', { count: s.messages })}</li>
        </ul>
      )}
      {errKey && (
        <p className="text-sm" role="status" data-testid="history-error">
          {te(errKey)}
        </p>
      )}
      {s.state !== 'not_requested' && (
        <>
          {s.windowDays !== null && (
            <p className="text-xs text-muted-foreground">{t('window', { days: s.windowDays })}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('mediaNote')}</p>
          {(s.startedAt || s.finishedAt) && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs text-muted-foreground">
              {s.startedAt && (
                <>
                  <dt>{t('started')}</dt>
                  <dd>{when(s.startedAt)}</dd>
                </>
              )}
              {s.finishedAt && (
                <>
                  <dt>{t('finished')}</dt>
                  <dd>{when(s.finishedAt)}</dd>
                </>
              )}
            </dl>
          )}
        </>
      )}
      {error && <ErrorNotice error={error} />}

      <div className="flex flex-wrap gap-2">
        {canCancel && canCancelHistory(s) && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setConfirm(true)}
            disabled={cancel.isPending}
            data-testid="history-cancel"
          >
            {cancel.isPending ? t('cancelling') : t('cancel')}
          </Button>
        )}
        {hasHistoryCounts(s) && (
          <Link
            href={inboxHref}
            className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium underline"
          >
            {t('openInbox')}
          </Link>
        )}
      </div>

      <ConfirmDialog
        open={confirm}
        title={t('cancelTitle')}
        message={t('cancelMessage')}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={t('cancelKeep')}
        tone="danger"
        onConfirm={doCancel}
        onClose={() => setConfirm(false)}
      />
    </section>
  );
}
