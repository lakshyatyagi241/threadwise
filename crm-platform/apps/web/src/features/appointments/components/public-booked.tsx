'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import type { PublicBooking } from '../api/schemas';
import { whereOf } from '../lib/public-booking';
import { CheckCircleIcon, ClockIcon, InfoIcon } from './icons';
import { Banner, CalendarButtons, InfoRow, ManageLink, WhenRows, WhereRow } from './public-parts';

/**
 * What the visitor sees once the booking is made: confirmed, or received and waiting for the business (a service that needs
 * approval). It carries everything they need to keep: what, when in their own zone and the service's, where, an entry for
 * their calendar, and the link that lets them move or cancel the booking later.
 */
export function PublicBooked({
  org,
  orgName,
  booking,
  visitorZone,
}: {
  org: string;
  orgName: string;
  booking: PublicBooking;
  visitorZone: string;
}) {
  const t = useTranslations('appointments.public.booked');
  const pending = booking.status === 'pending';
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <Banner
        tone={pending ? 'warning' : 'success'}
        icon={pending ? <ClockIcon className="size-5" /> : <CheckCircleIcon className="size-5" />}
        title={pending ? t('pendingTitle') : t('confirmedTitle')}
      >
        {pending
          ? t('pendingMessage', { name: orgName })
          : t('confirmedMessage', { name: orgName })}
      </Banner>

      <section
        className="space-y-4 rounded-xl border border-border bg-background p-4 shadow-sm sm:p-5"
        aria-labelledby="booked-what"
      >
        <h1 id="booked-what" className="text-lg font-semibold" dir="auto">
          {booking.typeName}
        </h1>
        <div className="space-y-2.5">
          <WhenRows
            startsAt={booking.startsAt}
            endsAt={booking.endsAt}
            visitorZone={visitorZone}
            serviceZone={booking.timezone}
          />
          <WhereRow where={whereOf(booking)} />
        </div>
        {pending && (
          <InfoRow icon={<InfoIcon />} className="text-muted-foreground">
            {t('pendingNote')}
          </InfoRow>
        )}
      </section>

      <section className="space-y-5 rounded-xl border border-border bg-background p-4 shadow-sm sm:p-5">
        <CalendarButtons booking={booking} orgName={orgName} />
        <div className="border-t border-border pt-5">
          <ManageLink url={booking.manageUrl} />
          <Link
            href={`/b/manage/${encodeURIComponent(booking.manageToken)}`}
            className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-md bg-brand px-4 text-sm font-medium text-brand-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {t('manage')}
          </Link>
        </div>
      </section>

      <p className="text-center text-sm">
        <Link
          href={`/book/${encodeURIComponent(org)}`}
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          {t('bookAnother')}
        </Link>
      </p>
    </div>
  );
}
