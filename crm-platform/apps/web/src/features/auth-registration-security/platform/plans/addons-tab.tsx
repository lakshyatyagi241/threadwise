'use client';

import { useLocale, useTranslations } from 'next-intl';
import { type ReactNode } from 'react';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  type AddonPack,
  type PlanAddonOfferMode,
  type PlanAddonOption,
} from '@crm/contracts';
import { Alert, Badge, Button, Checkbox, Input, Spinner } from '@crm/ui';
import { SegmentedChoice } from '../ui/segmented-choice';
import { formatMoney } from '../../account/plans/plan-format';
import {
  canIncludePack,
  offerFor,
  offerModesFor,
  packKind,
  packsOfferedCount,
  setAddonOffer,
  setAddonOfferAmount,
  toggleAddon,
  unlistedPackFeatures,
  type PlanDraft,
  type PlanField,
} from '../lib/plan-draft';
import { staleAppIds } from '../lib/plan-editor-view';
import { NS, Section, fieldId, type EditorState } from './plan-editor-shared';

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
 * The Add-ons tab (docs/specs/addons-plan-offers.md 3): the plain add-on packs only, in two sections.
 *   1. Feature add-ons and 2. Capacity add-ons, by the kind the operator stored on the pack (Smart routing is a feature add-on even
 *      before it has features): one row each with Included | Paid | Hidden (a capacity add-on has no Included: the plan sets its own cap
 *      on the Limits tab; a feature add-on with no features yet cannot be included either) and, when Paid, an optional price of this
 *      plan's own. The mode is what is saved; choosing it also sets the pack's feature keys in the draft, which the Features tab shows locked.
 * Marketplace apps have their own tabs (Integrations, Mini apps). The only app thing left here is a selected id that no app lists any more,
 * so it can still be removed.
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
  /** Called when a stale selected id is removed: the editor then always sends that selection (see buildPlanRequest). */
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const total = packsOfferedCount(state.draft, included.packs);
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
      <StaleAddons
        state={state}
        addons={addons}
        packIds={included.packs.map((p) => p.id)}
        readOnly={readOnly}
        onTouched={onTouched}
      />
    </div>
  );
}

/**
 * What the plan still holds that nothing lists: a selected id that no app option has (a deleted pack) and the API's message about it, or an
 * offer error naming an add-on that is on no tab. Renders nothing when there is none.
 */
function StaleAddons({
  state,
  addons,
  packIds,
  readOnly,
  onTouched,
}: {
  state: EditorState;
  addons: AddonOptionsState;
  packIds: readonly string[];
  readOnly: boolean;
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const { draft, err, set } = state;
  const error = err('visibleAddons');
  const stale = addons.status === 'success' ? staleAppIds(addons.options, draft.visibleAddons) : [];
  // An offer error on an id that is no pack and no app (it was deleted meanwhile) has no row of its own: say it here.
  const known = new Set([...packIds, ...addons.options.map((o) => o.id)]);
  const stray = (Object.keys(state.problems) as PlanField[]).filter(
    (f) => f.startsWith('addonOffers.') && !known.has(f.slice('addonOffers.'.length)),
  );
  if (!error && stale.length === 0 && stray.length === 0) return null;
  return (
    <div className="space-y-2" data-testid="plan-stale-addons">
      {stray.map((f) => (
        <p key={f} id={fieldId(f)} tabIndex={-1} role="alert" className="text-xs text-danger">
          {err(f)}
        </p>
      ))}
      {error && (
        <p id="plan-visibleAddons" tabIndex={-1} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {stale.map((id) => (
          <li key={id}>
            <div className="rounded-md border border-warning p-3" data-testid={`plan-addon-${id}`}>
              <Checkbox
                id={`plan-addon-${id}`}
                checked
                disabled={readOnly}
                onChange={() => {
                  if (readOnly) return;
                  onTouched();
                  set('visibleAddons', toggleAddon(draft.visibleAddons, id, false));
                }}
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
                      {id}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('addons.unknownHint')}
                    </span>
                  </span>
                }
              />
            </div>
          </li>
        ))}
      </ul>
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

  const feature = included.packs.filter((p) => packKind(p) === 'feature');
  const capacity = included.packs.filter((p) => packKind(p) === 'capacity');
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
  const isCapacity = packKind(pack) === 'capacity';
  // A feature add-on that unlocks nothing yet has nothing to include: the option stays visible but cannot be chosen, and says why.
  const needsFeatures = !isCapacity && !canIncludePack(pack);
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
          options={modes.map((m) => ({
            value: m,
            label: t(`offers.modes.${m}`),
            disabled: m === 'included' && needsFeatures,
          }))}
          onChange={choose}
          disabled={readOnly}
          describedBy={isCapacity || needsFeatures ? reasonId : undefined}
          testId={`plan-offer-${pack.id}`}
        />
      </div>

      {isCapacity && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {t('offers.noIncluded')}
        </p>
      )}
      {needsFeatures && (
        <p id={reasonId} className="text-xs text-muted-foreground">
          {t('offers.needsFeatures', { name: pack.name })}
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
