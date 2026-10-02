'use client';

import { useTranslations } from 'next-intl';
import { Button, Input, Select, cn } from '@crm/ui';
import { APPOINTMENT_STATUSES, type BookingType } from '../api/schemas';
import {
  VIEWS,
  hasActiveFilter,
  type AppointmentFilters,
  type AppointmentView,
} from '../lib/filters';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ListIcon,
  MonthIcon,
  RefreshIcon,
  SearchIcon,
  WeekIcon,
  flip,
} from './icons';

/** The screen focuses the search box by this id when "/" is pressed. */
export const SEARCH_ID = 'appointments-search';

const iconBtn =
  'inline-flex size-9 items-center justify-center rounded-md border border-border bg-background outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary';

const VIEW_ICON: Record<AppointmentView, typeof ListIcon> = {
  list: ListIcon,
  week: WeekIcon,
  month: MonthIcon,
};

export interface AppointmentsToolbarProps {
  filters: AppointmentFilters;
  q: string;
  onQ: (q: string) => void;
  onChange: (patch: Partial<AppointmentFilters>) => void;
  types: readonly BookingType[];
  onRefresh: () => void;
  refreshing: boolean;
  /** Calendar views only: the heading of the range and the previous / today / next controls. */
  calendar?: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void };
}

/** One compact row: search, status, booking type, Clear, then the calendar's navigation, refresh and the view switch. */
export function AppointmentsToolbar(p: AppointmentsToolbarProps) {
  const t = useTranslations('appointments.toolbar');
  const ts = useTranslations('appointments.status');
  const f = p.filters;
  const active = hasActiveFilter({ ...f, q: p.q });

  return (
    <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('label')}>
      <div className="relative min-w-40 flex-1 sm:max-w-xs">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          id={SEARCH_ID}
          type="search"
          value={p.q}
          onChange={(e) => p.onQ(e.target.value)}
          placeholder={t('search')}
          aria-label={t('search')}
          aria-keyshortcuts="/"
          className="h-9 ps-9"
        />
      </div>

      <Select
        aria-label={t('status')}
        className="h-9 w-auto min-w-36"
        value={f.status}
        onChange={(e) => p.onChange({ status: e.target.value as AppointmentFilters['status'] })}
      >
        <option value="">{t('allStatuses')}</option>
        {APPOINTMENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {ts(s)}
          </option>
        ))}
      </Select>

      <Select
        aria-label={t('type')}
        className="h-9 w-auto min-w-36 max-w-52"
        value={f.type}
        onChange={(e) => p.onChange({ type: e.target.value })}
      >
        <option value="">{t('allTypes')}</option>
        {p.types.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>

      {active && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            p.onQ('');
            p.onChange({ q: '', status: '', type: '' });
          }}
        >
          {t('clear')}
        </Button>
      )}

      <div className="ms-auto flex flex-wrap items-center gap-2">
        {p.calendar && (
          <div className="flex items-center gap-1" role="group" aria-label={t('navigate')}>
            <button
              type="button"
              onClick={p.calendar.onPrev}
              aria-label={t('previous')}
              title={t('previous')}
              className={iconBtn}
            >
              <ChevronLeftIcon className={flip} />
            </button>
            <Button variant="secondary" size="sm" className="h-9" onClick={p.calendar.onToday}>
              {t('today')}
            </Button>
            <button
              type="button"
              onClick={p.calendar.onNext}
              aria-label={t('next')}
              title={t('next')}
              className={iconBtn}
            >
              <ChevronRightIcon className={flip} />
            </button>
            <span className="min-w-28 px-2 text-sm font-semibold" aria-live="polite">
              {p.calendar.label}
            </span>
          </div>
        )}
        <button
          type="button"
          onClick={p.onRefresh}
          title={t('refresh')}
          aria-label={t('refresh')}
          className={iconBtn}
        >
          <RefreshIcon className={cn('size-4', p.refreshing && 'animate-spin')} />
        </button>
        <div
          role="group"
          aria-label={t('view')}
          className="inline-flex overflow-hidden rounded-md border border-border"
        >
          {VIEWS.map((id) => {
            const Icon = VIEW_ICON[id];
            return (
              <button
                key={id}
                type="button"
                aria-pressed={f.view === id}
                title={t(`views.${id}`)}
                aria-label={t(`views.${id}`)}
                onClick={() => p.onChange({ view: id })}
                className={cn(
                  'inline-flex size-9 items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary',
                  f.view === id ? 'bg-brand text-brand-foreground' : 'hover:bg-muted',
                )}
              >
                <Icon />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
