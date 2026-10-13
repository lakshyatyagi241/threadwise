'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { SlaStatus } from '@crm/contracts';
import { cn } from '@crm/ui';

/** Whole minutes from `nowMs` to the due time, never below zero. */
export function minutesLeft(dueAt: string, nowMs: number): number {
  return Math.max(0, Math.ceil((Date.parse(dueAt) - nowMs) / 60_000));
}

/**
 * The response clock of a conversation (SLA, plan feature `inbox_sla`): red when the target was missed, amber within half an hour of it.
 * On a list row only a clock in trouble is drawn (`compact`), so a healthy list stays quiet; the thread header also shows a clock that
 * is fine, with its due time. The tooltip names the clock (first reply or resolution) and its due time.
 */
export function SlaBadge({
  status,
  nowMs,
  compact = false,
}: {
  status: SlaStatus | null | undefined;
  nowMs: number;
  compact?: boolean;
}) {
  const t = useTranslations('team-inbox-conversations.sla');
  const format = useFormatter();
  if (!status) return null;
  if (compact && status.state === 'ok') return null;

  const due = new Date(status.dueAt);
  const time = format.dateTime(due, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const kind = t(`kind.${status.kind}`);
  const label =
    status.state === 'breached'
      ? t('breached')
      : status.state === 'at_risk'
        ? t('atRisk', { minutes: minutesLeft(status.dueAt, nowMs) })
        : t('ok', { time });

  return (
    <span
      data-testid="inbox-sla-badge"
      data-sla-state={status.state}
      title={
        status.state === 'breached'
          ? t('titleBreached', { kind, time })
          : t('titleOpen', { kind, time })
      }
      className={cn(
        'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
        status.state === 'breached' && 'bg-danger/15 text-danger',
        status.state === 'at_risk' && 'bg-warning/15 text-warning',
        status.state === 'ok' && 'bg-muted text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}
