'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { ConfirmDialog, cn, useToast } from '@crm/ui';
import type { RecurringFrequency, RecurringInvoiceResponse, RecurringMode, RecurringStatus } from '@crm/contracts';
import { invalidateInvoicing } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { formatDay } from '../lib/dates';
import { exponentOf } from '../lib/money';
import { majorToMinor } from '../lib/wire';
import { useErrorText } from './parts';

/** "Every month", "Every 3 weeks": the schedule's rhythm in words. */
export function useEveryText() {
  const t = useTranslations('invoicing.recurring.every');
  return (frequency: RecurringFrequency, interval: number): string => t(frequency, { interval });
}

/** The amount of the next invoice (a major-units string) as minor units of its currency. */
export const amountMinorOf = (r: Pick<RecurringInvoiceResponse, 'amount' | 'currency'>): number =>
  majorToMinor(r.amount, exponentOf(r.currency));

const STATUS_TONE: Record<RecurringStatus, string> = {
  active: 'border-success/30 bg-success/10 text-success',
  paused: 'border-warning/30 bg-warning/10 text-warning',
  ended: 'border-border bg-muted text-muted-foreground',
};
const STATUS_DOT: Record<RecurringStatus, string> = {
  active: 'bg-success',
  paused: 'bg-warning',
  ended: 'bg-muted-foreground',
};

export function RecurringStatusChip({ status, className }: { status: RecurringStatus; className?: string }) {
  const t = useTranslations('invoicing.recurring.status');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_TONE[status],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', STATUS_DOT[status])} />
      {t(status)}
    </span>
  );
}

/** The outcome of one run in the history. */
export function RunStatusChip({ status }: { status: 'created' | 'failed' }) {
  const t = useTranslations('invoicing.recurring.runStatus');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        status === 'created' ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger',
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', status === 'created' ? 'bg-success' : 'bg-danger')} />
      {t(status)}
    </span>
  );
}

/** What each generated invoice becomes: "Draft for review", "Issued", "Issued and sent by email". */
export function useModeText() {
  const t = useTranslations('invoicing.recurring');
  return {
    short: (mode: RecurringMode): string => t(`modeShort.${mode}`),
    full: (mode: RecurringMode, channel: string): string =>
      mode === 'issue_send' ? t(`modeSent.${channel === 'whatsapp' ? 'whatsapp' : channel === 'link' ? 'link' : 'email'}`) : t(`modeShort.${mode}`),
  };
}

/** A date or an em-less dash. */
export function DayText({ day, className }: { day: string | null; className?: string }) {
  const locale = useLocale();
  return <span className={cn('tabular-nums', className)}>{day ? formatDay(day, locale) : '-'}</span>;
}

/**
 * Pause, resume, run now and delete for a schedule, with their confirmations and toasts: the list and the detail share it.
 * `onDeleted` runs after a successful delete (the detail goes back to the list).
 */
export function useRecurringActions(opts: { onDeleted?: () => void } = {}) {
  const t = useTranslations('invoicing.recurring');
  const locale = useLocale();
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [confirm, setConfirm] = useState<{ kind: 'run' | 'delete'; row: RecurringInvoiceResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function attempt(fn: () => Promise<void>): Promise<boolean> {
    try {
      await fn();
      return true;
    } catch (e) {
      toast(errorText(e), 'danger');
      return false;
    } finally {
      // The state may have moved under us (ended, paused elsewhere): show what is true now.
      await invalidateInvoicing(qc);
    }
  }

  async function pause(r: RecurringInvoiceResponse) {
    setPending(r.id);
    if (await attempt(async () => void (await invoicingApi.pauseRecurring(r.id)))) toast(t('toast.paused', { name: r.name }));
    setPending(null);
  }

  async function resume(r: RecurringInvoiceResponse) {
    setPending(r.id);
    const result: { after: RecurringInvoiceResponse | null } = { after: null };
    const ok = await attempt(async () => {
      result.after = await invoicingApi.resumeRecurring(r.id);
    });
    if (ok) {
      const after = result.after as RecurringInvoiceResponse | null;
      toast(
        after?.status === 'ended'
          ? t('toast.resumedEnded', { name: r.name })
          : t('toast.resumed', { name: r.name, date: formatDay(after?.nextRunDate, locale) }),
      );
    }
    setPending(null);
  }

  async function runNow(r: RecurringInvoiceResponse) {
    setBusy(true);
    const result = { failed: false };
    const ok = await attempt(async () => {
      const after = await invoicingApi.runRecurring(r.id);
      result.failed = after.failureCount > r.failureCount;
    });
    setBusy(false);
    if (ok) {
      setConfirm(null);
      // A failed period is recorded, not thrown: the call succeeds and the history says why.
      if (result.failed) toast(t('toast.runFailed', { name: r.name }), 'danger');
      else toast(t('toast.ran', { name: r.name }));
    }
  }

  async function remove(r: RecurringInvoiceResponse) {
    setBusy(true);
    const ok = await attempt(async () => invoicingApi.removeRecurring(r.id));
    setBusy(false);
    if (ok) {
      setConfirm(null);
      toast(t('toast.deleted', { name: r.name }));
      opts.onDeleted?.();
    }
  }

  const row = confirm?.row;
  const node: ReactNode = (
    <>
      <ConfirmDialog
        open={confirm?.kind === 'run'}
        busy={busy}
        title={row ? t('runNow.title', { name: row.name }) : ''}
        message={row ? t(`runNow.message.${row.mode}`, { date: formatDay(row.nextRunDate, locale) }) : ''}
        confirmLabel={t('runNow.confirm')}
        cancelLabel={t('cancel')}
        onClose={() => setConfirm(null)}
        onConfirm={() => row && void runNow(row)}
      />
      <ConfirmDialog
        open={confirm?.kind === 'delete'}
        tone="danger"
        busy={busy}
        title={row ? t('delete.title', { name: row.name }) : ''}
        message={row ? t('delete.message', { name: row.name }) : ''}
        confirmLabel={t('delete.confirm')}
        cancelLabel={t('delete.keep')}
        onClose={() => setConfirm(null)}
        onConfirm={() => row && void remove(row)}
      />
    </>
  );

  return {
    node,
    pending,
    pause,
    resume,
    askRunNow: (r: RecurringInvoiceResponse) => setConfirm({ kind: 'run', row: r }),
    askDelete: (r: RecurringInvoiceResponse) => setConfirm({ kind: 'delete', row: r }),
  };
}
