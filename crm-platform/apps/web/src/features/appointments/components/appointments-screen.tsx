'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Button, ConfirmDialog, EmptyState, Spinner, cn } from '@crm/ui';
import {
  invalidateAppointments,
  useAppointmentCounts,
  useAppointmentsInRange,
  useAppointmentsList,
  useAppointmentsSetup,
  useBookingTypes,
  useDisplayZone,
  RANGE_LIMIT,
} from '../api/hooks';
import { setMock } from '../api/http';
import type { Appointment } from '../api/schemas';
import {
  countsQuery,
  filtersToSearch,
  hasActiveFilter,
  listQuery,
  parseFilters,
  rangeQuery,
  type AppointmentFilters,
  type AppointmentTab,
} from '../lib/filters';
import { isUnavailable } from '../lib/errors';
import { firstWeekday, formatDayKey, formatMonthYear } from '../lib/format';
import { monthSpan, rangeOf, weekDays } from '../lib/week-grid';
import { addDays, addMonths, dayKeyOf } from '../lib/zone';
import { AppointmentDrawer } from './appointment-drawer';
import type { AppointmentAction } from './appointment-menu';
import { AppointmentsTable } from './appointments-table';
import { AppointmentsTabs } from './appointments-tabs';
import { SEARCH_ID, AppointmentsToolbar } from './appointments-toolbar';
import { CalendarMonth, CalendarWeek } from './appointments-calendar';
import { AppointmentsIcon, PlusIcon, SettingsIcon, CalendarIcon } from './icons';
import { ErrorLine, LinkButton, useAppointmentsCan, useNow } from './parts';
import { RescheduleDialog } from './reschedule-dialog';
import { useAppointmentActions } from './use-appointment-actions';

/**
 * `/appointments`, "Your bookings" (WaDesk's appointments page, extended): Upcoming and Past tabs with counts, status / type /
 * search filters, the list as a table, and a week and a month calendar. The tab, view, filters, calendar page and the open
 * booking live in the address; everything else is local state over the list query.
 */
export function AppointmentsScreen() {
  const t = useTranslations('appointments.hub');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const qc = useQueryClient();
  const can = useAppointmentsCan();
  const actions = useAppointmentActions();
  const panelId = useId();
  useAppointmentsSetup();

  const filters = useMemo(() => parseFilters(search), [search]);
  const setFilters = useCallback(
    (patch: Partial<AppointmentFilters>) =>
      router.replace(`${pathname}${filtersToSearch({ ...filters, ...patch })}`, { scroll: false }),
    [router, pathname, filters],
  );

  // Search applies 350 ms after typing stops.
  const [q, setQ] = useState(filters.q);
  const [seenQ, setSeenQ] = useState(filters.q);
  if (filters.q !== seenQ) {
    setSeenQ(filters.q);
    setQ(filters.q);
  }
  useEffect(() => {
    if (q.trim() === filters.q.trim()) return;
    const id = window.setTimeout(() => setFilters({ q: q.trim() }), 350);
    return () => window.clearTimeout(id);
    // The timer restarts on every keystroke; setFilters closes over the current filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const zone = useDisplayZone();
  const now = useNow();
  const weekStartsOn = firstWeekday(locale);
  const calendarView = filters.view !== 'list';
  const today = dayKeyOf(now, zone);
  const anchor = filters.day || today;

  const types = useBookingTypes();
  const counts = useAppointmentCounts(countsQuery(filters));
  const list = useAppointmentsList({ kind: 'all' }, listQuery(filters), { enabled: !calendarView });

  const days = useMemo(
    () =>
      filters.view === 'month' ? monthSpan(anchor, weekStartsOn) : weekDays(anchor, weekStartsOn),
    [filters.view, anchor, weekStartsOn],
  );
  const range = useMemo(() => rangeOf(days, zone), [days, zone]);
  const cal = useAppointmentsInRange(rangeQuery(filters, range), calendarView);
  const calendarRows = cal.data?.appointments ?? [];

  const rows = calendarView ? calendarRows : list.items;
  const active = calendarView ? cal : list;

  // dialogs and the keyboard's row
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rescheduleOf, setRescheduleOf] = useState<Appointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Appointment | null>(null);
  const [declineTarget, setDeclineTarget] = useState<Appointment | null>(null);
  const [busy, setBusy] = useState(false);

  const changeTab = (tab: AppointmentTab) => {
    setActiveId(null);
    setFilters({ tab, appt: '' });
  };

  function onAction(action: AppointmentAction, a: Appointment) {
    switch (action) {
      case 'open':
        setFilters({ appt: a.id });
        return;
      case 'confirm':
        void actions.confirm(a);
        return;
      case 'decline':
        setDeclineTarget(a);
        return;
      case 'complete':
        void actions.complete(a);
        return;
      case 'noShow':
        void actions.noShow(a);
        return;
      case 'reschedule':
        setRescheduleOf(a);
        return;
      case 'copyLink':
        void actions.copyManageLink(a);
        return;
      case 'cancel':
        setCancelTarget(a);
        return;
    }
  }

  async function confirmDecline() {
    if (!declineTarget) return;
    setBusy(true);
    await actions.decline(declineTarget);
    setBusy(false);
    setDeclineTarget(null);
  }

  async function confirmCancel() {
    if (!cancelTarget) return;
    setBusy(true);
    await actions.cancel(cancelTarget);
    setBusy(false);
    setCancelTarget(null);
  }

  // "/" focuses the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      const typing =
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable);
      if (e.key !== '/' || typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      e.preventDefault();
      document.getElementById(SEARCH_ID)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const filtered = hasActiveFilter({ ...filters, q });
  const drawerSeed = filters.appt ? rows.find((r) => r.id === filters.appt) : undefined;
  const settled = !active.isPending;

  // calendar navigation
  const step = (dir: 1 | -1) =>
    setFilters({
      day: filters.view === 'month' ? addMonths(anchor, dir) : addDays(anchor, 7 * dir),
    });
  const calendarLabel =
    filters.view === 'month'
      ? formatMonthYear(anchor, locale)
      : `${formatDayKey(days[0]!, locale, { day: 'numeric', month: 'short' })} – ${formatDayKey(days[6]!, locale, { day: 'numeric', month: 'short', year: 'numeric' })}`;

  const emptyKind = filtered ? 'filtered' : filters.tab;

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <AppointmentsIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <nav
              aria-label={t('breadcrumb')}
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              <span>{t('integrations')}</span>
              <span aria-hidden="true" className="mx-1.5">
                /
              </span>
              <span aria-current="page">{t('appointments')}</span>
            </nav>
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden max-w-2xl text-sm text-muted-foreground md:block">
              {t('subtitle')}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can.manageTypes && (
            <LinkButton href="/appointments/types/new" variant="brand" className="px-5">
              <PlusIcon /> {t('newType')}
            </LinkButton>
          )}
          <LinkButton href="/appointments/types">
            <CalendarIcon /> {t('types')}
          </LinkButton>
          <LinkButton href="/appointments/settings">
            <SettingsIcon /> {t('settings')}
          </LinkButton>
        </div>
      </header>

      {calendarView ? (
        <div className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm">
          <span className="font-semibold">
            {t(filters.view === 'month' ? 'monthTitle' : 'weekTitle')}
          </span>
          {settled && !cal.isError && (
            <span className="text-muted-foreground" aria-live="polite">
              {t('inRange', { count: calendarRows.length })}
            </span>
          )}
        </div>
      ) : (
        <AppointmentsTabs
          value={filters.tab}
          onChange={changeTab}
          counts={counts.data}
          panelId={panelId}
        />
      )}

      <AppointmentsToolbar
        filters={filters}
        q={q}
        onQ={setQ}
        onChange={setFilters}
        types={types.data ?? []}
        onRefresh={() => void Promise.all([invalidateAppointments(qc), active.refetch()])}
        refreshing={active.isFetching}
        calendar={
          calendarView
            ? {
                label: calendarLabel,
                onPrev: () => step(-1),
                onNext: () => step(1),
                onToday: () => setFilters({ day: '' }),
              }
            : undefined
        }
      />

      <section
        id={panelId}
        role={calendarView ? 'region' : 'tabpanel'}
        aria-label={t('tableLabel')}
        aria-busy={active.isFetching}
        // The card is as tall as the window allows: the rows scroll inside it and the footer stays pinned.
        className="flex max-h-[max(26rem,calc(100dvh-19rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        <div
          className={cn(
            'flex min-h-0 flex-1 flex-col transition-opacity',
            active.isPlaceholderData && 'opacity-60',
          )}
        >
          {active.isPending ? (
            <ListSkeleton />
          ) : active.isError ? (
            <div className="space-y-3 p-4">
              <ErrorLine error={active.error} onRetry={() => void active.refetch()} />
              {isUnavailable(active.error) && process.env.NODE_ENV === 'development' && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setMock(true);
                    window.location.reload();
                  }}
                >
                  {t('useSampleData')}
                </Button>
              )}
            </div>
          ) : calendarView ? (
            filters.view === 'week' ? (
              <CalendarWeek
                appointments={calendarRows}
                days={days}
                zone={zone}
                now={now}
                activeId={activeId ?? filters.appt}
                onOpen={(id) => setFilters({ appt: id })}
              />
            ) : (
              <CalendarMonth
                appointments={calendarRows}
                anchor={anchor}
                weekStartsOn={weekStartsOn}
                zone={zone}
                now={now}
                activeId={activeId ?? filters.appt}
                onOpen={(id) => setFilters({ appt: id })}
                onShowDay={(day) => setFilters({ view: 'week', day })}
              />
            )
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title={t(`empty.${emptyKind}.title`)}
                message={t(`empty.${emptyKind}.message`)}
                actions={
                  <>
                    {filtered && (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setQ('');
                          setFilters({ q: '', status: '', type: '' });
                        }}
                      >
                        {t('resetFilters')}
                      </Button>
                    )}
                    {!filtered && filters.tab === 'upcoming' && can.manageTypes && (
                      <LinkButton href="/appointments/types/new" variant="brand">
                        <PlusIcon /> {t('newType')}
                      </LinkButton>
                    )}
                  </>
                }
              />
            </div>
          ) : (
            <AppointmentsTable
              appointments={rows}
              now={now}
              zone={zone}
              activeId={activeId ?? filters.appt}
              canUpdate={can.update}
              onOpen={(id) => {
                setActiveId(id);
                setFilters({ appt: id });
              }}
              onAction={onAction}
            />
          )}
        </div>

        {settled && !active.isError && (calendarView ? cal.data?.truncated : rows.length > 0) && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border bg-background px-4 py-2.5 text-sm">
            {calendarView ? (
              <span className="text-muted-foreground">
                {t('truncated', { count: RANGE_LIMIT })}
              </span>
            ) : (
              <>
                <span className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
                  {list.isFetching && <Spinner label={t('loading')} />}
                  {t('showing', { count: rows.length })}
                </span>
                {list.hasNextPage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage && <Spinner />}
                    {t('loadMore')}
                  </Button>
                ) : (
                  <span className="text-muted-foreground">{t('endOfList')}</span>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {filters.appt && (
        <AppointmentDrawer
          key={filters.appt}
          appointmentId={filters.appt}
          seed={drawerSeed}
          zone={zone}
          canUpdate={can.update}
          onClose={() => {
            setActiveId(null);
            setFilters({ appt: '' });
          }}
          onReschedule={setRescheduleOf}
        />
      )}

      {rescheduleOf && (
        <RescheduleDialog
          key={rescheduleOf.id}
          appointment={rescheduleOf}
          zone={zone}
          onClose={() => setRescheduleOf(null)}
        />
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        tone="danger"
        busy={busy}
        title={t('cancelTitle')}
        message={t('cancelMessage')}
        confirmLabel={t('cancelConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => void confirmCancel()}
      />
      <ConfirmDialog
        open={declineTarget !== null}
        tone="danger"
        busy={busy}
        title={t('declineTitle')}
        message={t('declineMessage')}
        confirmLabel={t('declineConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setDeclineTarget(null)}
        onConfirm={() => void confirmDecline()}
      />
    </div>
  );
}

function ListSkeleton() {
  const t = useTranslations('appointments.hub');
  return (
    <div role="status" aria-label={t('loading')} className="space-y-px">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4">
          <div className="h-8 w-40 animate-pulse rounded bg-muted" />
          <div className="hidden h-8 w-40 animate-pulse rounded bg-muted sm:block" />
          <div className="hidden h-6 flex-1 animate-pulse rounded bg-muted md:block" />
          <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
        </div>
      ))}
    </div>
  );
}
