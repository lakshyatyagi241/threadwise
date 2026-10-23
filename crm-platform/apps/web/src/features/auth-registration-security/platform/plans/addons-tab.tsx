'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  addonKindOf,
  type AddonPack,
  type PlanAddonOfferMode,
  type PlanAddonOption,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Input, Spinner } from '@crm/ui';
import { SegmentedChoice } from '../ui/segmented-choice';
import { formatMoney } from '../../account/plans/plan-format';
import {
  addonsSelectedCount,
  clearAddons,
  offerFor,
  offerModesFor,
  selectAddons,
  setAddonOffer,
  setAddonOfferAmount,
  toggleAddon,
  unlistedPackFeatures,
  type PlanDraft,
} from '../lib/plan-draft';
import { addonRows, addonSaleState, filterAddonRows, type AddonRow } from '../lib/plan-editor-view';
import { NS, Section, ToolbarRow, fieldId, type EditorState } from './plan-editor-shared';

const PLANS_NS = 'auth-registration-security.platform.plans';

export interface AddonOptionsState {
  status: 'pending' | 'error' | 'success';
  options: readonly PlanAddonOption[];
  retry: () => void;
}

/** The plain add-on packs (Smart routing, Teams and permissions, Extra seat...) a plan offers, plus the renewal figures for THIS plan. */
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
 * The Add-ons tab (docs/specs/addons-plan-offers.md 3), three sections:
 *   1. Feature add-ons (packs that grant a feature) and 2. Capacity add-ons (limits only): one row per plain pack with Included | Paid |
 *      Hidden (a capacity add-on has no Included: the plan sets its own cap on the Limits tab) and, when Paid, an optional price of this
 *      plan's own. The mode is what is saved; choosing it also sets the pack's feature keys in the draft, which the Features tab shows locked.
 *   3. Mini apps offered on this plan: the Marketplace packs this plan makes visible. Visible is not usable: a workspace still has to buy
 *      the app. A selected id the options no longer list stays as an "Unknown add-on" row so it can be unticked.
 */
export function AddonsTab({
  state,
  addons,
  included,
  savedOffers,
  readOnly = false,
  onTouched,
}: {
  state: EditorState;
  addons: AddonOptionsState;
  included: IncludedPacksState;
  /** The plan's offers as the editor opened (what is saved today), to word the "no longer included" consequence. */
  savedOffers: PlanDraft['addonOffers'];
  /** An operator who may read but not edit plans: every control is disabled and says why. */
  readOnly?: boolean;
  /** Called on any change to the mini apps: the editor then always sends that selection (see buildPlanRequest). */
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const total = addonsSelectedCount(state.draft, included.packs);
  return (
    <div className="space-y-6">
      <p className="text-sm font-medium" aria-live="polite">
        {t('addons.total', { count: total })}
      </p>
      {readOnly && <Alert tone="info">{t('offers.readOnly')}</Alert>}
      <PlainAddons
        state={state}
        included={included}
        savedOffers={savedOffers}
        readOnly={readOnly}
      />
      <Section title={t('marketplace.title')}>
        <MarketplaceAddons
          state={state}
          addons={addons}
          readOnly={readOnly}
          onTouched={onTouched}
        />
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

function PlainAddons({
  state,
  included,
  savedOffers,
  readOnly,
}: {
  state: EditorState;
  included: IncludedPacksState;
  savedOffers: PlanDraft['addonOffers'];
  readOnly: boolean;
}) {
  const t = useTranslations(NS);
  const general = state.err('addonOffers');
  const problem = general && (
    <p id={fieldId('addonOffers')} tabIndex={-1} role="alert" className="text-xs text-danger">
      {general}
    </p>
  );
  if (included.status !== 'success') {
    return (
      <Section title={t('offers.featureTitle')} description={t('offers.featureIntro')}>
        {problem}
        {included.status === 'pending' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner label={t('offers.loading')} /> {t('offers.loading')}
          </p>
        ) : (
          <Alert tone="warning">
            <div className="space-y-2">
              <p>{t('offers.loadFailed')}</p>
              <Button type="button" size="sm" variant="secondary" onClick={included.retry}>
                {t('addons.retry')}
              </Button>
            </div>
          </Alert>
        )}
      </Section>
    );
  }

  const feature = included.packs.filter((p) => addonKindOf(p.grants) === 'feature');
  const capacity = included.packs.filter((p) => addonKindOf(p.grants) === 'capacity');
  const rows = (packs: readonly AddonPack[]) => (
    <ul className="space-y-2">
      {packs.map((pack) => (
        <li key={pack.id}>
          <OfferRow
            pack={pack}
            packs={included.packs}
            state={state}
            saved={savedOffers[pack.id]?.mode ?? 'paid'}
            renewing={included.impact === null ? null : (included.impact.get(pack.id) ?? 0)}
            readOnly={readOnly}
          />
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <Section title={t('offers.featureTitle')} description={t('offers.featureIntro')}>
        {problem}
        {included.packs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-sm font-medium">{t('offers.empty')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('offers.emptyHint')}</p>
          </div>
        ) : feature.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('offers.noFeaturePacks')}</p>
        ) : (
          rows(feature)
        )}
      </Section>
      {capacity.length > 0 && (
        <Section title={t('offers.capacityTitle')} description={t('offers.capacityIntro')}>
          {rows(capacity)}
        </Section>
      )}
    </>
  );
}

function OfferRow({
  pack,
  packs,
  state,
  saved,
  renewing,
  readOnly,
}: {
  pack: AddonPack;
  /** Every listed pack: a feature key two packs share stays on while one of them is included. */
  packs: readonly AddonPack[];
  state: EditorState;
  /** The mode stored today (paid when no row). */
  saved: PlanAddonOfferMode;
  /** Workspaces on this plan that still pay for the pack; null = not known. */
  renewing: number | null;
  readOnly: boolean;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(PLANS_NS);
  const locale = useLocale();
  const { draft, set, err } = state;

  const offer = offerFor(draft, pack.id);
  const modes = offerModesFor(pack);
  const isCapacity = !modes.includes('included');
  const limitEntries = Object.entries(pack.grants.limits);
  const unlisted = unlistedPackFeatures(pack);
  const featureLabel = (k: string) =>
    (PLAN_FEATURE_KEYS as readonly string[]).includes(k) ? t(`featureKeys.${k}`) : spelled(k);
  const limitLabel = (k: string) =>
    (PLAN_LIMIT_KEYS as readonly string[]).includes(k) ? t(`limitKeys.${k}`) : spelled(k);
  const limitText = ([k, v]: [string, number]) =>
    v === -1
      ? t('offers.limitUnlimited', { name: limitLabel(k) })
      : t('offers.limitAdd', { amount: v, name: limitLabel(k) });
  const list = (items: string[]) => items.join(', ');
  const listPrice = pack.offerAmount ?? pack.amount;
  const price = pack.isFree
    ? t('offers.noPrice')
    : t('addons.price', {
        price: formatMoney(listPrice, pack.currency, locale),
        period: tp(`period.${pack.billingUnit}`, { count: pack.billingDuration }),
      });
  const choose = (mode: PlanAddonOfferMode) => {
    if (readOnly) return;
    const next = setAddonOffer(draft, pack, mode, packs);
    if (next === draft) return;
    set('addonOffers', next.addonOffers);
    set('features', next.features);
  };
  const priceId = fieldId(`addonOffers.${pack.id}`);
  const priceError = err(`addonOffers.${pack.id}`);
  const reasonId = `plan-offer-${pack.id}-reason`;
  // A pack that also sells a cap is never ended by inclusion (the renewal-stop job only ends packs whose every grant the plan covers).
  const stopsRenewals = limitEntries.length === 0;
  const isIncluded = offer.mode === 'included';

  const notes: ReactNode[] = [];
  if (isIncluded && limitEntries.length > 0)
    notes.push(t('offers.includedCapacityNote', { limits: list(limitEntries.map(limitText)) }));
  if (offer.mode === 'hidden') notes.push(t('offers.hiddenNote'));
  // No offer stored or chosen yet, but the plan already carries some of the pack's features: they are kept until the operator chooses.
  const partly =
    pack.id in draft.addonOffers
      ? []
      : pack.grants.features.filter((k) => draft.features[k] === true);
  if (partly.length > 0)
    notes.push(t('offers.partlyNote', { features: list(partly.map(featureLabel)) }));
  if (unlisted.length > 0)
    notes.push(t('offers.unlistedNote', { features: list(unlisted.map(featureLabel)) }));
  if (!pack.isActive) notes.push(t('offers.inactiveNote'));

  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-testid={`plan-pack-${pack.id}`}
      data-kind={isCapacity ? 'capacity' : 'feature'}
      data-mode={offer.mode}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48 space-y-0.5">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium" id={`plan-offer-${pack.id}-name`}>
              {pack.name}
            </span>
            {!pack.isActive && <Badge tone="warning">{t('addons.notOnSale')}</Badge>}
          </p>
          {pack.grants.features.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('offers.gives', { features: list(pack.grants.features.map(featureLabel)) })}
            </p>
          )}
          {limitEntries.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('offers.adds', { limits: list(limitEntries.map(limitText)) })}
            </p>
          )}
          <p className="text-xs font-medium">{price}</p>
        </div>
        <SegmentedChoice
          name={`plan-offer-${pack.id}`}
          label={t('offers.modeLabel', { name: pack.name })}
          value={offer.mode}
          options={modes.map((m) => ({ value: m, label: t(`offers.modes.${m}`) }))}
          onChange={choose}
          disabled={readOnly}
          describedBy={isCapacity ? reasonId : undefined}
          testId={`plan-offer-${pack.id}`}
        />
      </div>

      {isCapacity && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {t('offers.noIncluded')}
        </p>
      )}

      {offer.mode === 'paid' && (
        <div className="space-y-1">
          <label htmlFor={priceId} className="block text-xs font-medium">
            {t('offers.priceLabel', { currency: pack.currency })}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={priceId}
              dir="ltr"
              inputMode="decimal"
              className="h-9 w-32 text-start font-mono"
              placeholder={listPrice}
              value={offer.amount}
              disabled={readOnly}
              invalid={!!priceError}
              aria-describedby={`${priceId}-hint`}
              onChange={(e) =>
                set('addonOffers', setAddonOfferAmount(draft, pack.id, e.target.value).addonOffers)
              }
            />
            <span className="font-mono text-xs text-muted-foreground" dir="ltr">
              {pack.currency}
            </span>
          </div>
          <p id={`${priceId}-hint`} className="text-xs text-muted-foreground">
            {t('offers.priceHint')}
          </p>
          {priceError && (
            <p role="alert" className="text-xs text-danger">
              {priceError}
            </p>
          )}
        </div>
      )}
      {offer.mode !== 'paid' && priceError && (
        <p id={priceId} tabIndex={-1} role="alert" className="text-xs text-danger">
          {priceError}
        </p>
      )}

      <div className="space-y-1 text-xs text-muted-foreground">
        {notes.map((n, i) => (
          <p key={i}>{n}</p>
        ))}
        {isIncluded && stopsRenewals && renewing !== null && renewing > 0 && (
          <p className="text-foreground" role="status">
            {t('offers.impactCount', { count: renewing })}
          </p>
        )}
        {isIncluded && stopsRenewals && renewing === null && saved !== 'included' && (
          <p>{t('offers.impactUnknown')}</p>
        )}
        {!isIncluded && saved === 'included' && <p role="status">{t('offers.offNote')}</p>}
      </div>
    </div>
  );
}
