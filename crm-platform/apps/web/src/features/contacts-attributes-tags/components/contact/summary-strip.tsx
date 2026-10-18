'use client';

import { useMemo, type ReactNode } from 'react';
import { useFormatter, useNow, useTranslations } from 'next-intl';
import { cn } from '@crm/ui';
import { useCan } from '@/features/auth-registration-security/shared/session-context';
import { useTasksList } from '@/features/tasks';
import { useContactDeals } from '../../api/deals';
import { useContactMeetings } from '../../api/meetings';
import type { ContactRow } from '../../api/schemas';
import { isNotAvailableToYou } from '../../lib/contact-data';
import { isClosedBooking } from '../../lib/meeting-booking';
import type { SectionId } from '../../lib/sections';

function Tile({
  label,
  value,
  sub,
  onClick,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  onClick?: () => void;
  tone?: 'danger';
}) {
  const body = (
    <>
      <span className="block truncate text-[11px] font-medium text-muted-foreground">{label}</span>
      <span
        className={cn(
          'mt-0.5 block truncate text-sm font-semibold',
          tone === 'danger' && 'text-danger',
        )}
        dir="auto"
      >
        {value}
      </span>
      {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
    </>
  );
  const cls = 'min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-start';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        cls,
        'outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary',
      )}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/**
 * The first thing the Overview says: open tasks (and the next one due), the next meeting, the last activity and the open deals, as
 * four small tiles in one row (two by two on a phone). A tile whose data the person may not see, or the plan does not have, is left out.
 */
export function SummaryStrip({
  contact,
  onOpenSection,
  className,
}: {
  contact: ContactRow;
  onOpenSection?: (section: SectionId) => void;
  className?: string;
}) {
  const t = useTranslations('contacts-attributes-tags.contact.record.summary');
  const format = useFormatter();
  const now = useNow();
  const canTasks = useCan('record.tasks.read');
  const canRead = useCan('record.contacts.read');
  const canDeals = useCan('record.deals.read');
  const tasks = useTasksList(
    { kind: 'contact', id: contact.id },
    { status: 'open' },
    { limit: 50, enabled: canTasks },
  );
  const meetings = useContactMeetings(contact.id, canRead);
  const deals = useContactDeals(contact.id, canDeals);

  const nextMeeting = useMemo(() => {
    const at = now.getTime();
    return meetings.items
      .filter((m) => m.startsAt && Date.parse(m.startsAt) > at && !isClosedBooking(m))
      .sort((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0];
  }, [meetings.items, now]);
  const dueTasks = tasks.items.filter((x) => x.dueAt);
  const nextDue = [...dueTasks].sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))[0];
  const overdue = tasks.items.filter((x) => x.overdue).length;
  const day = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <section
      aria-label={t('label')}
      className={cn('grid grid-cols-2 gap-2 lg:grid-cols-4', className)}
    >
      {canTasks && !tasks.isError && (
        <Tile
          label={t('tasks')}
          value={tasks.isSuccess ? `${tasks.items.length}${tasks.hasNextPage ? '+' : ''}` : '…'}
          tone={overdue > 0 ? 'danger' : undefined}
          sub={
            overdue > 0
              ? t('overdue', { count: overdue })
              : nextDue?.dueAt
                ? t('nextDue', {
                    when: format.dateTime(new Date(nextDue.dueAt), { dateStyle: 'medium' }),
                  })
                : tasks.isSuccess
                  ? t('noDue')
                  : undefined
          }
          onClick={onOpenSection ? () => onOpenSection('tasks') : undefined}
        />
      )}
      {canRead && !meetings.isError && (
        <Tile
          label={t('meeting')}
          value={nextMeeting ? nextMeeting.title : meetings.isSuccess ? t('noMeeting') : '…'}
          sub={nextMeeting?.startsAt ? day(nextMeeting.startsAt) : undefined}
          onClick={onOpenSection ? () => onOpenSection('meetings') : undefined}
        />
      )}
      <Tile
        label={t('lastActivity')}
        value={
          contact.lastActivityAt
            ? format.relativeTime(new Date(contact.lastActivityAt), now)
            : t('noActivity')
        }
        sub={
          contact.lastActivityAt
            ? format.dateTime(new Date(contact.lastActivityAt), { dateStyle: 'medium' })
            : undefined
        }
      />
      {canDeals && !(deals.isError && isNotAvailableToYou(deals.error)) && (
        <Tile
          label={t('deals')}
          value={deals.isSuccess ? deals.data.rollup.openCount : '…'}
          sub={deals.isSuccess ? t('wonDeals', { count: deals.data.rollup.wonCount }) : undefined}
          onClick={onOpenSection ? () => onOpenSection('deals') : undefined}
        />
      )}
    </section>
  );
}
