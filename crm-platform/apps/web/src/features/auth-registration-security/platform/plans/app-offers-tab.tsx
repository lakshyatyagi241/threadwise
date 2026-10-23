'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import {
  PLAN_ADDON_OFFER_MODES,
  type PlanAddonOfferMode,
  type PlanAddonOption,
} from '@crm/contracts';
import { Alert, Badge, Button, Input, Spinner } from '@crm/ui';
import { SegmentedChoice } from '../ui/segmented-choice';
import { formatMoney } from '../../account/plans/plan-format';
import { appModeFor, appsOfferedCount, setAppOffer, setAppOffers } from '../lib/plan-draft';
import {
  addonSaleState,
  appOptionsFor,
  filterAppOptions,
  type AppTab,
} from '../lib/plan-editor-view';
import type { AddonOptionsState } from './addons-tab';
import { NS, ToolbarRow, fieldId, type EditorState } from './plan-editor-shared';

const PLANS_NS = 'auth-registration-security.platform.plans';

/**
 * The Integrations and Mini apps tabs (docs/specs/addons-plan-offers.md 3): the Marketplace app packs of one kind, each with the same
 * Included | Paid | Hidden choice a plain add-on has. An app keeps its own price (set on its Marketplace listing), so there is no price box:
 * Paid is "visible and buyable at the app's price", Included is "visible and free" (the API also switches on the plan features the app
 * grants), Hidden is "not visible". The draft keeps `visibleAddons` and the Included offer rows in step (see `setAppOffer`).
 */
export function AppOffersTab({
  tab,
  state,
  addons,
  readOnly = false,
  onTouched,
}: {
  tab: AppTab;
  state: EditorState;
  addons: AddonOptionsState;
  /** An operator who may read but not edit plans: every control is disabled and says why. */
  readOnly?: boolean;
  /** Called on any change: the editor then always sends the app selection (see buildPlanRequest). */
  onTouched: () => void;
}) {
  const t = useTranslations(NS);
  const { draft, err, set } = state;
  const [query, setQuery] = useState('');
  const integrations = tab === 'integrations';

  const intro = (
    <p className="text-xs text-muted-foreground">
      {t(integrations ? 'apps.introIntegrations' : 'apps.introMiniApps')}
    </p>
  );
  const lock = readOnly && <Alert tone="info">{t('offers.readOnly')}</Alert>;

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
      </div>
    );
  }

  const options = appOptionsFor(addons.options, tab);
  const shown = filterAppOptions(options, query);

  const apply = (next: typeof draft) => {
    if (readOnly || next === draft) return;
    onTouched();
    set('addonOffers', next.addonOffers);
    set('visibleAddons', next.visibleAddons);
  };

  if (options.length === 0) {
    return (
      <div className="space-y-4">
        {intro}
        {lock}
        <div className="rounded-md border border-dashed border-border p-6 text-center">
          <p className="text-sm font-medium">
            {t(integrations ? 'apps.emptyIntegrations' : 'addons.empty')}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(integrations ? 'apps.emptyIntegrationsHint' : 'addons.emptyHint')}
          </p>
        </div>
      </div>
    );
  }

  const ids = options.map((o) => o.id);
  return (
    <div className="space-y-4" data-testid={`plan-apps-${tab}`}>
      {intro}
      {lock}
      <ToolbarRow>
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('addons.searchPlaceholder')}
          aria-label={t('addons.search')}
          className="min-w-0 flex-1 basis-48"
        />
        <div
          role="group"
          aria-label={t('apps.setAll')}
          className="flex flex-wrap items-center gap-1"
          data-testid={`plan-apps-${tab}-bulk`}
        >
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {t('apps.setAll')}
          </span>
          {PLAN_ADDON_OFFER_MODES.map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant="ghost"
              disabled={readOnly || shown.length === 0}
              data-testid={`plan-apps-${tab}-all-${mode}`}
              onClick={() =>
                apply(
                  setAppOffers(
                    draft,
                    shown.map((o) => o.id),
                    mode,
                  ),
                )
              }
            >
              {t(`offers.modes.${mode}`)}
            </Button>
          ))}
        </div>
      </ToolbarRow>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {t('apps.summary', { count: appsOfferedCount(draft, ids), total: options.length })}
      </p>
      {shown.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('addons.noMatch')}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((option) => (
            <li key={option.id}>
              <AppRow
                option={option}
                mode={appModeFor(draft, option.id)}
                error={err(`addonOffers.${option.id}`)}
                disabled={readOnly}
                onChange={(mode) => apply(setAppOffer(draft, option.id, mode))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AppRow({
  option,
  mode,
  error,
  disabled,
  onChange,
}: {
  option: PlanAddonOption;
  mode: PlanAddonOfferMode;
  error: string | undefined;
  disabled: boolean;
  onChange: (mode: PlanAddonOfferMode) => void;
}) {
  const t = useTranslations(NS);
  const tp = useTranslations(PLANS_NS);
  const locale = useLocale();
  const sale = addonSaleState(option);
  const price = formatMoney(option.amount, option.currency, locale);
  const period = tp(`period.${option.billingUnit}`, { count: option.billingDuration });
  const hintId = `plan-app-${option.id}-hint`;
  return (
    <div
      className="space-y-2 rounded-md border border-border p-3"
      data-testid={`plan-addon-${option.id}`}
      data-kind={option.app.kind}
      data-mode={mode}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 basis-48 space-y-0.5">
          <p className="flex flex-wrap items-center gap-1.5 text-sm">
            <span className="font-medium">{option.name}</span>
            {sale !== 'onSale' && <Badge tone="warning">{t('addons.notOnSale')}</Badge>}
          </p>
          <p className="text-xs text-muted-foreground">
            {t('addons.appLabel', { name: option.app.slug })}
          </p>
          <p className="text-xs font-medium">{t('addons.price', { price, period })}</p>
          {sale === 'packInactive' && (
            <p className="text-xs text-warning">{t('addons.packInactive')}</p>
          )}
          {sale === 'appUnpublished' && (
            <p className="text-xs text-warning">{t('addons.appUnpublished')}</p>
          )}
        </div>
        <SegmentedChoice
          name={`plan-app-${option.id}`}
          label={t('offers.modeLabel', { name: option.name })}
          value={mode}
          options={PLAN_ADDON_OFFER_MODES.map((m) => ({ value: m, label: t(`offers.modes.${m}`) }))}
          onChange={onChange}
          disabled={disabled}
          describedBy={hintId}
          testId={`plan-app-offer-${option.id}`}
        />
      </div>
      <p id={hintId} className="text-xs text-muted-foreground">
        {t('apps.priceHint')}
      </p>
      {error && (
        <p
          id={fieldId(`addonOffers.${option.id}`)}
          tabIndex={-1}
          role="alert"
          className="text-xs text-danger"
        >
          {error}
        </p>
      )}
    </div>
  );
}
