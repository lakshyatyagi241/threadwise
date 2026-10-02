'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { Button, ConfirmDialog, Textarea } from '@crm/ui';
import { useAppointment, useBookingTypes } from '../api/hooks';
import { BOOKING_SOURCES, type Appointment, type BookingSource } from '../api/schemas';
import {
  customerLabel,
  formatDateTime,
  formatDayLong,
  formatTimeRange,
  zoneName,
} from '../lib/format';
import { formatMoney } from '../lib/money';
import { deriveReminders } from '../lib/reminders';
import { REMINDER_TONE, actionsFor } from '../lib/status';
import { Drawer } from './drawer';
import {
  CalendarIcon,
  CheckIcon,
  CoinIcon,
  ExternalIcon,
  GlobeIcon,
  LinkIcon,
  MailIcon,
  NoteIcon,
  PhoneIcon,
  PinIcon,
  UserIcon,
  VideoIcon,
  XCircleIcon,
  BellIcon,
  CopyIcon,
} from './icons';
import { Avatar, ErrorLine, StatusChip, ToneChip, TypeDot, useNow } from './parts';
import { useAppointmentActions } from './use-appointment-actions';

export const NOTES_MAX = 2000;

export interface AppointmentDrawerProps {
  appointmentId: string;
  /** The row's copy, shown while the full record loads. */
  seed?: Appointment;
  /** The zone times are shown in. */
  zone: string;
  canUpdate: boolean;
  onClose: () => void;
  onReschedule: (a: Appointment) => void;
}

/**
 * The detail panel of one booking: when and where, the customer and their contact, the answers to the booking questions,
 * payment, notes you can edit, the reminders and their state, the customer's manage link, and the actions its status allows
 * (confirm, mark completed or no-show, reschedule, cancel).
 */
export function AppointmentDrawer(p: AppointmentDrawerProps) {
  const t = useTranslations('appointments.drawer');
  const detail = useAppointment(p.appointmentId);
  const appt = detail.data ?? p.seed;
  return (
    <Drawer onClose={p.onClose} title={appt?.title ?? t('loading')} closeLabel={t('close')}>
      {!appt && detail.isPending && (
        <div className="space-y-3 p-6" aria-busy="true" aria-label={t('loading')}>
          <div className="h-8 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-24 animate-pulse rounded bg-muted" />
          <div className="h-40 animate-pulse rounded bg-muted" />
        </div>
      )}
      {!appt && detail.isError && (
        <div className="p-6">
          <ErrorLine error={detail.error} onRetry={() => void detail.refetch()} />
        </div>
      )}
      {appt && <Body {...p} appointment={appt} />}
    </Drawer>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 border-t border-border px-5 py-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Body({
  appointment: a,
  zone,
  canUpdate,
  onReschedule,
}: AppointmentDrawerProps & { appointment: Appointment }) {
  const t = useTranslations('appointments.drawer');
  const ts = useTranslations('appointments.source');
  const tp = useTranslations('appointments.payment');
  const locale = useLocale();
  const now = useNow();
  const actions = useAppointmentActions();
  const can = actionsFor(a, now);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const types = useBookingTypes();
  const typeRow = types.data?.find((x) => x.id === a.bookingType?.id);
  const reminderRows = typeRow ? deriveReminders(a, typeRow.reminders, now) : [];
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(a.notes ?? '');
  const [seenNotes, setSeenNotes] = useState(a.notes ?? '');
  // The notes box follows the server's copy until the person starts editing it.
  if ((a.notes ?? '') !== seenNotes) {
    if (notes === seenNotes) setNotes(a.notes ?? '');
    setSeenNotes(a.notes ?? '');
  }
  const dirty = notes.trim() !== (a.notes ?? '').trim();
  const name = customerLabel(a.customer);
  const showInvitee = a.inviteeTimezone && a.inviteeTimezone !== zone;
  const needsPay = a.currency !== null && a.paymentStatus !== 'none';

  async function act(fn: () => Promise<Appointment | null>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  return (
    <>
      <header className="space-y-3 px-5 pb-4 pt-5 pe-14">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <TypeDot color={a.bookingType?.color} />
          <span className="truncate">{a.bookingType?.name ?? t('noType')}</span>
        </div>
        <h2 className="text-xl font-bold tracking-tight">{name || a.title}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={a.status} />
          {a.status === 'pending' && (
            <span className="text-xs text-muted-foreground">{t('pendingHint')}</span>
          )}
        </div>
        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-start gap-2.5">
            <CalendarIcon className="mt-0.5 size-4 text-muted-foreground" />
            <div className="min-w-0 text-sm">
              <div className="font-medium">{formatDayLong(a.startsAt, locale, zone)}</div>
              <div className="tabular-nums text-muted-foreground">
                {formatTimeRange(a.startsAt, a.endsAt, locale, zone)}{' '}
                <span>{zoneName(a.startsAt, locale, zone)}</span>
                {a.bookingType && (
                  <span> · {t('minutes', { count: a.bookingType.durationMinutes })}</span>
                )}
              </div>
            </div>
          </div>
          {showInvitee && (
            <div className="mt-2 flex items-start gap-2.5 border-t border-border pt-2 text-sm">
              <GlobeIcon className="mt-0.5 size-4 text-muted-foreground" />
              <div className="min-w-0 text-muted-foreground">
                {t('customerTime', {
                  time: formatTimeRange(a.startsAt, a.endsAt, locale, a.inviteeTimezone!),
                  zone: a.inviteeTimezone!.replaceAll('_', ' '),
                })}
              </div>
            </div>
          )}
        </div>

        {a.needsReview && (
          <p
            className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning"
            role="status"
          >
            {t('needsReviewHint')}
          </p>
        )}
        {(a.status === 'cancelled' || a.status === 'declined') &&
          (a.cancelledBy || a.cancelReason) && (
            <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              {a.cancelledBy && (
                <span className="block">
                  {t('cancelledBy', {
                    who: t(
                      a.cancelledBy === 'staff'
                        ? 'cancelledByStaff'
                        : a.cancelledBy === 'invitee'
                          ? 'cancelledByInvitee'
                          : 'cancelledBySystem',
                    ),
                  })}
                </span>
              )}
              {a.cancelReason && (
                <span className="block text-muted-foreground">
                  {t('cancelReason')}: {a.cancelReason}
                </span>
              )}
            </p>
          )}
        {canUpdate &&
          (can.confirm || can.complete || can.noShow || can.reschedule || can.cancel) && (
            <div className="flex flex-wrap gap-2">
              {can.confirm && (
                <Button
                  variant="brand"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act(() => actions.confirm(a))}
                >
                  <CheckIcon /> {t('confirm')}
                </Button>
              )}
              {can.decline && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  className="text-danger"
                  onClick={() => setConfirmDecline(true)}
                >
                  <XCircleIcon /> {t('decline')}
                </Button>
              )}
              {can.complete && (
                <Button
                  variant="brand"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act(() => actions.complete(a))}
                >
                  <CheckIcon /> {t('complete')}
                </Button>
              )}
              {can.noShow && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => void act(() => actions.noShow(a))}
                >
                  <UserIcon /> {t('noShow')}
                </Button>
              )}
              {can.reschedule && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={() => onReschedule(a)}
                >
                  <CalendarIcon /> {t('reschedule')}
                </Button>
              )}
              {can.cancel && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  className="text-danger"
                  onClick={() => setConfirmCancel(true)}
                >
                  <XCircleIcon /> {t('cancel')}
                </Button>
              )}
            </div>
          )}
      </header>

      <Section icon={<UserIcon className="size-3.5" />} title={t('customer')}>
        <div className="flex items-center gap-3">
          <Avatar name={name} className="size-9 text-xs" />
          <div className="min-w-0 text-sm">
            {a.contact ? (
              <Link
                href={`/contacts/${a.contact.id}`}
                className="font-medium text-brand underline-offset-2 hover:underline dark:text-primary"
              >
                {name || a.contact.name || t('openContact')}
              </Link>
            ) : (
              <div className="font-medium">{name || t('noName')}</div>
            )}
            {a.contact && <div className="text-xs text-muted-foreground">{t('linkedContact')}</div>}
          </div>
        </div>
        <ul className="space-y-1 text-sm">
          {(a.customer.phone ?? a.contact?.phone) && (
            <li className="flex items-center gap-2">
              <PhoneIcon className="size-3.5 text-muted-foreground" />
              <a
                href={`tel:${(a.customer.phone ?? a.contact?.phone)!.replace(/[^\d+]/g, '')}`}
                className="hover:underline"
              >
                <bdi>{a.customer.phone ?? a.contact?.phone}</bdi>
              </a>
            </li>
          )}
          {(a.customer.email ?? a.contact?.email) && (
            <li className="flex min-w-0 items-center gap-2">
              <MailIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <a
                href={`mailto:${(a.customer.email ?? a.contact?.email)!}`}
                className="truncate hover:underline"
              >
                {a.customer.email ?? a.contact?.email}
              </a>
            </li>
          )}
        </ul>
      </Section>

      {(a.meetUrl || a.location) && (
        <Section icon={<PinIcon className="size-3.5" />} title={t('where')}>
          <ul className="space-y-1 text-sm">
            {a.meetUrl && (
              <li className="flex items-center gap-2">
                <VideoIcon className="size-3.5 text-muted-foreground" />
                <a
                  href={a.meetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-brand hover:underline dark:text-primary"
                >
                  {t('joinCall')}
                </a>
              </li>
            )}
            {a.location && (
              <li className="flex items-start gap-2">
                <PinIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 break-words">{a.location}</span>
              </li>
            )}
          </ul>
        </Section>
      )}

      <Section icon={<NoteIcon className="size-3.5" />} title={t('answers')}>
        {a.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noAnswers')}</p>
        ) : (
          <dl className="space-y-2.5 text-sm">
            {a.answers.map((x, i) => (
              <div key={`${x.label}-${i}`}>
                <dt className="text-xs text-muted-foreground">{x.label}</dt>
                <dd className="whitespace-pre-wrap break-words">
                  {x.answer || <span className="text-muted-foreground">-</span>}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {needsPay && a.currency && (
        <Section icon={<CoinIcon className="size-3.5" />} title={t('payment')}>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ToneChip
              tone={
                a.paymentStatus === 'paid'
                  ? 'success'
                  : a.paymentStatus === 'pending'
                    ? 'warning'
                    : 'neutral'
              }
              label={tp(a.paymentStatus)}
            />
            {a.depositPaidMinor > 0 && (
              <span className="text-muted-foreground">
                {t('depositPaid', { amount: formatMoney(a.depositPaidMinor, a.currency, locale) })}
              </span>
            )}
          </div>
        </Section>
      )}

      <Section icon={<NoteIcon className="size-3.5" />} title={t('notes')}>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={NOTES_MAX}
          rows={3}
          disabled={!canUpdate}
          aria-label={t('notes')}
          placeholder={t('notesPlaceholder')}
        />
        {canUpdate && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">
              {notes.length}/{NOTES_MAX}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!dirty || busy}
              onClick={() => void act(() => actions.saveNotes(a, notes.trim() || null))}
            >
              {t('saveNotes')}
            </Button>
          </div>
        )}
      </Section>

      <Section icon={<BellIcon className="size-3.5" />} title={t('reminders')}>
        {reminderRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noReminders')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {reminderRows.map((r) => (
              <li
                key={r.offsetMinutes}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  {r.label || t('before', { count: r.offsetMinutes })}
                  <span className="ms-2 tabular-nums text-muted-foreground">
                    {formatDateTime(r.at, locale, zone)}
                  </span>
                </span>
                <ToneChip tone={REMINDER_TONE[r.state]} label={t(`reminder.${r.state}`)} />
              </li>
            ))}
          </ul>
        )}
        {reminderRows.length > 0 && (
          <p className="text-xs text-muted-foreground">{t('remindersNote')}</p>
        )}
      </Section>

      <Section icon={<LinkIcon className="size-3.5" />} title={t('manageLink')}>
        {a.manageUrl ? (
          <>
            <p className="text-sm text-muted-foreground">{t('manageHint')}</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={a.manageUrl}
                aria-label={t('manageLink')}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 text-xs"
              />
              <Button variant="secondary" size="sm" onClick={() => void actions.copyManageLink(a)}>
                <CopyIcon /> {t('copy')}
              </Button>
              <a
                href={a.manageUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('openLink')}
                title={t('openLink')}
                className="flex size-8 items-center justify-center rounded-md border border-border hover:bg-muted"
              >
                <ExternalIcon />
              </a>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t('noManageLink')}</p>
        )}
      </Section>

      <footer className="border-t border-border px-5 py-4 text-xs text-muted-foreground">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>{t('source')}</dt>
          <dd>
            {(BOOKING_SOURCES as readonly string[]).includes(a.source)
              ? ts(a.source as BookingSource)
              : a.source}
          </dd>
          {a.host && (
            <>
              <dt>{t('host')}</dt>
              <dd>{a.host.name}</dd>
            </>
          )}
          <dt>{t('bookedOn')}</dt>
          <dd className="tabular-nums">{formatDateTime(a.createdAt, locale, zone)}</dd>
        </dl>
      </footer>

      <ConfirmDialog
        open={confirmDecline}
        tone="danger"
        busy={busy}
        title={t('declineTitle')}
        message={t('declineMessage')}
        confirmLabel={t('declineConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setConfirmDecline(false)}
        onConfirm={() => {
          void act(async () => {
            const next = await actions.decline(a);
            setConfirmDecline(false);
            return next;
          });
        }}
      />
      <ConfirmDialog
        open={confirmCancel}
        tone="danger"
        busy={busy}
        title={t('cancelTitle')}
        message={t('cancelMessage')}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          void act(async () => {
            const next = await actions.cancel(a);
            setConfirmCancel(false);
            return next;
          });
        }}
      />
    </>
  );
}
