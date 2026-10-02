'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { WALLET_CATEGORIES, type MarginsResponse, type RatesResponse } from '@crm/contracts';
import { Button, Input, Select, cn } from '@crm/ui';
import { currencySymbol, formatMinor } from '../../lib/money';
import {
  marginGridRows,
  marginProblem,
  metaCostFor,
  type MarginCategory,
  type MarginDraft,
  type MarginGridRow,
  type MarginProblem,
} from '../../lib/margin-grid';
import { CountrySelect } from './country-select';

/** The grid's rows: the stored margins with the draft on top, each with Meta's cost and the live customer price. */
export function useMarginRows(
  data: MarginsResponse,
  rates: RatesResponse | undefined,
  draft: MarginDraft,
): MarginGridRow[] {
  return useMemo(
    () =>
      marginGridRows(data.data, draft, (country, category) =>
        rates ? metaCostFor(rates.data, country, category) : null,
      ),
    [data.data, rates, draft],
  );
}

type Field = 'margin' | 'countryCode' | 'category';

/**
 * The editable margin table shared by the plan scopes and a workspace's overrides: country, category, margin %, then Meta's
 * cost and the price the customer pays at that margin, worked out as you type. Nothing is saved here; the host decides what
 * Remove means (delete at once for a plan, stage with the reason for a workspace).
 */
export function MarginGrid({
  rows,
  countries,
  currency,
  canEdit,
  audit,
  showProblems,
  skipped,
  labelKey,
  onChange,
  onRemove,
  onUndo,
}: {
  rows: readonly MarginGridRow[];
  countries: MarginsResponse['countries'];
  currency: string;
  canEdit: boolean;
  /** Workspace overrides also show the reason and who set each. */
  audit: boolean;
  showProblems: boolean;
  skipped: Record<string, string>;
  labelKey: string;
  onChange: (key: string, field: Field, value: string) => void;
  onRemove: (row: MarginGridRow) => void;
  onUndo: (row: MarginGridRow) => void;
}) {
  const t = useTranslations('wallet-message-billing.admin.margins.grid');
  const locale = useLocale();
  const names = useMemo(() => new Map(countries.map((c) => [c.code, c.name] as const)), [countries]);
  const symbol = currencySymbol(currency, locale);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[56rem] text-sm" aria-label={labelKey}>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            <Th>{t('country')}</Th>
            <Th>{t('category')}</Th>
            <Th>{t('margin')}</Th>
            <Th>{t('metaCost')}</Th>
            <Th>{t('price')}</Th>
            {audit && <Th>{t('note')}</Th>}
            {audit && <Th>{t('setBy')}</Th>}
            {canEdit && (
              <th scope="col" className="px-2 py-2 text-end font-medium">
                <span className="sr-only">{t('actions')}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <Line
              key={r.key}
              row={r}
              countries={countries}
              countryName={names.get(r.countryCode)}
              currency={currency}
              symbol={symbol}
              canEdit={canEdit}
              audit={audit}
              problem={showProblems ? marginProblem(r, rows) : null}
              serverReason={skipped[r.key]}
              onChange={(field, value) => onChange(r.key, field, value)}
              onRemove={() => onRemove(r)}
              onUndo={() => onUndo(r)}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th scope="col" className="px-2 py-2 text-start font-medium">
      {children}
    </th>
  );
}

export const countryLabel = (code: string, name: string | undefined, any: string): string =>
  code === '' ? any : `${name ?? code} (${code})`;

function Line({
  row,
  countries,
  countryName,
  currency,
  symbol,
  canEdit,
  audit,
  problem,
  serverReason,
  onChange,
  onRemove,
  onUndo,
}: {
  row: MarginGridRow;
  countries: MarginsResponse['countries'];
  countryName: string | undefined;
  currency: string;
  symbol: string;
  canEdit: boolean;
  audit: boolean;
  problem: MarginProblem | null;
  serverReason: string | undefined;
  onChange: (field: Field, value: string) => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const t = useTranslations('wallet-message-billing.admin.margins.grid');
  const tc = useTranslations('wallet-message-billing.categories');
  const locale = useLocale();
  const label = `${countryLabel(row.countryCode, countryName, t('anyCountry'))}, ${row.category ? tc(row.category) : t('anyCategory')}`;
  const noteId = `margin-note-${row.key}`;
  const note = problem ? t(`problems.${problem}`) : serverReason;
  return (
    <tr
      className={cn(
        'border-b border-border align-top last:border-0',
        row.dirty && 'bg-muted/40',
        row.removed && 'opacity-60',
      )}
      data-dirty={row.dirty || undefined}
      data-removed={row.removed || undefined}
    >
      <td className="px-2 py-2">
        {row.existing ? (
          <span className={cn('font-medium', row.removed && 'line-through')}>
            {countryLabel(row.countryCode, countryName, t('anyCountry'))}
          </span>
        ) : (
          <CountrySelect
            value={row.countryCode}
            onChange={(code) => onChange('countryCode', code)}
            countries={countries}
            label={t('country')}
            searchLabel={t('searchCountry')}
            anyLabel={t('anyCountry')}
            invalid={problem === 'duplicate'}
            describedBy={note ? noteId : undefined}
          />
        )}
      </td>
      <td className="px-2 py-2">
        {row.existing ? (
          <span className={cn(row.removed && 'line-through')}>
            {row.category ? tc(row.category) : t('anyCategory')}
          </span>
        ) : (
          <Select
            aria-label={t('category')}
            value={row.category}
            invalid={problem === 'duplicate'}
            onChange={(e) => onChange('category', e.target.value as MarginCategory)}
          >
            <option value="">{t('anyCategory')}</option>
            {WALLET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tc(c)}
              </option>
            ))}
          </Select>
        )}
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-1.5">
          <Input
            aria-label={`${t('margin')}: ${label}`}
            inputMode="text"
            autoComplete="off"
            className="min-w-24"
            value={row.margin}
            disabled={!canEdit || row.removed}
            invalid={problem === 'margin'}
            aria-describedby={note ? noteId : undefined}
            onChange={(e) => onChange('margin', e.target.value)}
          />
          <span className="text-muted-foreground" aria-hidden="true">
            %
          </span>
        </div>
        {note && (
          <p id={noteId} role="alert" className="mt-1 text-xs text-danger">
            {note}
          </p>
        )}
        {row.removed && (
          <p className="mt-1 text-xs text-muted-foreground">{t('removedPending')}</p>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-3 tabular-nums">
        {row.metaCost === null ? (
          <span className="text-muted-foreground" aria-label={t('unknownCost')} title={t('unknownCost')}>
            -
          </span>
        ) : (
          <span>
            {symbol}
            {row.metaCost}
          </span>
        )}
      </td>
      <td className="whitespace-nowrap px-2 py-3 tabular-nums">
        {row.price.kind === 'ok' ? (
          <span className="font-medium" data-testid="price">
            {formatMinor(row.price.priceMinor, currency, locale)}
          </span>
        ) : (
          <span
            className="text-muted-foreground"
            aria-label={row.price.kind === 'unknown' ? t('unknownCost') : t('priceInvalid')}
            title={row.price.kind === 'unknown' ? t('unknownCost') : t('priceInvalid')}
          >
            -
          </span>
        )}
      </td>
      {audit && (
        <td className="max-w-56 px-2 py-3 text-xs text-muted-foreground">{row.note ?? '-'}</td>
      )}
      {audit && <td className="px-2 py-3 text-xs text-muted-foreground">{row.setBy ?? '-'}</td>}
      {canEdit && (
        <td className="px-2 py-2 text-end">
          {row.removed ? (
            <Button variant="ghost" size="sm" onClick={onUndo} aria-label={`${t('undo')}: ${label}`}>
              {t('undo')}
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={onRemove}
              aria-label={`${t('remove')}: ${label}`}
            >
              {t('remove')}
            </Button>
          )}
        </td>
      )}
    </tr>
  );
}
