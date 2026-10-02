'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import { useAppointmentsList, useAppointmentsSetup, useDisplayZone } from '../api/hooks';
import type { Appointment } from '../api/schemas';
import { isUnavailable } from '../lib/errors';
import { formatDay, formatTimeRange } from '../lib/format';
import { ErrorLine, StatusChip, TypeDot, useAppointmentsCan } from './parts';

export interface LinkedAppointmentsProps {
  /** The contact whose bookings are listed. */
  contactId: string;
  className?: string;
}

/**
 * The bookings of one contact on the contact page: the upcoming ones first, the past ones behind a toggle, each row linking
 * to the bookings screen with that booking open. Renders nothing for someone who may not read appointments.
 */
export function LinkedAppointments({ contactId, className }: LinkedAppointmentsProps) {
  const can = useAppointmentsCan();
  if (!can.read) return null;
  return <Panel contactId={contactId} className={className} />;
}

function Panel({ contactId, className }: LinkedAppointmentsProps) {
  const t = useTranslations('appointments.linked');
  useAppointmentsSetup();
  const [showPast, setShowPast] = useState(false);
  const source = { kind: 'contact', id: contactId } as const;
  const upcoming = useAppointmentsList(source, { tab: 'upcoming' }, { limit: 10 });
  const past = useAppointmentsList(source, { tab: 'past' }, { limit: 10, enabled: showPast });
  const heading = `linked-appointments-${contactId}`;

  const rows = [...upcoming.items, ...(showPast ? past.items : [])];
  const pastLoading = showPast && past.isPending;
  const pastFailed = showPast && past.isError;

  return (
    <section
      aria-labelledby={heading}
      className={cn(
        'space-y-3 rounded-md border border-border bg-background p-4 sm:p-5',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          id={heading}
          className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
        >
          {t('title')}
          {upcoming.isSuccess && (
            <span className="ms-2 rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium normal-case tracking-normal text-muted-foreground">
              {upcoming.items.length}
              {upcoming.hasNextPage ? '+' : ''}
            </span>
          )}
        </h2>
        <Link
          href="/appointments"
          className="text-xs text-brand underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none dark:text-primary"
        >
          {t('openBookings')}
        </Link>
      </div>

      {upcoming.isPending ? (
        <div role="status" className="space-y-2" aria-label={t('loading')}>
          <span className="sr-only">{t('loading')}</span>
          {[0, 1].map((i) => (
            <div key={i} aria-hidden="true" className="h-14 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : upcoming.isError ? (
        isUnavailable(upcoming.error) ? (
          <p className="py-2 text-sm text-muted-foreground">{t('unavailable')}</p>
        ) : (
          <ErrorLine error={upcoming.error} onRetry={() => void upcoming.refetch()} />
        )
      ) : (
        <>
          {rows.length === 0 && !pastLoading ? (
            <p className="py-2 text-center text-sm text-muted-foreground">
              {showPast ? t('emptyBoth') : t('empty')}
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {rows.map((a) => (
                <Row key={a.id} appointment={a} />
              ))}
            </ul>
          )}
          {pastLoading && (
            <div role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> {t('loading')}
            </div>
          )}
          {pastFailed && <ErrorLine error={past.error} onRetry={() => void past.refetch()} />}
          <div className="flex flex-wrap items-center gap-2">
            {upcoming.hasNextPage && (
              <Button
                variant="secondary"
                size="sm"
                disabled={upcoming.isFetchingNextPage}
                onClick={() => void upcoming.fetchNextPage()}
              >
                {upcoming.isFetchingNextPage && <Spinner />}
                {t('loadMore')}
              </Button>
            )}
            <button
              type="button"
              aria-pressed={showPast}
              onClick={() => setShowPast((v) => !v)}
              className="text-xs text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-primary"
            >
              {showPast ? t('hidePast') : t('showPast')}
            </button>
            {showPast && past.hasNextPage && (
              <Button
                variant="secondary"
                size="sm"
                disabled={past.isFetchingNextPage}
                onClick={() => void past.fetchNextPage()}
              >
                {t('loadMorePast')}
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Row({ appointment: a }: { appointment: Appointment }) {
  const t = useTranslations('appointments.linked');
  const locale = useLocale();
  const zone = useDisplayZone();
  const typeName = a.bookingType?.name ?? t('noType');
  return (
    <li>
      <Link
        href={`/appointments?appt=${encodeURIComponent(a.id)}`}
        className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2.5 outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {formatDay(a.startsAt, locale, zone)}
            <span className="font-normal text-muted-foreground">
              {' '}
              · {formatTimeRange(a.startsAt, a.endsAt, locale, zone)}
            </span>
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <TypeDot color={a.bookingType?.color} />
            <span dir="auto" className="truncate">
              {typeName}
            </span>
          </span>
        </span>
        <StatusChip status={a.status} />
      </Link>
    </li>
  );
}
