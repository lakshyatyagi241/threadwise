'use client';

import { useLocale, useTranslations } from 'next-intl';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { Button, cn } from '@crm/ui';
import type { LocationType, PublicBooking } from '../api/schemas';
import { errorKind, type ErrorKind } from '../lib/errors';
import { durationParts } from '../lib/format';
import { icsFileName, buildIcs, googleCalendarUrl } from '../lib/ics';
import { calendarEvent, whenLines, type WhenPart, type Where } from '../lib/public-booking';
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  ExternalIcon,
  GlobeIcon,
  PhoneIcon,
  PinIcon,
  VideoIcon,
} from './icons';

// ---- cards for every state a visitor page can be in ----------------------------------------------------------------------

export type CardTone = 'neutral' | 'success' | 'danger' | 'warning';

const CARD_TONES: Record<CardTone, string> = {
  neutral: 'border-border bg-background',
  success: 'border-success/40 bg-success/10',
  danger: 'border-danger/40 bg-danger/10',
  warning: 'border-warning/40 bg-warning/10',
};
const CARD_TEXT: Record<CardTone, string> = {
  neutral: '',
  success: 'text-success',
  danger: 'text-danger',
  warning: 'text-warning',
};

/** A banner: an icon, a heading and a few words. `live` makes screen readers announce it when it appears. */
export function Banner({
  tone,
  icon,
  title,
  children,
  live = true,
  className,
}: {
  tone: CardTone;
  icon: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  live?: boolean;
  className?: string;
}) {
  return (
    <div
      role={live ? (tone === 'danger' || tone === 'warning' ? 'alert' : 'status') : undefined}
      className={cn('flex gap-3 rounded-xl border p-4', CARD_TONES[tone], className)}
    >
      <span className={cn('mt-0.5 shrink-0', CARD_TEXT[tone])}>{icon}</span>
      <div className="min-w-0">
        <p className={cn('text-sm font-semibold', CARD_TEXT[tone])}>{title}</p>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
    </div>
  );
}

/** What went wrong, as the visitor is told it. Each is its own card (see `problemCard`). */
export type ProblemKey =
  | 'notFoundOrg'
  | 'notFoundService'
  | 'notFoundLink'
  | 'paused'
  | 'closed'
  | 'rateLimited'
  | 'unavailable'
  | 'network';

/** Where the call that failed was aimed, so the same 404 reads right ("this link" or "this service"). */
export type ProblemContext = 'org' | 'service' | 'link';

/** The card for a failed call, chosen by the error's code and status (never by its wording). */
export function problemKeyOf(error: unknown, context: ProblemContext): ProblemKey {
  const kind: ErrorKind = errorKind(error);
  switch (kind) {
    case 'notFound':
    case 'planDisabled':
      return context === 'org'
        ? 'notFoundOrg'
        : context === 'service'
          ? 'notFoundService'
          : 'notFoundLink';
    case 'gone':
      return context === 'service' ? 'paused' : 'closed';
    case 'rateLimited':
      return 'rateLimited';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'network';
  }
}

/** A full-page card: the page cannot be shown, and why. Only the transient ones offer "Try again". */
export function ProblemCard({
  error,
  context,
  onRetry,
  backHref,
}: {
  error: unknown;
  context: ProblemContext;
  onRetry?: () => void;
  backHref?: string;
}) {
  const t = useTranslations('appointments.public.problem');
  const key = problemKeyOf(error, context);
  const retry = key === 'rateLimited' || key === 'unavailable' || key === 'network';
  return (
    <div
      role="alert"
      className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-background p-8 text-center sm:mt-10"
    >
      <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <AlertIcon className="size-6" />
      </span>
      <h1 className="mt-4 text-lg font-semibold">{t(`${key}.title`)}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t(`${key}.message`)}</p>
      {retry && onRetry && (
        <Button className="mt-5 h-11" variant="secondary" onClick={onRetry}>
          {t('retry')}
        </Button>
      )}
      {backHref && !retry && (
        <Link
          href={backHref}
          className="mt-5 inline-flex h-11 items-center justify-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          {t('back')}
        </Link>
      )}
    </div>
  );
}

/** The loading state of any visitor page: a header block and a body block, announced once. */
export function PublicSkeleton() {
  const t = useTranslations('appointments.public');
  return (
    <div role="status" aria-label={t('loading')} aria-busy="true" className="space-y-4">
      <div className="h-24 animate-pulse rounded-xl bg-background" />
      <div className="h-80 animate-pulse rounded-xl bg-background" />
    </div>
  );
}

// ---- what, when, where --------------------------------------------------------------------------------------------------

export function InfoRow({
  icon,
  children,
  className,
}: {
  icon: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-3 text-sm', className)}>
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** "30 min", "1 h", "1 h 30 min" in the visitor's language. */
export function useDurationLabel(): (minutes: number) => string {
  const t = useTranslations('appointments.common');
  return (minutes) => {
    const { hours, minutes: m } = durationParts(minutes);
    if (hours === 0) return t('minShort', { count: m });
    return m === 0 ? t('hours', { hours }) : t('hoursMinutes', { hours, minutes: m });
  };
}

export function LocationIcon({
  type,
  className,
}: {
  type: LocationType | null;
  className?: string;
}) {
  if (type === 'virtual') return <VideoIcon className={className} />;
  if (type === 'phone') return <PhoneIcon className={className} />;
  return <PinIcon className={className} />;
}

/** The day and the time in the visitor's zone, and the service's clock under it when it differs. */
export function WhenRows({
  startsAt,
  endsAt,
  visitorZone,
  serviceZone,
}: {
  startsAt: string;
  endsAt: string;
  visitorZone: string;
  serviceZone: string;
}) {
  const t = useTranslations('appointments.public.when');
  const locale = useLocale();
  const w = whenLines(startsAt, endsAt, visitorZone, serviceZone, locale);
  return (
    <>
      <InfoRow icon={<CalendarIcon />}>
        <span className="font-medium" dir="auto">
          {w.visitor.day}
        </span>
      </InfoRow>
      <InfoRow icon={<ClockIcon />}>
        <ZoneTime part={w.visitor} />
        {w.service && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('atService', { range: w.service.range, day: w.service.day, zone: w.service.zone })}
          </p>
        )}
      </InfoRow>
    </>
  );
}

function ZoneTime({ part }: { part: WhenPart }) {
  return (
    <>
      <span className="font-medium">{part.range}</span>
      <span className="ms-2 text-xs text-muted-foreground" dir="ltr">
        {part.zone}
        {part.zoneName ? ` (${part.zoneName})` : ''}
      </span>
    </>
  );
}

/** Join the video call, the address, or the number to ring: whichever the booking has. */
export function WhereRow({ where }: { where: Where | null }) {
  const t = useTranslations('appointments.public.where');
  if (!where) return null;
  switch (where.kind) {
    case 'video':
      return (
        <InfoRow icon={<VideoIcon />}>
          <a
            href={where.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-8 items-center gap-1.5 font-medium text-brand hover:underline dark:text-primary"
          >
            {t('join')}
            <ExternalIcon className="size-3.5" />
          </a>
        </InfoRow>
      );
    case 'videoLater':
      return (
        <InfoRow icon={<VideoIcon />}>
          <span>{t('videoLater')}</span>
        </InfoRow>
      );
    case 'phone':
      return (
        <InfoRow icon={<PhoneIcon />}>
          <span className="text-muted-foreground">{t('phone')} </span>
          <a href={where.tel} className="font-medium hover:underline" dir="ltr">
            {where.text}
          </a>
        </InfoRow>
      );
    case 'address':
      return (
        <InfoRow icon={<PinIcon />}>
          <span dir="auto" className="whitespace-pre-line break-words">
            {where.text}
          </span>
        </InfoRow>
      );
  }
}

// ---- add to calendar and the manage link --------------------------------------------------------------------------------

/** Download .ics and the Google Calendar link, built from the same booking. */
export function CalendarButtons({ booking, orgName }: { booking: PublicBooking; orgName: string }) {
  const t = useTranslations('appointments.public.calendar');
  const event = calendarEvent(booking, orgName);

  function download() {
    const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = icsFileName(event.title);
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('title')}</p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="secondary" className="h-11 flex-1" onClick={download}>
          <DownloadIcon /> {t('download')}
        </Button>
        <a
          href={googleCalendarUrl(event)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <GlobeIcon /> {t('google')}
          <span className="sr-only"> {t('opensNewTab')}</span>
        </a>
      </div>
    </div>
  );
}

/** The manage link with Copy, and a button to open it. Copying says so for screen readers too. */
export function ManageLink({ url }: { url: string }) {
  const t = useTranslations('appointments.public.manageLink');
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 3000);
    } catch {
      /* the link stays selectable in the box below */
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{t('title')}</p>
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={url}
          dir="ltr"
          aria-label={t('title')}
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 min-w-0 flex-1 rounded-md border border-border bg-muted px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        <Button variant="secondary" className="h-10 shrink-0" onClick={() => void copy()}>
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? t('copied') : t('copy')}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? t('copied') : ''}
      </span>
    </div>
  );
}
