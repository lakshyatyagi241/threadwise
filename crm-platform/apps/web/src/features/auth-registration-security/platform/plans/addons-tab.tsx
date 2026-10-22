'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { PLAN_FEATURE_KEYS, PLAN_LIMIT_KEYS, type AddonPack, type PlanAddonOption } from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Input, Spinner, Switch } from '@crm/ui';
import { formatMoney } from '../../account/plans/plan-format';
import {
  addonsSelectedCount,
  clearAddons,
  packCoverage,
  selectAddons,
  setPackIncluded,
  toggleAddon,
  unlistedPackFeatures,
  type PlanDraft,
} from '../lib/plan-draft';
import { addonRows, addonSaleState, filterAddonRows, type AddonRow } from '../lib/plan-editor-view';
import { NS, Section, ToolbarRow, type EditorState } from './plan-editor-shared';

const PLANS_NS = 'auth-registration-security.platform.plans';

export interface AddonOptionsState {
  status: 'pending' | 'error' | 'success';
  options: readonly PlanAddonOption[];
  retry: () => void;
}

/** The plain add-on packs (Smart routing, Teams and permissions...) a plan can include, plus the renewal figures for THIS plan. */
export interface IncludedPacksState {
  status: 'pending' | 'error' | 'success';
  packs: readonly AddonPack[];
  retry: () => void;
  /**
   * Pack id -> workspaces on this plan that still pay for it (a renewing subscription). `null` when it is not known: the plan is new
   * (nobody is on it) or the figure could not be loaded, and the row then says so in words instead of showing a number.
   */
  impact: ReadonlyMap<string, number> | null;
}

/**
 * The Add-ons tab, two kinds of add-on kept visibly apart:
 *   1. Included add-ons: the plain packs (no Marketplace app). A switch per pack ticks or clears exactly the feature keys the pack
 *      grants on the Features tab; the switch is derived from those keys, so the two tabs always agree. Not included = priced and buyable.
 *   2. Marketplace apps offered to workspaces on this plan: the paid packs this plan makes visible. Visible is not usable: a
 *      workspace still has to buy the add-on. A selected id the options no longer list stays as an "Unknown add-on" row so it can be unticked.
 */
export function AddonsTab({
  state,
  addons,
  included,
  savedFeatures,
  readOnly = false,
  onTouched,
}: {
  state: EditorState;
  addons: AddonOptionsState;
  included: IncludedPacksState;
  /** The plan's features as the editor opened (what is saved today), to word the "switching off" consequence. */
  savedFeatures: PlanDraft['features'];
  /** An operator who may read but not edit plans: every switch is disabled and says why. */
  readOnly?: boolean;
  /** Called on any change here: the editor then always sends the selection (see buildPlanRequest). */
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const total = addonsSelectedCount(state.draft, included.packs);
  return (
    <div className="space-y-6">
      <p className="text-sm font-medium" aria-live="polite">
        {t('addons.total', { count: total })}
      </p>
      {readOnly && <Alert tone="info">{t('included.readOnly')}</Alert>}
      <Section title={t('included.title')} description={t('included.intro')}>
        <IncludedPacks
          state={state}
          included={included}
          savedFeatures={savedFeatures}
          readOnly={readOnly}
        />
      </Section>
      <Section title={t('marketplace.title')}>
        <MarketplaceAddons state={state} addons={addons} readOnly={readOnly} onTouched={onTouched} />
      </Section>
    </div>
  );
}

function MarketplaceAddons({
  state,
  addons,
  readOnly,
  onTouched,
}: {
  state: EditorState;
  addons: AddonOptionsState;
  readOnly: boolean;
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const { draft, err, set } = state;
  const [query, setQuery] = useState('');
  const selected = draft.visibleAddons;
  const error = err('visibleAddons');

  const change = (ids: string[]) => {
    if (readOnly) return;
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
                  disabled={readOnly}
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
          disabled={readOnly}
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
          disabled={readOnly}
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
                disabled={readOnly}
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
  disabled,
  onChange,
}: {
  row: AddonRow;
  disabled: boolean;
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
          disabled={disabled}
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
        disabled={disabled}
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

/** "inbox_routing" -> "Inbox routing": the label of a pack key the registry has no title for (a module's own flag). */
const spelled = (k: string) => k.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function IncludedPacks({
  state,
  included,
  savedFeatures,
  readOnly,
}: {
  state: EditorState;
  included: IncludedPacksState;
  savedFeatures: PlanDraft['features'];
  readOnly: boolean;
}) {
  const t = useTranslations(NS);
  if (included.status === 'pending') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={t('included.loading')} /> {t('included.loading')}
      </p>
    );
  }
  if (included.status === 'error') {
    return (
      <Alert tone="warning">
        <div className="space-y-2">
          <p>{t('included.loadFailed')}</p>
          <Button type="button" size="sm" variant="secondary" onClick={included.retry}>
            {t('addons.retry')}
          </Button>
        </div>
      </Alert>
    );
  }
  if (included.packs.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-6 text-center">
        <p className="text-sm font-medium">{t('included.empty')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('included.emptyHint')}</p>
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {included.packs.map((pack) => (
        <li key={pack.id}>
          <PackRow
            pack={pack}
            state={state}
            savedFeatures={savedFeatures}
            renewing={included.impact === null ? null : (included.impact.get(pack.id) ?? 0)}
            readOnly={readOnly}
          />
        </li>
      ))}
    </ul>
  );
}

function PackRow({
  pack,
  state,
  savedFeatures,
  renewing,
  readOnly,
}: {
  pack: AddonPack;
  state: EditorState;
  savedFeatures: PlanDraft['features'];
  /** Workspaces on this plan that still pay for the pack; null = not known. */
  renewing: number | null;
  readOnly: boolean;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(PLANS_NS);
  const locale = useLocale();
  const { draft, set } = state;

  const coverage = packCoverage(pack, draft.features);
  const wasIncluded = packCoverage(pack, savedFeatures).state === 'full';
  const on = coverage.state === 'full';
  const limitKeys = Object.keys(pack.grants.limits);
  const unlisted = unlistedPackFeatures(pack);
  const featureLabel = (k: string) =>
    (PLAN_FEATURE_KEYS as readonly string[]).includes(k) ? t(`featureKeys.${k}`) : spelled(k);
  const limitLabel = (k: string) =>
    (PLAN_LIMIT_KEYS as readonly string[]).includes(k) ? t(`limitKeys.${k}`) : spelled(k);
  const list = (items: string[]) => items.join(', ');
  const price = pack.isFree
    ? t('included.noPrice')
    : t('addons.price', {
        price: formatMoney(pack.amount, pack.currency, locale),
        period: tp(`period.${pack.billingUnit}`, { count: pack.billingDuration }),
      });
  const apply = (next: boolean) => {
    if (readOnly) return;
    set('features', setPackIncluded(draft, pack, next).features);
  };
  // A pack that also sells a cap is never ended by inclusion (the renewal-stop job only ends packs whose every grant the plan covers).
  const stopsRenewals = limitKeys.length === 0;

  const badge =
    coverage.state === 'full' ? (
      <Badge tone="success">{t('included.stateFull')}</Badge>
    ) : coverage.state === 'partial' ? (
      <Badge tone="warning">{t('included.statePartial')}</Badge>
    ) : (
      <Badge tone="neutral">{t('included.stateNone')}</Badge>
    );

  return (
    <div
      className="rounded-md border border-border p-3"
      data-testid={`plan-pack-${pack.id}`}
      data-coverage={coverage.state}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <label htmlFor={`plan-pack-${pack.id}-switch`} className="block cursor-pointer text-sm">
            <span className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{pack.name}</span>
              {badge}
              {!pack.isActive && <Badge tone="warning">{t('addons.notOnSale')}</Badge>}
            </span>
          </label>
          {coverage.total > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('included.gives', { features: list(pack.grants.features.map(featureLabel)) })}
            </p>
          )}
          <p className="text-xs font-medium">{price}</p>
        </div>
        <Switch
          id={`plan-pack-${pack.id}-switch`}
          checked={on}
          onCheckedChange={apply}
          label={t('included.switchLabel', { name: pack.name })}
          disabled={readOnly || coverage.state === 'noFeatures'}
        />
      </div>

      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
        {coverage.state === 'noFeatures' && <p>{t('included.noFeatures')}</p>}
        {coverage.state === 'partial' && (
          <div className="space-y-1.5">
            <p className="text-warning">
              {t('included.partial', {
                count: coverage.on,
                total: coverage.total,
                missing: list(coverage.missing.map(featureLabel)),
              })}
            </p>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={readOnly}
              onClick={() => apply(true)}
            >
              {t('included.includeFully')}
            </Button>
          </div>
        )}
        {limitKeys.length > 0 && (
          <p>{t('included.limitsNote', { limits: list(limitKeys.map(limitLabel)) })}</p>
        )}
        {unlisted.length > 0 && (
          <p>{t('included.unlistedNote', { features: list(unlisted.map(featureLabel)) })}</p>
        )}
        {!pack.isActive && <p>{t('included.inactiveNote')}</p>}
        {on && stopsRenewals && renewing !== null && renewing > 0 && (
          <p className="text-foreground" role="status">
            {t('included.impactCount', { count: renewing })}
          </p>
        )}
        {on && stopsRenewals && renewing === null && wasIncluded === false && (
          <p>{t('included.impactUnknown')}</p>
        )}
        {!on && wasIncluded && <p role="status">{t('included.offNote')}</p>}
      </div>
    </div>
  );
}
