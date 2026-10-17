'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  MenuItem,
  MenuSeparator,
  Spinner,
  cn,
  useToast,
} from '@crm/ui';
import type { TaxRateResponse } from '@crm/contracts';
import { invalidateInvoicing, useTaxRates } from '../api/hooks';
import { invoicingApi } from '../api/service';
import { formatDay } from '../lib/dates';
import { frozenEdge, isScrolledSideways, STICKY_ONLY, STICKY_ONLY_HEAD } from '../lib/sticky';
import { percentLabel } from '../lib/wire';
import { BanIcon, CheckIcon, PencilIcon, PercentIcon, PlusIcon, TrashIcon } from './icons';
import { ErrorLine, useErrorText, useInvoicingCan } from './parts';
import { RowMenu } from './row-menu';
import { TaxPresetsDialog } from './tax-presets-dialog';
import { TaxRateDialog } from './tax-rate-dialog';
import { PageFill } from '@/components/shell/page-fill';

const COL_W = [220, 100, 130, 100, 110, 140, 90, 70, 100, 56];
const COLS = [
  'name',
  'type',
  'rate',
  'applies',
  'where',
  'effective',
  'status',
  'used',
  'hsn',
  'actions',
] as const;
const TABLE_W = COL_W.reduce((a, b) => a + b, 0);

/**
 * `/tax-rates`: the rates an invoice line can be taxed with. A rate is typed (VAT, GST, ...), inclusive or exclusive, possibly
 * made of components (CGST + SGST), and one of them is the workspace default. Invoices keep the rate they were written with.
 */
export function TaxRatesScreen() {
  const t = useTranslations('invoicing.taxRates');
  const qc = useQueryClient();
  const { toast } = useToast();
  const errorText = useErrorText();
  const can = useInvoicingCan();
  const rates = useTaxRates();
  const [form, setForm] = useState<TaxRateResponse | 'new' | null>(null);
  const [deleting, setDeleting] = useState<TaxRateResponse | null>(null);
  const [presets, setPresets] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = rates.data ?? [];

  async function act(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      await invalidateInvoicing(qc);
      toast(ok);
      return true;
    } catch (e) {
      toast(errorText(e), 'danger');
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reload(id: string) {
    const fresh = await rates.refetch();
    const next = fresh.data?.find((r) => r.id === id);
    setForm(next ?? null);
    return next;
  }

  return (
    <PageFill minHeight="36rem" className="space-y-3">
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand text-brand-foreground"
          >
            <PercentIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">{t('title')}</h1>
            <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">{t('subtitle')}</p>
          </div>
        </div>
        {can.createTaxRate && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" className="h-10" onClick={() => setPresets(true)}>
              {t('loadForCountry')}
            </Button>
            <Button variant="brand" className="h-10 px-5" onClick={() => setForm('new')}>
              <PlusIcon /> {t('new')}
            </Button>
          </div>
        )}
      </header>

      <section
        aria-label={t('tableLabel')}
        className="flex min-h-0 shrink flex-col overflow-hidden rounded-xl border border-border bg-background"
      >
        {rates.isPending ? (
          <div role="status" className="flex items-center gap-2 p-6 text-muted-foreground">
            <Spinner /> {t('loading')}
          </div>
        ) : rates.isError ? (
          <div className="p-4">
            <ErrorLine error={rates.error} onRetry={() => void rates.refetch()} />
          </div>
        ) : list.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title={t('emptyTitle')}
              message={t('emptyMessage')}
              actions={
                can.createTaxRate ? (
                  <>
                    <Button variant="brand" onClick={() => setPresets(true)}>
                      {t('loadForCountry')}
                    </Button>
                    <Button variant="secondary" onClick={() => setForm('new')}>
                      {t('new')}
                    </Button>
                  </>
                ) : undefined
              }
            />
          </div>
        ) : (
          <RatesTable
            rows={list}
            can={{ update: can.updateTaxRate, remove: can.deleteTaxRate }}
            onEdit={setForm}
            onDelete={setDeleting}
            onDefault={(r) =>
              void act(
                () => invoicingApi.setDefaultTaxRate(r.id),
                t('madeDefault', { name: r.name }),
              )
            }
            onActive={(r) =>
              void act(
                () => invoicingApi.updateTaxRate(r.id, r.rowVersion, { isActive: !r.isActive }),
                r.isActive ? t('deactivated', { name: r.name }) : t('activated', { name: r.name }),
              )
            }
          />
        )}
        {!rates.isPending && !rates.isError && list.length > 0 && (
          <div className="shrink-0 border-t border-border bg-background px-4 py-2.5 text-sm text-muted-foreground">
            {t('count', { count: list.length })}
          </div>
        )}
      </section>

      <p className="text-xs text-muted-foreground">{t('hint')}</p>

      {form !== null && (
        <TaxRateDialog
          key={form === 'new' ? 'new' : `${form.id}:${form.rowVersion}`}
          rate={form === 'new' ? undefined : form}
          hasRates={list.length > 0}
          onClose={() => setForm(null)}
          onReload={reload}
        />
      )}
      {presets && <TaxPresetsDialog onClose={() => setPresets(false)} />}
      <ConfirmDialog
        open={deleting !== null}
        tone="danger"
        busy={busy}
        title={t('deleteTitle')}
        message={
          deleting
            ? deleting.usedBy > 0
              ? t('deleteUsed', { name: deleting.name, count: deleting.usedBy })
              : t('deleteUnused', { name: deleting.name })
            : ''
        }
        confirmLabel={t('delete')}
        cancelLabel={t('keep')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const r = deleting;
          if (!r) return;
          void act(() => invoicingApi.removeTaxRate(r.id), t('deleted', { name: r.name })).then(
            (ok) => {
              if (ok) setDeleting(null);
            },
          );
        }}
      />
    </PageFill>
  );
}

function RatesTable({
  rows,
  can,
  onEdit,
  onDelete,
  onDefault,
  onActive,
}: {
  rows: readonly TaxRateResponse[];
  can: { update: boolean; remove: boolean };
  onEdit: (r: TaxRateResponse) => void;
  onDelete: (r: TaxRateResponse) => void;
  onDefault: (r: TaxRateResponse) => void;
  onActive: (r: TaxRateResponse) => void;
}) {
  const t = useTranslations('invoicing.taxRates');
  const tt = useTranslations('invoicing.taxRates.types');
  const locale = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const th =
    'sticky top-0 z-20 border-b border-border bg-muted px-3 py-3 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground';
  const td = 'border-b border-border px-3 py-2';
  return (
    <div
      role="region"
      aria-label={t('scrollArea')}
      tabIndex={0}
      onScroll={(e) => setScrolled(isScrolledSideways(e.currentTarget.scrollLeft))}
      className="thin-scrollbar min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
    >
      <table
        className="w-full table-fixed border-separate border-spacing-0 text-sm"
        style={{ minWidth: TABLE_W }}
      >
        <colgroup>
          {COL_W.map((w, i) => (
            <col key={i} style={{ width: w }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th
                key={c}
                scope="col"
                className={cn(
                  th,
                  c === 'used' && 'text-end',
                  c === 'name' && `${STICKY_ONLY_HEAD} ${frozenEdge(scrolled)}`,
                )}
              >
                {c === 'actions' ? (
                  <span className="sr-only">{t('columns.actions')}</span>
                ) : (
                  <span className="block truncate">{t(`columns.${c}`)}</span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const where = [r.country, r.region].filter(Boolean).join(' / ');
            const from = formatDay(r.effectiveFrom, locale);
            const to = formatDay(r.effectiveTo, locale);
            const menu = can.update || can.remove;
            return (
              <tr
                key={r.id}
                className={cn(
                  'group h-14 align-middle transition-colors hover:bg-muted',
                  !r.isActive && 'text-muted-foreground',
                )}
              >
                <td className={cn('max-w-0', td, STICKY_ONLY, frozenEdge(scrolled))}>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium" dir="auto" title={r.name}>
                      {r.name}
                    </span>
                    {r.isDefault && <Badge tone="success">{t('default')}</Badge>}
                  </div>
                  {r.description && (
                    <div className="truncate text-xs text-muted-foreground" dir="auto">
                      {r.description}
                    </div>
                  )}
                </td>
                <td className={cn('max-w-0', td)}>
                  <span className="block truncate">{tt(r.type)}</span>
                </td>
                <td className={cn('max-w-0', td)}>
                  <span dir="ltr" className="block font-semibold tabular-nums">
                    {percentLabel(r.rate)}%
                  </span>
                  {r.components && r.components.length > 0 && (
                    <span
                      dir="ltr"
                      className="block truncate text-xs text-muted-foreground"
                      title={r.components
                        .map((c) => `${c.type} ${percentLabel(c.rate)}%`)
                        .join(' + ')}
                    >
                      {r.components.map((c) => `${c.type} ${percentLabel(c.rate)}%`).join(' + ')}
                    </span>
                  )}
                </td>
                <td className={td}>
                  <Badge tone={r.inclusive ? 'warning' : 'neutral'}>
                    {r.inclusive ? t('inclusive') : t('exclusive')}
                  </Badge>
                </td>
                <td className={cn('max-w-0', td)}>
                  <span dir="ltr" className="block truncate">
                    {where || <span className="text-muted-foreground">{t('anywhere')}</span>}
                  </span>
                </td>
                <td className={cn('max-w-0', td, 'tabular-nums')}>
                  <span className="block truncate">
                    {from || to ? `${from || t('always')} - ${to || t('noEnd')}` : t('always')}
                  </span>
                </td>
                <td className={td}>
                  <Badge tone={r.isActive ? 'success' : 'neutral'}>
                    {r.isActive ? t('active') : t('inactive')}
                  </Badge>
                </td>
                <td className={cn(td, 'text-end tabular-nums')}>{r.usedBy}</td>
                <td className={cn('max-w-0', td)}>
                  <span dir="ltr" className="block truncate">
                    {r.defaultHsnSac ?? '-'}
                  </span>
                </td>
                <td className="border-b border-border px-1 py-2">
                  {menu && (
                    <RowMenu label={t('moreFor', { name: r.name })}>
                      {(close) => (
                        <>
                          {can.update && (
                            <MenuItem
                              onSelect={() => {
                                close();
                                onEdit(r);
                              }}
                            >
                              <PencilIcon /> {t('edit')}
                            </MenuItem>
                          )}
                          {can.update && !r.isDefault && r.isActive && (
                            <MenuItem
                              onSelect={() => {
                                close();
                                onDefault(r);
                              }}
                            >
                              <CheckIcon /> {t('makeDefault')}
                            </MenuItem>
                          )}
                          {can.update && !r.isDefault && (
                            <MenuItem
                              onSelect={() => {
                                close();
                                onActive(r);
                              }}
                            >
                              <BanIcon /> {r.isActive ? t('deactivate') : t('activate')}
                            </MenuItem>
                          )}
                          {can.remove && (
                            <>
                              {can.update && <MenuSeparator />}
                              <MenuItem
                                danger
                                onSelect={() => {
                                  close();
                                  onDelete(r);
                                }}
                              >
                                <TrashIcon /> {t('delete')}
                              </MenuItem>
                            </>
                          )}
                        </>
                      )}
                    </RowMenu>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
