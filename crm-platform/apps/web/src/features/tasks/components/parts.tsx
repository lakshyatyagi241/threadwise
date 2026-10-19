'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import type { TaskPriority, TaskResponse } from '@crm/contracts';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import { useActivitySettings } from '@/features/sales-activities';
import { isOverdue, relativeDay } from '../lib/dates';
import { errorKind } from '../lib/errors';
import { avatarColor, formatShortDate, formatTime, initials } from '../lib/format';
import { CalendarIcon, CheckIcon, ContactIcon, DealIcon } from './icons';

/** The workspace's time zone (buckets are cut there), or the viewer's when the workspace has none. */
export function useWorkspaceZone(): string | undefined {
  return useSession().org.timezone ?? undefined;
}

/** The current time, refreshed every minute so "overdue" turns red without a reload. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * What the signed-in person may do, from the permission keys the API defines (`record.tasks.*`). The server stays the
 * authority and answers 403 where it must.
 */
export function useTasksCan() {
  const { permissions } = useSession();
  const has = (key: string) => key in permissions;
  return {
    read: has('record.tasks.read'),
    create: has('record.tasks.create'),
    update: has('record.tasks.update'),
    remove: has('record.tasks.delete'),
  };
}

/** Two-letter circle for a person; the colour follows the name so it is the same everywhere. */
export function Avatar({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: avatarColor(name) }}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

const PRIORITY_TONE: Record<TaskPriority, string> = {
  high: 'border-danger/30 bg-danger/10 text-danger',
  medium: 'border-warning/30 bg-warning/10 text-warning',
  low: 'border-border bg-muted text-muted-foreground',
};

export function PriorityChip({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const t = useTranslations('tasks.priority');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium',
        PRIORITY_TONE[priority],
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-1.5 rounded-full',
          priority === 'high'
            ? 'bg-danger'
            : priority === 'medium'
              ? 'bg-warning'
              : 'bg-muted-foreground',
        )}
      />
      {t(priority)}
    </span>
  );
}

/** The due date of a task: "Today, 5:00 PM", "Tomorrow, 9:00 AM", "5 Oct, 11:00 AM", red while overdue, plain when none. */
export function DueText({
  task,
  now,
  zone,
  className,
}: {
  task: Pick<TaskResponse, 'dueAt' | 'status'>;
  now: Date;
  zone: string | undefined;
  className?: string;
}) {
  const t = useTranslations('tasks.due');
  const locale = useLocale();
  if (!task.dueAt)
    return <span className={cn('text-muted-foreground', className)}>{t('none')}</span>;
  const overdue = isOverdue(task, now, zone);
  const time = formatTime(task.dueAt, locale, zone);
  const rel = relativeDay(task.dueAt, now, zone);
  const text =
    rel === 'date'
      ? t('date', { date: formatShortDate(task.dueAt, locale, now, zone), time })
      : t(rel, { time });
  return (
    <span
      title={overdue ? t('overdue') : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums',
        overdue ? 'font-medium text-danger' : task.status === 'done' ? 'text-muted-foreground' : '',
        className,
      )}
    >
      <CalendarIcon className="size-3.5 shrink-0 opacity-70" />
      {text}
      {overdue && <span className="sr-only"> ({t('overdue')})</span>}
    </span>
  );
}

/** The round tick that completes or reopens a task. */
export function CompleteCheck({
  done,
  title,
  disabled,
  onToggle,
  className,
}: {
  done: boolean;
  title: string;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = useTranslations('tasks.row');
  // "Allow users to mark this activity as completed" (Settings > Sales Activities): off means a task cannot be ticked, but one that is done can still be reopened.
  const { allowComplete } = useActivitySettings('task');
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? t('reopenNamed', { title }) : t('completeNamed', { title })}
      title={done ? t('reopen') : t('complete')}
      disabled={disabled || (!done && !allowComplete)}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded-full border outline-none transition',
        'focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        done
          ? 'border-success bg-success text-white'
          : 'border-muted-foreground/60 text-transparent hover:border-success hover:text-success/60',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <CheckIcon className="size-3" strokeWidth={3} />
    </button>
  );
}

/** A linked contact or deal: a small outlined pill that goes to the record. */
export function RecordPill({
  kind,
  id,
  label,
  className,
}: {
  kind: 'contact' | 'deal';
  id: string;
  label: string | null;
  className?: string;
}) {
  const t = useTranslations('tasks.link');
  const text = label || (kind === 'contact' ? t('unnamedContact') : t('unnamedDeal'));
  const Icon = kind === 'contact' ? ContactIcon : DealIcon;
  return (
    <Link
      href={kind === 'contact' ? `/contacts/${id}` : `/deals?deal=${id}`}
      title={text}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
        className,
      )}
    >
      <Icon className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{text}</span>
    </Link>
  );
}

/** A failed call, in our words (chosen by error code) plus the request id for support. */
export function ErrorLine({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const t = useTranslations('tasks.errors');
  const kind = errorKind(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind)}</span>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
    </Alert>
  );
}

/** The sentence for a failed call, chosen by its error code (for toasts and inline lines). */
export function useErrorText() {
  const t = useTranslations('tasks.errors');
  return (error: unknown) => t(errorKind(error));
}
