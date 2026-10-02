'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@crm/ui';
import type { Appointment } from '../api/schemas';
import { customerLabel, formatDay, formatTimeRange, zoneName } from '../lib/format';
import { dayKeyOf, diffDays } from '../lib/zone';
import { AppointmentRowMenu, type AppointmentAction } from './appointment-menu';
import { Avatar, StatusChip, TypeDot } from './parts';
import { GlobeIcon } from './icons';

export interface AppointmentsTableProps {
  appointments: readonly Appointment[];
  now: Date;
  /** The zone times are shown in. */
  zone: string;
  activeId: string | null;
  canUpdate: boolean;
  onOpen: (id: string) => void;
  onAction: (action: AppointmentAction, appointment: Appointment) => void;
}

/** Widths in px; the table is fixed-layout and scrolls sideways inside its card when they do not fit. */
const W = { when: 230, customer: 230, service: 230, status: 140, menu: 52 } as const;
const MIN_WIDTH = W.when + W.customer + W.service + W.status + W.menu;

const SURFACE = 'bg-background group-hover:bg-muted group-data-[active=true]:bg-muted';
const FROZEN_SHADOW =
  'shadow-[6px_0_8px_-4px_rgba(15,23,42,0.18)] rtl:shadow-[-6px_0_8px_-4px_rgba(15,23,42,0.18)] dark:shadow-[6px_0_8px_-4px_rgba(0,0,0,0.6)] dark:rtl:shadow-[-6px_0_8px_-4px_rgba(0,0,0,0.6)]';

/**
 * The list view. WaDesk's columns (When, Customer, Title, Status, a Cancel button) with the title as the service, and a menu
 * of the actions the status allows. The When cell is frozen while the others scroll sideways (the Contact Hub table).
 */
export function AppointmentsTable(p: AppointmentsTableProps) {
  const t = useTranslations('appointments.table');
  const locale = useLocale();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setScrolled(Math.abs(el.scrollLeft) > 1);
    on();
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  const today = dayKeyOf(p.now, p.zone);

  return (
    <div ref={scroller} className="thin-scrollbar min-h-0 flex-1 overflow-auto">
      <table
        style={{ minWidth: MIN_WIDTH }}
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
      >
        <colgroup>
          <col style={{ width: W.when }} />
          <col style={{ width: W.customer }} />
          <col style={{ width: W.service }} />
          <col style={{ width: W.status }} />
          <col style={{ width: W.menu }} />
        </colgroup>
        <thead>
          <tr className="text-start text-xs uppercase tracking-wide text-muted-foreground">
            <th
              scope="col"
              className={cn(
                'sticky start-0 top-0 z-30 border-b border-border bg-muted px-4 py-2.5 text-start font-medium',
                scrolled && FROZEN_SHADOW,
              )}
            >
              {t('when')}
            </th>
            <th
              scope="col"
              className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2.5 text-start font-medium"
            >
              {t('customer')}
            </th>
            <th
              scope="col"
              className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2.5 text-start font-medium"
            >
              {t('service')}
            </th>
            <th
              scope="col"
              className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2.5 text-start font-medium"
            >
              {t('status')}
            </th>
            <th
              scope="col"
              className="sticky top-0 z-20 border-b border-border bg-muted px-2 py-2.5"
            >
              <span className="sr-only">{t('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {p.appointments.map((a) => {
            const day = dayKeyOf(a.startsAt, p.zone);
            const rel = diffDays(today, day);
            const relLabel =
              rel === 0
                ? t('today')
                : rel === 1
                  ? t('tomorrow')
                  : rel === -1
                    ? t('yesterday')
                    : null;
            const dim = a.status === 'cancelled' || a.status === 'no_show';
            const name = customerLabel(a.customer);
            const contact = a.contact?.phone ?? a.customer.phone ?? a.customer.email;
            const showZone = a.inviteeTimezone && a.inviteeTimezone !== p.zone;
            return (
              <tr
                key={a.id}
                data-active={p.activeId === a.id}
                tabIndex={0}
                aria-label={t('rowLabel', { title: a.title })}
                onClick={() => p.onOpen(a.id)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    p.onOpen(a.id);
                  }
                }}
                className="group cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <td
                  className={cn(
                    'sticky start-0 z-10 border-b border-border px-4 py-3 align-top',
                    SURFACE,
                    scrolled && FROZEN_SHADOW,
                  )}
                >
                  <div
                    className={cn(
                      'flex items-center gap-2 font-medium',
                      dim && 'text-muted-foreground line-through',
                    )}
                  >
                    {formatDay(a.startsAt, locale, p.zone)}
                    {relLabel && (
                      <span className="rounded-full bg-brand/10 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand no-underline dark:text-primary">
                        {relLabel}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs tabular-nums text-muted-foreground">
                    <span>{formatTimeRange(a.startsAt, a.endsAt, locale, p.zone)}</span>
                    <span>{zoneName(a.startsAt, locale, p.zone)}</span>
                  </div>
                </td>
                <td className={cn('border-b border-border px-4 py-3 align-top', SURFACE)}>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={name} />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{name || t('noName')}</div>
                      {contact && (
                        <div className="truncate text-xs text-muted-foreground">
                          <bdi>{contact}</bdi>
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn('border-b border-border px-4 py-3 align-top', SURFACE)}>
                  <div className="flex items-center gap-2">
                    <TypeDot color={a.bookingType?.color} />
                    <span className="truncate">{a.bookingType?.name ?? a.title}</span>
                  </div>
                  {showZone && (
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                      <GlobeIcon className="size-3" />
                      <span className="truncate">{a.inviteeTimezone!.replaceAll('_', ' ')}</span>
                    </div>
                  )}
                </td>
                <td className={cn('border-b border-border px-4 py-3 align-top', SURFACE)}>
                  <StatusChip status={a.status} />
                  {a.needsReview && (
                    <div className="mt-1 text-xs font-medium text-warning">{t('needsReview')}</div>
                  )}
                </td>
                <td
                  className={cn('border-b border-border px-2 py-3 text-end align-top', SURFACE)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <AppointmentRowMenu
                    appointment={a}
                    now={p.now}
                    canUpdate={p.canUpdate}
                    onAction={p.onAction}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
