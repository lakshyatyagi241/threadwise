'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WALLET_CATEGORIES, type RatesResponse } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, Input, Select, Spinner, cn } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import { TONE_CLASS, currencySymbol } from '../../lib/money';
import {
  EMPTY_DRAFT,
  addRow,
  afterSave,
  editField,
  gridRows,
  marginOf,
  planSave,
  removeAdded,
  rowProblem,
  type Draft,
  type GridCategory,
  type GridRow,
  type RowProblem,
  type SavePlan,
} from '../../lib/rate-grid';
import { RateTools } from './rate-tools';

/** The editable per-country x category rate card: what you charge, what Meta charges you, and the live margin. */
export function RateGrid({ rates, canEdit }: { rates: RatesResponse; canEdit: boolean }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.grid');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [showProblems, setShowProblems] = useState(false);
  const [removing, setRemoving] = useState<GridRow | null>(null);
  const [plan, setPlan] = useState<SavePlan | null>(null);

  const rows = useMemo(() => gridRows(rates.data, draft), [rates.data, draft]);
  const names = useMemo(() => new Map(rates.countries.map((c) => [c.code, c.name] as const)), [rates.countries]);
  const dirtyCount = rows.filter((r) => r.dirty).length;
  const symbol = currencySymbol(rates.currency, locale);

  const save = useMutation({
    mutationFn: (p: SavePlan) => operatorApi.saveRates(p.rows),
    onSuccess: (result, p) => {
      setDraft((d) => afterSave(d, p.keys, result));
      setShowProblems(false);
      void qc.invalidateQueries({ queryKey: KEYS.rates });
      if (result.skipped.length > 0) toast.error(t('savedSome', { saved: result.saved, skipped: result.skipped.length }));
      else toast.success(t('saved', { count: result.saved }));
    },
    onError: (err) => toast.error(te(errorKind(err))),
  });

  const remove = useMutation({
    mutationFn: (id: string) => operatorApi.deleteRate(id),
    onSuccess: (_r, id) => {
      setRemoving(null);
      setDraft((d) => {
        const { [id]: _gone, ...edits } = d.edits;
        return { ...d, edits };
      });
      void qc.invalidateQueries({ queryKey: KEYS.rates });
      toast.success(t('removed'));
    },
    onError: (err) => {
      setRemoving(null);
      toast.error(te(errorKind(err)));
    },
  });

  const onSave = () => {
    const p = planSave(rows);
    setShowProblems(true);
    setPlan(p);
    if (p.invalid.length === 0 && !p.tooMany && p.rows.length > 0) save.mutate(p);
  };

  const problemOf = (r: GridRow): RowProblem | null => (showProblems ? rowProblem(r, rows) : null);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {rates.perCountryEnabled ? t('modeOn') : t('modeOff')}
          </p>
        </div>
        {canEdit && <RateTools />}
      </div>

      {rows.length === 0 ? (
        <Alert tone="info">{t('empty')}</Alert>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[52rem] text-sm" aria-label={t('title')}>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                <th scope="col" className="px-2 py-2 text-start font-medium">{t('country')}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t('category')}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t('charge')}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t('metaCost')}</th>
                <th scope="col" className="px-2 py-2 text-start font-medium">{t('margin')}</th>
                {canEdit && <th scope="col" className="px-2 py-2 text-end font-medium"><span className="sr-only">{t('actions')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <GridLine
                  key={r.key}
                  row={r}
                  countries={rates.countries}
                  countryName={names.get(r.countryCode)}
                  symbol={symbol}
                  canEdit={canEdit}
                  problem={problemOf(r)}
                  serverReason={draft.skipped[r.key]}
                  onChange={(field, value) => setDraft((d) => editField(d, r.key, field, value))}
                  onRemove={() => (r.existing ? setRemoving(r) : setDraft((d) => removeAdded(d, r.key)))}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {plan?.tooMany && <Alert tone="danger">{t('tooMany')}</Alert>}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setDraft((d) => addRow(d))}>
            {t('addRow')}
          </Button>
          <Button onClick={onSave} disabled={dirtyCount === 0 || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {t('save')}
          </Button>
          {dirtyCount > 0 && (
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {t('unsaved', { count: dirtyCount })}
            </span>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={t('removeTitle')}
        message={t('removeBody', {
          country: removing ? countryLabel(removing.countryCode, names.get(removing.countryCode), t('anyCountry')) : '',
        })}
        confirmLabel={t('remove')}
        cancelLabel={t('cancel')}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.key)}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}

function countryLabel(code: string, name: string | undefined, any: string): string {
  return code === '' ? any : `${name ?? code} (${code})`;
}

function GridLine({
  row,
  countries,
  countryName,
  symbol,
  canEdit,
  problem,
  serverReason,
  onChange,
  onRemove,
}: {
  row: GridRow;
  countries: RatesResponse['countries'];
  countryName: string | undefined;
  symbol: string;
  canEdit: boolean;
  problem: RowProblem | null;
  serverReason: string | undefined;
  onChange: (field: 'price' | 'metaCost' | 'countryCode' | 'category', value: string) => void;
  onRemove: () => void;
}) {
  const t = useTranslations('wallet-message-billing.admin.pricing.grid');
  const tc = useTranslations('wallet-message-billing.categories');
  const margin = marginOf(row.price, row.metaCost);
  const label = `${countryLabel(row.countryCode, countryName, t('anyCountry'))}, ${row.category ? tc(row.category) : t('anyCategory')}`;
  const noteId = `note-${row.key}`;
  const note = problem ? t(`problems.${problem}`) : serverReason;
  return (
    <tr className={cn('border-b border-border align-top last:border-0', row.dirty && 'bg-muted/40')} data-dirty={row.dirty || undefined}>
      <td className="px-2 py-2">
        {row.existing ? (
          <span className="font-medium">{countryLabel(row.countryCode, countryName, t('anyCountry'))}</span>
        ) : (
          <Select
            aria-label={t('country')}
            value={row.countryCode}
            invalid={problem === 'country' || problem === 'duplicate'}
            aria-describedby={note ? noteId : undefined}
            onChange={(e) => onChange('countryCode', e.target.value)}
          >
            <option value="">{t('anyCountry')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </Select>
        )}
      </td>
      <td className="px-2 py-2">
        {row.existing ? (
          <span>{row.category ? tc(row.category) : t('anyCategory')}</span>
        ) : (
          <Select
            aria-label={t('category')}
            value={row.category}
            onChange={(e) => onChange('category', e.target.value as GridCategory)}
          >
            <option value="">{t('anyCategory')}</option>
            {WALLET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === 'service' ? t('serviceFree') : tc(c)}
              </option>
            ))}
          </Select>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" aria-hidden="true">{symbol}</span>
          <Input
            aria-label={`${t('charge')}: ${label}`}
            inputMode="decimal"
            autoComplete="off"
            className="min-w-24"
            value={row.price}
            disabled={!canEdit}
            invalid={problem === 'price' || problem === 'empty'}
            aria-describedby={note ? noteId : undefined}
            onChange={(e) => onChange('price', e.target.value)}
          />
        </div>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground" aria-hidden="true">{symbol}</span>
          <Input
            aria-label={`${t('metaCost')}: ${label}`}
            inputMode="decimal"
            autoComplete="off"
            className="min-w-24"
            value={row.metaCost}
            disabled={!canEdit}
            invalid={problem === 'metaCost'}
            aria-describedby={note ? noteId : undefined}
            onChange={(e) => onChange('metaCost', e.target.value)}
          />
        </div>
        {note && (
          <p id={noteId} role="alert" className="mt-1 text-xs text-danger">
            {note}
          </p>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-3 tabular-nums">
        {margin ? (
          <span className={cn('font-medium', TONE_CLASS[margin.tone])}>
            {margin.text}
            {margin.percent !== null && <span className="ms-1 text-xs">({margin.percent}%)</span>}
          </span>
        ) : (
          <span className="text-muted-foreground" aria-label={t('marginUnknown')}>-</span>
        )}
      </td>
      {canEdit && (
        <td className="px-2 py-2 text-end">
          <Button variant="ghost" size="sm" onClick={onRemove} aria-label={`${t('remove')}: ${label}`}>
            {t('remove')}
          </Button>
        </td>
      )}
    </tr>
  );
}

