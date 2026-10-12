'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, Modal, Spinner, cn } from '@crm/ui';
import { MESSAGE_LOG_HOT_DAYS, MESSAGE_LOG_RETENTION_DAYS } from '@crm/contracts';
import type { MessageLogEvent } from '@crm/contracts';
import { FailureNote } from '@/features/channel-whatsapp-cloud';
import { useMessageLog } from '../api/message-log';
import { logEventKey, isIgnored, isProblem } from '../lib/message-log';
import { exactStamp, fullStamp } from '../lib/time';
import { AlertIcon } from './icons';
import { useErrorText } from './parts';

export interface MessageLogDialogProps {
  /** The message whose log is shown; null = closed. */
  messageId: string | null;
  onClose: () => void;
  /** The person may export the log, so the dialog links to the export page. */
  canExport?: boolean;
}

/**
 * The delivery log of one message: its status now, then every step it went through, oldest first, each with the exact time, who wrote
 * it (our pipeline or the provider's own receipt) and, for a failure, the reason in plain words next to the provider's own code. A
 * receipt that did not move the message (late, or for an earlier send) is shown greyed with a note, never left out.
 */
export function MessageLogDialog({ messageId, onClose, canExport = false }: MessageLogDialogProps) {
  const t = useTranslations('team-inbox-conversations.log');
  const status = useTranslations('team-inbox-conversations.status');
  const locale = useLocale();
  const errorText = useErrorText();
  const q = useMessageLog(messageId);
  const log = q.data;

  return (
    <Modal
      open={messageId !== null}
      onClose={onClose}
      title={t('title')}
      size="md"
      closeLabel={t('close')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {canExport ? (
            <Link
              href="/inbox/message-logs"
              className="text-sm text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {t('exportLink')}
            </Link>
          ) : (
            <span />
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
      }
    >
      <div data-testid="message-log" className="space-y-3 text-sm">
        {q.isPending && messageId !== null && (
          <p className="flex items-center gap-2 text-muted-foreground" role="status">
            <Spinner /> {t('loading')}
          </p>
        )}
        {q.isError && (
          <div className="space-y-2">
            <Alert tone="danger">{errorText(q.error)}</Alert>
            <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
              {t('tryAgain')}
            </Button>
          </div>
        )}
        {log && (
          <>
            <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 rounded-md bg-muted/50 p-3 text-xs">
              <dt className="text-muted-foreground">{t('statusNow')}</dt>
              <dd data-testid="message-log-status" className="font-medium">
                {status(log.status)}
              </dd>
              <dt className="text-muted-foreground">{t('createdAt')}</dt>
              <dd>{fullStamp(log.createdAt, locale)}</dd>
              {log.providerMessageId && (
                <>
                  <dt className="text-muted-foreground">{t('providerId')}</dt>
                  <dd className="break-all font-mono">{log.providerMessageId}</dd>
                </>
              )}
            </dl>
            {log.status === 'failed' && (
              <p className="flex items-start gap-1.5 text-xs text-danger">
                <AlertIcon width={14} height={14} className="mt-0.5 shrink-0" />
                <FailureNote
                  failure={{ code: log.failureCode, reason: log.failureReason }}
                  fallback={t('failedNoReason')}
                />
              </p>
            )}
            {log.expired && <Alert>{t('expired', { days: MESSAGE_LOG_RETENTION_DAYS })}</Alert>}
            {!log.expired && log.events.length === 0 && (
              <p className="text-muted-foreground">{t('empty')}</p>
            )}
            {log.events.length > 0 && (
              <ol className="space-y-0">
                {log.events.map((e, i) => (
                  <LogLine key={`${e.at}-${i}`} event={e} last={i === log.events.length - 1} />
                ))}
              </ol>
            )}
            {log.fromArchive && (
              <p className="text-xs text-muted-foreground">
                {t('archived', { days: MESSAGE_LOG_HOT_DAYS })}
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function LogLine({ event: e, last }: { event: MessageLogEvent; last: boolean }) {
  const t = useTranslations('team-inbox-conversations.log');
  const locale = useLocale();
  const key = logEventKey(e);
  const problem = isProblem(e);
  const ignored = isIgnored(e);
  return (
    <li
      data-testid="message-log-event"
      data-event={e.event}
      data-source={e.source}
      className={cn('relative flex gap-3 pb-4', ignored && 'opacity-60')}
    >
      <span className="relative flex w-3 shrink-0 justify-center" aria-hidden>
        <span
          className={cn(
            'z-10 mt-1.5 size-2.5 rounded-full',
            problem ? 'bg-danger' : e.source === 'provider' ? 'bg-primary' : 'bg-muted-foreground',
          )}
        />
        {!last && <span className="absolute inset-y-3 w-px bg-border" />}
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className={cn('font-medium', problem && 'text-danger')}>
          {t(`event.${key}`, { attempt: e.attempt ?? 1 })}
        </p>
        <p className="text-xs text-muted-foreground">
          <time dateTime={e.at}>{exactStamp(e.at, locale)}</time>
          {' · '}
          {t(`source.${e.source}`)}
        </p>
        {e.event === 'failed' && (e.errorCode || e.errorMessage) && (
          <p className="break-words text-xs text-danger">
            {e.errorCode && <span className="font-mono">{e.errorCode}</span>}
            {e.errorCode && e.errorMessage ? ' · ' : ''}
            {e.errorMessage}
          </p>
        )}
        {e.event === 'retry' && e.detail.manual !== true && e.errorMessage && (
          <p className="break-words text-xs text-muted-foreground">{e.errorMessage}</p>
        )}
        {e.providerMessageId && (e.event === 'sent' || e.event === 'failed') && (
          <p className="break-all font-mono text-[11px] text-muted-foreground">
            {e.providerMessageId}
          </p>
        )}
        {ignored && <p className="text-xs italic text-muted-foreground">{t('notApplied')}</p>}
        {e.replayed === true && (
          <p className="text-xs italic text-muted-foreground">{t('replayed')}</p>
        )}
        {e.event === 'retry' && typeof e.detail.previousProviderMessageId === 'string' && (
          <p className="text-xs text-muted-foreground">{t('resent')}</p>
        )}
      </div>
    </li>
  );
}
