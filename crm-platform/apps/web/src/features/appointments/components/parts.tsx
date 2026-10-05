'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useEffect, useState, type ComponentProps } from 'react';
import { Alert, Button, cn } from '@crm/ui';
import { useSession } from '@/features/auth-registration-security/shared/session-context';
import type { AppointmentStatus } from '../api/schemas';
import { errorKind, requestIdOf } from '../lib/errors';
import { avatarColor, initials, safeColor } from '../lib/format';
import { STATUS_TONE, TONE_CHIP, TONE_DOT, type Tone } from '../lib/status';

/** The current time, refreshed every minute so "started" and "now" move without a reload. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/**
 * What the signed-in person may do, from the permission keys (`record.appointments.*`). The server stays the authority and
 * answers 403 where it must. While the API has not registered any appointments key for the caller's roles the keys cannot be
 * told apart from "denied", so everything is offered and a refusal arrives as a 403 on the call.
 */
export function useAppointmentsCan() {
  const { permissions } = useSession();
  const registered = Object.keys(permissions).some(
    (k) => k.startsWith('record.appointments.') || k.startsWith('record.booking-types.'),
  );
  const has = (key: string) => !registered || key in permissions;
  return {
    read: has('record.appointments.read'),
    update: has('record.appointments.update'),
    /** Create and edit booking types (and pause or duplicate them). */
    manageTypes: has('record.booking-types.update') || has('record.booking-types.create'),
    /** Edit booking configuration, which includes connecting the workspace's Google Calendar. */
    updateTypes: has('record.booking-types.update'),
    remove: has('record.booking-types.delete'),
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
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** A status as a chip with a dot ("Confirmed"); the label is in the viewer's language. */
export function StatusChip({
  status,
  className,
}: {
  status: AppointmentStatus;
  className?: string;
}) {
  const t = useTranslations('appointments.status');
  return <ToneChip tone={STATUS_TONE[status]} label={t(status)} className={className} />;
}

export function ToneChip({
  tone,
  label,
  className,
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        TONE_CHIP[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 rounded-full', TONE_DOT[tone])} />
      {label}
    </span>
  );
}

/** The small colour square of a booking type. */
export function TypeDot({
  color,
  className,
}: {
  color: string | null | undefined;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: safeColor(color) }}
      className={cn('inline-block size-2.5 shrink-0 rounded-[3px]', className)}
    />
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
  const t = useTranslations('appointments.errors');
  const kind = errorKind(error);
  const requestId = requestIdOf(error);
  return (
    <Alert tone={kind === 'unavailable' ? 'warning' : 'danger'} className={className}>
      <span>{t(kind)}</span>
      {requestId && (
        <span className="mt-1 block text-xs opacity-80">
          {t('requestId')}: <span className="font-mono">{requestId}</span>
        </span>
      )}
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
  const t = useTranslations('appointments.errors');
  return (error: unknown) => t(errorKind(error));
}

const LINK_BUTTON = {
  brand: 'bg-brand text-brand-foreground hover:opacity-90',
  secondary: 'border border-border bg-background text-foreground hover:bg-muted',
} as const;

/** A link that looks like a `Button` (the header's New booking type, Booking types, Settings). */
export function LinkButton({
  variant = 'secondary',
  className,
  ...rest
}: ComponentProps<typeof Link> & { variant?: keyof typeof LINK_BUTTON }) {
  return (
    <Link
      className={cn(
        'inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        LINK_BUTTON[variant],
        className,
      )}
      {...rest}
    />
  );
}
