'use client';

import Link from 'next/link';
import { useLocale, useTimeZone, useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Alert, Button, Field, Input, Select, Spinner, cn, useToast } from '@crm/ui';
import {
  MESSAGE_LOG_HOT_DAYS,
  MESSAGE_LOG_RETENTION_DAYS,
  type MessageLogExport,
  type MessageStatus,
} from '@crm/contracts';
import { downloadMessageLogExport } from '../api/service';
import { useLogExports, useRequestLogExport } from '../api/message-log';
import {
  EXPORT_STATUSES,
  defaultExportRange,
  exportRangeProblem,
  oldestExportDay,
} from '../lib/message-log';
import { fullStamp } from '../lib/time';
import { BackIcon } from './icons';
import { useErrorText } from './parts';

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
 * "Message logs": ask for the delivery log of a date range (up to a year back) as a CSV. The file is built in the background and the
 * requester gets an email when it is ready; this page lists the exports and offers the download while the file is kept.
 */
export function MessageLogsScreen() {
  const t = useTranslations('team-inbox-conversations.logs');
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Link
          href="/inbox"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
          <BackIcon width={14} height={14} />
          {t('back')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">
          {t('intro', { hot: MESSAGE_LOG_HOT_DAYS, days: MESSAGE_LOG_RETENTION_DAYS })}
        </p>
      </div>
      <RequestForm />
      <History />
    </div>
  );
}

function RequestForm() {
  const t = useTranslations('team-inbox-conversations.logs');
  const status = useTranslations('team-inbox-conversations.status');
  const errorText = useErrorText();
  const { toast } = useToast();
  const request = useRequestLogExport();
  const initial = useMemo(() => defaultExportRange(), []);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [messageStatus, setMessageStatus] = useState<'' | MessageStatus>('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem = exportRangeProblem(from, to);
  const oldest = oldestExportDay();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (problem) return;
    try {
      const created = await request.mutateAsync({
        from,
        to,
        ...(messageStatus ? { messageStatus } : {}),
      });
      toast(
        created.emailedTo ? t('requestedTo', { email: created.emailedTo }) : t('requested'),
        'success',
      );
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      data-testid="message-logs-form"
      className="space-y-4 rounded-md border border-border p-4"
    >
      <h2 className="text-lg font-medium">{t('form.title')}</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={t('form.from')}
          htmlFor="log-from"
          error={
            touched && problem
              ? t(`problem.${problem}`, { days: MESSAGE_LOG_RETENTION_DAYS })
              : undefined
          }
        >
          <Input
            id="log-from"
            type="date"
            value={from}
            min={oldest}
            onChange={(e) => setFrom(e.target.value)}
            invalid={touched && problem !== null}
          />
        </Field>
        <Field label={t('form.to')} htmlFor="log-to">
          <Input id="log-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label={t('form.status')} htmlFor="log-status">
          <Select
            id="log-status"
            value={messageStatus}
            onChange={(e) => setMessageStatus(e.target.value as '' | MessageStatus)}
          >
            <option value="">{t('form.anyStatus')}</option>
            {EXPORT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {status(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('form.hint', { days: MESSAGE_LOG_RETENTION_DAYS })}
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" disabled={request.isPending}>
        {request.isPending ? t('form.sending') : t('form.submit')}
      </Button>
    </form>
  );
}

function History() {
  const t = useTranslations('team-inbox-conversations.logs');
  const errorText = useErrorText();
  const q = useLogExports();
  const focus = useSearchParams().get('export');

  return (
    <section className="space-y-3" aria-labelledby="log-history">
      <h2 id="log-history" className="text-lg font-medium">
        {t('history.title')}
      </h2>
      {q.isPending && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Spinner /> {t('history.loading')}
        </p>
      )}
      {q.isError && (
        <div className="space-y-2">
          <Alert tone="danger">{errorText(q.error)}</Alert>
          <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
            {t('history.tryAgain')}
          </Button>
        </div>
      )}
      {q.data && q.data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('history.empty')}</p>
      )}
      {q.data && q.data.data.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {q.data.data.map((e) => (
            <ExportRow key={e.id} item={e} highlighted={e.id === focus} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ExportRow({ item: e, highlighted }: { item: MessageLogExport; highlighted: boolean }) {
  const t = useTranslations('team-inbox-conversations.logs');
  const statusT = useTranslations('team-inbox-conversations.status');
  const locale = useLocale();
  const timeZone = useTimeZone();
  const errorText = useErrorText();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function download() {
    setBusy(true);
    try {
      const { blob, fileName } = await downloadMessageLogExport(e.id);
      saveBlob(fileName, blob);
    } catch (err) {
      toast(errorText(err), 'danger');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      data-testid="message-log-export"
      data-status={e.status}
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 p-3 text-sm',
        highlighted && 'bg-primary/5',
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">
          {e.from} → {e.to}
          {e.messageStatus && (
            <span className="ms-2 text-xs font-normal text-muted-foreground">
              {t('history.onlyStatus', { status: statusT(e.messageStatus) })}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('history.requestedAt', { date: fullStamp(e.requestedAt, locale, timeZone) })}
          {e.status === 'ready' && e.rowCount !== null && (
            <>
              {' · '}
              {e.rowCount === 0 ? t('history.noLines') : t('history.lines', { count: e.rowCount })}
            </>
          )}
          {e.status === 'ready' && e.expiresAt && (
            <> · {t('history.until', { date: fullStamp(e.expiresAt, locale, timeZone) })}</>
          )}
        </p>
        {e.status === 'failed' && e.error && <p className="text-xs text-danger">{e.error}</p>}
      </div>
      <div className="flex items-center gap-3">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium',
            e.status === 'ready' && 'bg-success/10 text-success',
            e.status === 'failed' && 'bg-danger/10 text-danger',
            (e.status === 'queued' || e.status === 'running') && 'bg-muted text-foreground',
            e.status === 'expired' && 'bg-muted text-muted-foreground',
          )}
        >
          {t(`history.status.${e.status}`)}
        </span>
        {e.status === 'ready' && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void download()}>
            {t('history.download')}
          </Button>
        )}
      </div>
    </li>
  );
}
