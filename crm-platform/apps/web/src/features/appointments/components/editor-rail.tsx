'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { Button, Spinner, cn } from '@crm/ui';
import { appointmentsApi } from '../api/service';
import type { PreviewDraft } from '../api/schemas';
import { canPreview, previewDraft, type BookingTypeDraft, type Step } from '../lib/booking-form';
import { draftPrice } from '../lib/editor';
import { formatDayKey, formatTime, safeColor } from '../lib/format';
import { formatMoney } from '../lib/money';
import { groupSlotsByDay } from '../lib/slots';
import { ClockIcon, ExternalIcon, PhoneIcon, PinIcon, RefreshIcon, VideoIcon } from './icons';

const SHOWN_DAYS = 5;
const SHOWN_TIMES = 10;
const PREVIEW_DAYS = 7;
const DEBOUNCE_MS = 500;

/** A value that follows `value` after it has stopped changing for `ms`. */
function useDebounced<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setOut(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return out;
}

/**
 * The persistent right rail: a booking card the way the public page will show the service, and a preview of the real bookable
 * times for the next week under the hours and limits as they are in the form right now (asked of the server, which owns the
 * slot rules). It refreshes shortly after each edit and whenever the Availability step is opened.
 */
export function EditorRail({
  draft,
  step,
  publicUrl,
}: {
  draft: BookingTypeDraft;
  step: Step;
  /** The address of the saved, active type's public page; null for a new or paused type. */
  publicUrl: string | null;
}) {
  const t = useTranslations('appointments.editor.rail');
  const currency = draft.currency.toUpperCase();

  return (
    <aside aria-label={t('title')} className="min-w-0 xl:sticky xl:top-20 xl:self-start">
      <div className="rounded-xl border border-border bg-background p-4">
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <span
              aria-hidden="true"
              className="size-1.5 animate-pulse rounded-full bg-success motion-reduce:animate-none"
            />
            {t('title')}
          </h2>
          <span dir="ltr" className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px]">
            {currency}
          </span>
        </div>

        <BookingCard draft={draft} />

        <div className="mt-4 border-t border-border pt-3">
          <SlotPreview draft={draft} active={step === 'availability'} />
        </div>

        {publicUrl && (
          <a
            href={publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-md border border-border px-3 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
          >
            <ExternalIcon /> {t('viewPublic')}
          </a>
        )}
      </div>
    </aside>
  );
}

/** The service card as a visitor sees it: type colour, name, how long and where, and what it costs. */
function BookingCard({ draft }: { draft: BookingTypeDraft }) {
  const t = useTranslations('appointments.editor.rail');
  const tc = useTranslations('appointments.common');
  const tl = useTranslations('appointments.editor.service.locationTypes');
  const locale = useLocale();
  const currency = draft.currency.toUpperCase();
  const price = draftPrice(draft);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const minutes = Number(draft.duration);
  const duration =
    Number.isInteger(minutes) && minutes > 0 ? tc('minShort', { count: minutes }) : '—';
  const Place =
    draft.locationType === 'virtual'
      ? VideoIcon
      : draft.locationType === 'phone'
        ? PhoneIcon
        : PinIcon;
  const free = price.totalMinor === 0;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border bg-background"
      aria-label={t('cardLabel')}
      role="group"
    >
      <div
        aria-hidden="true"
        className="h-1.5"
        style={{ backgroundColor: safeColor(draft.color) }}
      />
      <div className="space-y-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold" dir="auto">
            {draft.name.trim() || t('newService')}
          </div>
          {draft.description.trim() && (
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground" dir="auto">
              {draft.description.trim()}
            </p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon className="size-3.5" /> {duration}
            </span>
            <span className="inline-flex min-w-0 items-center gap-1.5">
              <Place className="size-3.5 shrink-0" />{' '}
              <span className="truncate">{tl(draft.locationType)}</span>
            </span>
          </div>
          {draft.requiresApproval && (
            <p className="mt-2 text-xs text-warning">{t('needsApproval')}</p>
          )}
        </div>
        <dl className="space-y-1.5 border-t border-border pt-3 text-sm">
          <Line label={t('fee')} value={free ? t('free') : money(price.feeMinor)} />
          <Line label={t('tax')} value={money(price.taxMinor)} />
          <div className="flex items-baseline justify-between gap-4 border-t border-border pt-2 font-semibold">
            <dt>{t('total')}</dt>
            <dd className="tabular-nums" dir="ltr">
              {money(price.totalMinor)}
            </dd>
          </div>
          <Line label={t('dueNow')} value={money(price.dueNowMinor)} strong />
        </dl>
      </div>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn('tabular-nums', strong && 'font-medium text-brand dark:text-primary')}
        dir="ltr"
      >
        {value}
      </dd>
    </div>
  );
}

function SlotPreview({ draft, active }: { draft: BookingTypeDraft; active: boolean }) {
  const t = useTranslations('appointments.editor.rail');
  const locale = useLocale();
  const ready = canPreview(draft);
  const body = JSON.stringify(previewDraft(draft));
  const settled = useDebounced(body, DEBOUNCE_MS);

  const q = useQuery({
    queryKey: ['appointments', 'editor-preview', settled],
    queryFn: ({ signal }) =>
      appointmentsApi.previewSlots(JSON.parse(settled) as PreviewDraft, PREVIEW_DAYS, signal),
    enabled: ready,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  });

  // Opening the Availability step asks again, so the person never looks at times from before the last change.
  const refetch = useRef(q.refetch);
  useEffect(() => {
    refetch.current = q.refetch;
  });
  useEffect(() => {
    if (active && ready) void refetch.current();
    // only when the step is entered; the edits themselves are followed by the debounced key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const zone = draft.timezone;
  const groups = groupSlotsByDay(q.data?.slots ?? [], zone);
  const total = q.data?.slots.length ?? 0;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('slotsTitle')}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          disabled={!ready || q.isFetching}
          onClick={() => void q.refetch()}
          className="h-7 px-2 text-xs"
        >
          {q.isFetching ? <Spinner label={t('loading')} /> : <RefreshIcon className="size-3.5" />}{' '}
          {t('refresh')}
        </Button>
      </div>
      <div className="px-1 text-sm" aria-live="polite">
        {!ready ? (
          <p className="text-muted-foreground">{t('slotsIdle')}</p>
        ) : q.isError ? (
          <p role="alert" className="text-danger">
            {t('slotsFailed')}
          </p>
        ) : q.isPending ? (
          <p className="text-muted-foreground">{t('loading')}</p>
        ) : groups.length === 0 ? (
          <p className="text-muted-foreground">{t('slotsNone', { days: PREVIEW_DAYS })}</p>
        ) : (
          <>
            <ul className="space-y-2.5">
              {groups.slice(0, SHOWN_DAYS).map((g) => (
                <li key={g.day}>
                  <div className="text-xs font-semibold">
                    {formatDayKey(g.day, locale, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short',
                    })}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {g.slots.slice(0, SHOWN_TIMES).map((s) => (
                      <span
                        key={s.start}
                        className="rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-medium tabular-nums text-brand dark:text-primary"
                      >
                        {formatTime(s.start, locale, zone)}
                      </span>
                    ))}
                    {g.slots.length > SHOWN_TIMES && (
                      <span className="text-[11px] text-muted-foreground">
                        +{g.slots.length - SHOWN_TIMES}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('slotsSummary', { count: total, zone: zone.replaceAll('_', ' ') })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
