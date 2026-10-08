'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import type { PlanAddonOption } from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Input, Spinner } from '@crm/ui';
import { formatMoney } from '../../account/plans/plan-format';
import { clearAddons, selectAddons, toggleAddon } from '../lib/plan-draft';
import { addonRows, addonSaleState, filterAddonRows, type AddonRow } from '../lib/plan-editor-view';
import { NS, ToolbarRow, type EditorState } from './plan-editor-shared';

const PLANS_NS = 'auth-registration-security.platform.plans';

export interface AddonOptionsState {
  status: 'pending' | 'error' | 'success';
  options: readonly PlanAddonOption[];
  retry: () => void;
}

/**
 * The Add-ons tab: the paid Marketplace packs this plan makes visible. Visible is not usable: a
 * workspace still has to buy the add-on. A selected id the options no longer list stays as an
 * "Unknown add-on" row so it can be unticked.
 */
export function AddonsTab({
  state,
  addons,
  onTouched,
}: {
  state: EditorState;
  addons: AddonOptionsState;
  /** Called on any change here: the editor then always sends the selection (see buildPlanRequest). */
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const { draft, err, set } = state;
  const [query, setQuery] = useState('');
  const selected = draft.visibleAddons;
  const error = err('visibleAddons');

  const change = (ids: string[]) => {
    onTouched();
    set('visibleAddons', ids);
  };

  const intro = <p className="text-xs text-muted-foreground">{t('addons.intro')}</p>;
  const problem = error && (
    <p id="plan-visibleAddons" tabIndex={-1} role="alert" className="text-xs text-danger">
      {error}
    </p>
  );

  if (addons.status === 'pending') {
    return (
      <div className="space-y-4">
        {intro}
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={t('addons.loading')} /> {t('addons.loading')}
        </p>
      </div>
    );
  }

  if (addons.status === 'error') {
    return (
      <div className="space-y-4">
        {intro}
        <Alert tone="warning">
          <div className="space-y-2">
            <p>{t('addons.loadFailed')}</p>
            <p>{t('addons.loadFailedKept')}</p>
            <Button type="button" size="sm" variant="secondary" onClick={addons.retry}>
              {t('addons.retry')}
            </Button>
          </div>
        </Alert>
        {problem}
      </div>
    );
  }

  const rows = addonRows(addons.options, selected);
  const shown = filterAddonRows(rows, query);

  if (addons.options.length === 0) {
    return (
      <div className="space-y-4">
        {intro}
        {problem}
        {/* Stale selected ids (no option lists them) still get their rows, so they can be unticked. */}
        {rows.length > 0 && (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li key={row.id}>
                <AddonRowView
                  row={row}
                  checked={selected.includes(row.id)}
                  onChange={(on) => change(toggleAddon(selected, row.id, on))}
                />
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">{t('addons.empty')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('addons.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {intro}
      {problem}
      <ToolbarRow>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('addons.searchPlaceholder')}
          aria-label={t('addons.search')}
          className="min-w-0 flex-1 basis-48"
        />
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            change(
              selectAddons(
                selected,
                shown.map((r) => r.id),
              ),
            )
          }
        >
          {t('addons.selectAll')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            change(
              clearAddons(
                selected,
                shown.map((r) => r.id),
              ),
            )
          }
        >
          {t('addons.clear')}
        </Button>
      </ToolbarRow>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('addons.selected', { count: selected.length, total: addons.options.length })}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('addons.noMatch')}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((row) => (
            <li key={row.id}>
              <AddonRowView
                row={row}
                checked={selected.includes(row.id)}
                onChange={(on) => change(toggleAddon(selected, row.id, on))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddonRowView({
  row,
  checked,
  onChange,
}: {
  row: AddonRow;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(PLANS_NS);
  const locale = useLocale();

  if (row.kind === 'unknown') {
    return (
      <div className="rounded-md border border-warning p-3" data-testid={`plan-addon-${row.id}`}>
        <Checkbox
          id={`plan-addon-${row.id}`}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          label={
            <span className="block min-w-0 space-y-0.5">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">{t('addons.unknown')}</span>
                <Badge tone="danger">{t('addons.notOnSale')}</Badge>
              </span>
              <span
                dir="ltr"
                className="block break-all text-start font-mono text-xs text-muted-foreground"
              >
                {row.id}
              </span>
              <span className="block text-xs text-muted-foreground">{t('addons.unknownHint')}</span>
            </span>
          }
        />
      </div>
    );
  }

  const { option } = row;
  const sale = addonSaleState(option);
  const price = formatMoney(option.amount, option.currency, locale);
  const period = tp(`period.${option.billingUnit}`, { count: option.billingDuration });
  return (
    <div className="rounded-md border border-border p-3" data-testid={`plan-addon-${option.id}`}>
      <Checkbox
        id={`plan-addon-${option.id}`}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        label={
          <span className="block min-w-0 space-y-0.5">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{option.name}</span>
              {sale !== 'onSale' && <Badge tone="warning">{t('addons.notOnSale')}</Badge>}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t('addons.appLabel', { name: option.app.name })}
            </span>
            <span className="block text-xs font-medium">
              {t('addons.price', { price, period })}
            </span>
            {sale === 'packInactive' && (
              <span className="block text-xs text-warning">{t('addons.packInactive')}</span>
            )}
            {sale === 'appUnpublished' && (
              <span className="block text-xs text-warning">{t('addons.appUnpublished')}</span>
            )}
          </span>
        }
      />
    </div>
  );
}
