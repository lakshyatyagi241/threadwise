'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Input,
  MenuItem,
  MenuSeparator,
  Select,
  Switch,
  cn,
  useToast,
} from '@crm/ui';
import { invalidateBookingTypes, KEYS, useAppointmentsSetup, useBookingTypes } from '../api/hooks';
import { setMock } from '../api/http';
import type { BookingType } from '../api/schemas';
import { appointmentsApi } from '../api/service';
import { isUnavailable } from '../lib/errors';
import { formatMoney } from '../lib/money';
import { safeColor } from '../lib/format';
import { filterTypes, type TypeStatusFilter } from '../lib/types-list';
import {
  CalendarIcon,
  ChatIcon,
  CopyIcon,
  ExternalIcon,
  LinkIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  TrashIcon,
  VideoIcon,
  PhoneIcon,
  PinIcon,
} from './icons';
import { ErrorLine, LinkButton, useAppointmentsCan, useErrorText } from './parts';
import { RowMenu } from './row-menu';

const LOCATION_ICON = {
  address: PinIcon,
  virtual: VideoIcon,
  phone: PhoneIcon,
  whatsapp: ChatIcon,
} as const;

/**
 * `/appointments/types`, the booking types list (WaDesk's Booking types page): one row per service with its duration,
 * place, price, how many bookings it has, an Active switch, the public link and a menu (edit, duplicate, copy link, delete).
 */
export function BookingTypesScreen() {
  const t = useTranslations('appointments.typesList');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();
  const can = useAppointmentsCan();
  const errorText = useErrorText();
  useAppointmentsSetup();

  const types = useBookingTypes();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<TypeStatusFilter>('all');
  const [deleteTarget, setDeleteTarget] = useState<BookingType | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = useMemo(() => filterTypes(types.data ?? [], q, status), [types.data, q, status]);
  const filtered = q.trim() !== '' || status !== 'all';

  async function toggle(type: BookingType, next: boolean) {
    setBusyId(type.id);
    // The switch moves at once; a failure puts it back.
    const before = qc.getQueryData<BookingType[]>(KEYS.types);
    qc.setQueryData<BookingType[]>(KEYS.types, (list) =>
      list?.map((x) => (x.id === type.id ? { ...x, isActive: next } : x)),
    );
    try {
      await appointmentsApi.setTypeActive(type, next);
      toast(
        next ? t('activated', { name: type.name }) : t('paused', { name: type.name }),
        'success',
      );
    } catch (e) {
      qc.setQueryData(KEYS.types, before);
      toast(`${t('failed')} ${errorText(e)}`, 'danger');
    } finally {
      setBusyId(null);
      void invalidateBookingTypes(qc);
    }
  }

  async function duplicate(type: BookingType) {
    setBusyId(type.id);
    try {
      const copy = await appointmentsApi.duplicateType(type.id);
      toast(t('duplicated', { name: copy.name }), 'success');
      await invalidateBookingTypes(qc);
    } catch (e) {
      toast(`${t('failed')} ${errorText(e)}`, 'danger');
    } finally {
      setBusyId(null);
    }
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusyId(deleteTarget.id);
    try {
      await appointmentsApi.deleteType(deleteTarget.id);
      toast(t('deleted', { name: deleteTarget.name }), 'success');
      setDeleteTarget(null);
      await invalidateBookingTypes(qc);
    } catch (e) {
      toast(`${t('failed')} ${errorText(e)}`, 'danger');
    } finally {
      setBusyId(null);
    }
  }

  async function copyLink(type: BookingType) {
    if (!type.publicUrl) return;
    try {
      await navigator.clipboard.writeText(type.publicUrl);
      toast(t('linkCopied'), 'success');
    } catch {
      toast(t('copyFailed'), 'danger');
    }
  }

  return (
    <div className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <CalendarIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <nav
              aria-label={t('breadcrumb')}
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              <Link href="/appointments" className="hover:text-foreground">
                {t('appointments')}
              </Link>
              <span aria-hidden="true" className="mx-1.5">
                /
              </span>
              <span aria-current="page">{t('services')}</span>
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
          <LinkButton href="/appointments">
            <CalendarIcon /> {t('allBookings')}
          </LinkButton>
          <LinkButton href="/appointments/settings">
            <SettingsIcon /> {t('settings')}
          </LinkButton>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label={t('toolbar')}>
        <div className="relative min-w-40 flex-1 sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="h-9 ps-9"
          />
        </div>
        <Select
          aria-label={t('statusFilter')}
          className="h-9 w-auto min-w-36"
          value={status}
          onChange={(e) => setStatus(e.target.value as TypeStatusFilter)}
        >
          <option value="all">{t('allStatuses')}</option>
          <option value="active">{t('active')}</option>
          <option value="paused">{t('pausedLabel')}</option>
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setQ('');
              setStatus('all');
            }}
          >
            {t('clear')}
          </Button>
        )}
      </div>

      <section
        aria-label={t('tableLabel')}
        aria-busy={types.isFetching}
        className="flex max-h-[max(26rem,calc(100dvh-16rem))] flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        {types.isPending ? (
          <div role="status" aria-label={t('loading')} className="space-y-px">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-4">
                <div className="size-10 animate-pulse rounded-lg bg-muted" />
                <div className="h-6 w-48 animate-pulse rounded bg-muted" />
                <div className="hidden h-6 flex-1 animate-pulse rounded bg-muted md:block" />
              </div>
            ))}
          </div>
        ) : types.isError ? (
          <div className="space-y-3 p-4">
            <ErrorLine error={types.error} onRetry={() => void types.refetch()} />
            {isUnavailable(types.error) && process.env.NODE_ENV === 'development' && (
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
        ) : rows.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
              message={filtered ? t('emptyFiltered') : t('emptyMessage')}
              actions={
                filtered ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQ('');
                      setStatus('all');
                    }}
                  >
                    {t('clear')}
                  </Button>
                ) : can.manageTypes ? (
                  <LinkButton href="/appointments/types/new" variant="brand">
                    <PlusIcon /> {t('newType')}
                  </LinkButton>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">
            <table
              style={{ minWidth: 860 }}
              className="w-full border-separate border-spacing-0 text-sm"
            >
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th
                    scope="col"
                    className="sticky start-0 top-0 z-30 w-[26%] border-b border-border bg-muted px-4 py-2.5 text-start font-medium"
                  >
                    {t('name')}
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2.5 text-start font-medium"
                  >
                    {t('details')}
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2.5 text-start font-medium"
                  >
                    {t('price')}
                  </th>
                  <th
                    scope="col"
                    className="sticky top-0 z-20 border-b border-border bg-muted px-4 py-2.5 text-end font-medium"
                  >
                    {t('booked')}
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
                {rows.map((type) => {
                  const Loc = LOCATION_ICON[type.locationType];
                  return (
                    <tr key={type.id} className="group">
                      <td className="sticky start-0 z-10 border-b border-border bg-background px-4 py-3 group-hover:bg-muted">
                        <div className="flex items-center gap-3">
                          <span
                            aria-hidden="true"
                            style={{ backgroundColor: safeColor(type.color) }}
                            className="flex size-10 shrink-0 items-center justify-center rounded-lg text-white"
                          >
                            <CalendarIcon className="size-5" />
                          </span>
                          <div className="min-w-0">
                            {can.manageTypes ? (
                              <Link
                                href={`/appointments/types/${type.id}`}
                                className="block truncate font-semibold hover:underline"
                              >
                                {type.name}
                              </Link>
                            ) : (
                              <span className="block truncate font-semibold">{type.name}</span>
                            )}
                            <span
                              className="block truncate text-xs text-muted-foreground"
                              dir="ltr"
                            >
                              /{type.slug}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="border-b border-border bg-background px-4 py-3 group-hover:bg-muted">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                          <span>{t('minutes', { count: type.durationMinutes })}</span>
                          <span className="inline-flex items-center gap-1">
                            <Loc className="size-3.5" /> {t(`location.${type.locationType}`)}
                          </span>
                          {type.capacity > 1 && (
                            <span>{t('capacity', { count: type.capacity })}</span>
                          )}
                          {type.requiresApproval && <span>{t('approval')}</span>}
                        </div>
                      </td>
                      <td className="border-b border-border bg-background px-4 py-3 tabular-nums group-hover:bg-muted">
                        {type.price.feeMinor > 0 ? (
                          formatMoney(type.price.feeMinor, type.price.currency, locale)
                        ) : (
                          <span className="text-muted-foreground">{t('free')}</span>
                        )}
                      </td>
                      <td className="border-b border-border bg-background px-4 py-3 text-end tabular-nums group-hover:bg-muted">
                        <Link
                          href={`/appointments?type=${type.id}&tab=past`}
                          className="hover:underline"
                        >
                          {type.appointmentsCount.toLocaleString(locale)}
                        </Link>
                      </td>
                      <td className="border-b border-border bg-background px-4 py-3 group-hover:bg-muted">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={type.isActive}
                            disabled={!can.manageTypes || busyId === type.id}
                            label={t('toggle', { name: type.name })}
                            onCheckedChange={(on) => void toggle(type, on)}
                          />
                          <span
                            className={cn(
                              'text-xs font-medium',
                              type.isActive ? 'text-success' : 'text-muted-foreground',
                            )}
                          >
                            {type.isActive ? t('active') : t('pausedLabel')}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap border-b border-border bg-background px-2 py-3 text-end group-hover:bg-muted">
                        <button
                          type="button"
                          disabled={!type.publicUrl}
                          onClick={() => void copyLink(type)}
                          aria-label={
                            type.publicUrl
                              ? t('copyLinkFor', { name: type.name })
                              : t('copyLinkPaused')
                          }
                          title={
                            type.publicUrl
                              ? t('copyLinkFor', { name: type.name })
                              : t('copyLinkPaused')
                          }
                          className="me-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
                        >
                          <LinkIcon className="size-4" />
                        </button>
                        <RowMenu label={t('moreFor', { name: type.name })}>
                          {(close) => (
                            <>
                              {can.manageTypes && (
                                <MenuItem
                                  onSelect={() => {
                                    close();
                                    router.push(`/appointments/types/${type.id}`);
                                  }}
                                >
                                  <PencilIcon /> {t('edit')}
                                </MenuItem>
                              )}
                              <MenuItem
                                disabled={!type.publicUrl}
                                onSelect={() => {
                                  close();
                                  void copyLink(type);
                                }}
                              >
                                <LinkIcon /> {t('copyLink')}
                              </MenuItem>
                              {type.publicUrl && (
                                <MenuItem
                                  onSelect={() => {
                                    close();
                                    window.open(type.publicUrl!, '_blank', 'noopener,noreferrer');
                                  }}
                                >
                                  <ExternalIcon /> {t('openPage')}
                                </MenuItem>
                              )}
                              {can.manageTypes && (
                                <MenuItem
                                  onSelect={() => {
                                    close();
                                    void duplicate(type);
                                  }}
                                >
                                  <CopyIcon /> {t('duplicate')}
                                </MenuItem>
                              )}
                              {can.remove && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem
                                    danger
                                    onSelect={() => {
                                      close();
                                      setDeleteTarget(type);
                                    }}
                                  >
                                    <TrashIcon /> {t('delete')}
                                  </MenuItem>
                                </>
                              )}
                            </>
                          )}
                        </RowMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {types.isSuccess && rows.length > 0 && (
          <div
            className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <span>{t('showing', { count: rows.length })}</span>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        busy={busyId !== null && busyId === deleteTarget?.id}
        title={t('deleteTitle', { name: deleteTarget?.name ?? '' })}
        message={t('deleteMessage')}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('keep')}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
