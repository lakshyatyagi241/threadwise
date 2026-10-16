'use client';

import { useTranslations } from 'next-intl';
import {
  MARKET_TRIAL_DAYS_MAX,
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  type PlanFeatureKey,
} from '@crm/contracts';
import { Checkbox, Field, Input, Select, Switch, cn } from '@crm/ui';
import {
  COMMON_CURRENCIES,
  ownableFeatureKeys,
  type PricingDraft,
  type PricingField,
} from '../lib/pricing';

const NS = 'marketplace.operator.pricing';

/** A plan the "minimum plan" select offers: the operator's plan list gives more, this is what the field needs. */
export interface PlanChoice {
  slug: string;
  name: string;
}

/**
 * The editable part of the pricing form: the free or paid choice and, for a paid app, the price, currency, trial, yearly price, sale
 * switch, the plans that get it free and the plan features it grants. It holds no state: the panel owns the draft, and `errors` is the text
 * to show beside each field (the server's refusal wins over the form's own check, which the panel decides).
 */
export function PricingFields({
  idBase,
  draft,
  errors,
  disabled,
  canGrant,
  planList,
  onChange,
}: {
  idBase: string;
  draft: PricingDraft;
  errors: Partial<Record<PricingField, string>>;
  /** Read-only (no `platform.market.pricing`) or a save in flight. */
  disabled: boolean;
  /** Only a first-party listing may grant plan features. */
  canGrant: boolean;
  /** The operator's plans, lowest first; null while loading or when the list could not be loaded (the field is typed then). */
  planList: readonly PlanChoice[] | null;
  onChange: (patch: Partial<PricingDraft>) => void;
}) {
  const t = useTranslations(NS);
  const id = (name: string) => `${idBase}-${name}`;
  const paid = draft.model === 'paid_monthly';
  const featureChoices = [...new Set([...ownableFeatureKeys(), ...draft.grantsPlanFeatures])];
  const knownPlan = planList?.some((p) => p.slug === draft.includedMinPlan) ?? false;

  const toggleGrant = (key: string, on: boolean) => {
    const next = on
      ? [...draft.grantsPlanFeatures, key]
      : draft.grantsPlanFeatures.filter((k) => k !== key);
    onChange({
      grantsPlanFeatures: next,
      // Without a granted feature there are no "existing users" to comp.
      ...(next.length === 0 ? { grandfatherExisting: false } : {}),
    });
  };

  return (
    <fieldset className="min-w-0 space-y-5" disabled={disabled}>
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-1 text-sm font-medium">{t('model.legend')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['free', 'paid_monthly'] as const).map((m) => (
            <label
              key={m}
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                draft.model === m ? 'border-primary bg-primary/5' : 'border-border',
                disabled && 'cursor-not-allowed opacity-70',
              )}
            >
              <input
                type="radio"
                name={id('model')}
                value={m}
                checked={draft.model === m}
                onChange={() => onChange({ model: m })}
                className="mt-0.5 size-4 accent-[var(--primary)]"
              />
              <span>
                <span className="block font-medium">
                  {m === 'free' ? t('model.free') : t('model.paid')}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {m === 'free' ? t('model.freeHint') : t('model.paidHint')}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {paid && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('fields.amount')}
              htmlFor={id('amount')}
              hint={t('fields.amountHint')}
              error={errors.amount}
            >
              <Input
                id={id('amount')}
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                placeholder="9.00"
                value={draft.amount}
                invalid={!!errors.amount}
                onChange={(e) => onChange({ amount: e.target.value })}
              />
            </Field>
            <Field
              label={t('fields.currency')}
              htmlFor={id('currency')}
              hint={t('fields.currencyHint')}
              error={errors.currency}
            >
              <Input
                id={id('currency')}
                list={id('currencies')}
                dir="ltr"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={3}
                placeholder="USD"
                value={draft.currency}
                invalid={!!errors.currency}
                onChange={(e) => onChange({ currency: e.target.value })}
              />
              <datalist id={id('currencies')}>
                {COMMON_CURRENCIES.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
            <Field
              label={t('fields.trialDays')}
              htmlFor={id('trial')}
              hint={t('fields.trialDaysHint', { max: MARKET_TRIAL_DAYS_MAX })}
              error={errors.trialDays}
            >
              <Input
                id={id('trial')}
                type="number"
                inputMode="numeric"
                min={0}
                max={MARKET_TRIAL_DAYS_MAX}
                step={1}
                value={draft.trialDays}
                invalid={!!errors.trialDays}
                onChange={(e) => onChange({ trialDays: e.target.value })}
              />
            </Field>
            <Field
              label={t('fields.annualAmount')}
              htmlFor={id('annual')}
              hint={t('fields.annualAmountHint')}
              error={errors.annualAmount}
            >
              <Input
                id={id('annual')}
                inputMode="decimal"
                dir="ltr"
                autoComplete="off"
                value={draft.annualAmount}
                invalid={!!errors.annualAmount}
                onChange={(e) => onChange({ annualAmount: e.target.value })}
              />
            </Field>
          </div>

          <fieldset className="min-w-0 space-y-2" data-testid="pricing-billing-mode">
            <legend className="mb-1 text-sm font-medium">{t('billingMode.legend')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['one_time', 'recurring'] as const).map((m) => (
                <label
                  key={m}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary',
                    draft.billingMode === m ? 'border-primary bg-primary/5' : 'border-border',
                    disabled && 'cursor-not-allowed opacity-70',
                  )}
                >
                  <input
                    type="radio"
                    name={id('billing-mode')}
                    value={m}
                    checked={draft.billingMode === m}
                    onChange={() => onChange({ billingMode: m })}
                    className="mt-0.5 size-4 accent-[var(--primary)]"
                  />
                  <span>
                    <span className="block font-medium">{t(`billingMode.${m}.label`)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t(`billingMode.${m}.hint`)}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t('billingMode.note')}</p>
          </fieldset>

          <Checkbox
            id={id('price-lock')}
            label={
              <span>
                {t('priceLock.label')}
                <span className="block text-xs text-muted-foreground">{t('priceLock.hint')}</span>
              </span>
            }
            checked={draft.priceLock}
            onChange={(e) => onChange({ priceLock: e.target.checked })}
          />

          <div className="flex items-start gap-3">
            <Switch
              id={id('on-sale')}
              checked={draft.purchasable}
              label={t('fields.purchasable')}
              onCheckedChange={(purchasable) => onChange({ purchasable })}
            />
            <div className="space-y-0.5 text-sm">
              <label htmlFor={id('on-sale')} className="font-medium">
                {t('fields.purchasable')}
              </label>
              <p className="text-xs text-muted-foreground">{t('fields.purchasableHint')}</p>
            </div>
          </div>

          <fieldset className="min-w-0 space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-sm font-medium">{t('included.title')}</legend>
            <p className="text-xs text-muted-foreground">{t('included.help')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label={t('included.feature')}
                htmlFor={id('included-feature')}
                hint={t('included.featureHint')}
                error={errors.includedPlanFeature}
              >
                <Input
                  id={id('included-feature')}
                  list={id('features')}
                  dir="ltr"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.includedPlanFeature}
                  invalid={!!errors.includedPlanFeature}
                  onChange={(e) => onChange({ includedPlanFeature: e.target.value })}
                />
                <datalist id={id('features')}>
                  {PLAN_FEATURE_KEYS.map((k) => (
                    <option key={k} value={k} label={PLAN_FEATURE_LABELS[k]} />
                  ))}
                </datalist>
              </Field>
              <Field
                label={t('included.plan')}
                htmlFor={id('included-plan')}
                hint={planList ? t('included.planHint') : t('included.planTyped')}
                error={errors.includedMinPlan}
              >
                {planList ? (
                  <Select
                    id={id('included-plan')}
                    value={draft.includedMinPlan}
                    invalid={!!errors.includedMinPlan}
                    onChange={(e) => onChange({ includedMinPlan: e.target.value })}
                  >
                    <option value="">{t('included.planNone')}</option>
                    {draft.includedMinPlan !== '' && !knownPlan && (
                      <option value={draft.includedMinPlan}>{draft.includedMinPlan}</option>
                    )}
                    {planList.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.name} ({p.slug})
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    id={id('included-plan')}
                    dir="ltr"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.includedMinPlan}
                    invalid={!!errors.includedMinPlan}
                    onChange={(e) => onChange({ includedMinPlan: e.target.value })}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <fieldset
            className="min-w-0 space-y-3 rounded-md border border-border p-3"
            disabled={!canGrant}
            data-testid="pricing-grants"
          >
            <legend className="px-1 text-sm font-medium">{t('grants.title')}</legend>
            <p className="text-xs text-muted-foreground">{t('grants.help')}</p>
            {!canGrant && (
              <p className="text-xs text-muted-foreground" data-testid="grants-third-party">
                {t('grants.thirdParty')}
              </p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {featureChoices.map((k) => (
                <Checkbox
                  key={k}
                  id={id(`grant-${k}`)}
                  label={
                    <span>
                      {PLAN_FEATURE_LABELS[k as PlanFeatureKey] ?? k}{' '}
                      <code className="font-mono text-xs text-muted-foreground" dir="ltr">
                        {k}
                      </code>
                    </span>
                  }
                  checked={draft.grantsPlanFeatures.includes(k)}
                  onChange={(e) => toggleGrant(k, e.target.checked)}
                />
              ))}
            </div>
            {errors.grantsPlanFeatures && (
              <p role="alert" className="text-xs text-danger">
                {errors.grantsPlanFeatures}
              </p>
            )}
            <Checkbox
              id={id('grandfather')}
              label={
                <span>
                  {t('grants.grandfather')}
                  <span className="block text-xs text-muted-foreground">
                    {t('grants.grandfatherHint')}
                  </span>
                </span>
              }
              checked={draft.grandfatherExisting}
              disabled={draft.grantsPlanFeatures.length === 0}
              onChange={(e) => onChange({ grandfatherExisting: e.target.checked })}
            />
            {errors.grandfatherExisting && (
              <p role="alert" className="text-xs text-danger">
                {errors.grandfatherExisting}
              </p>
            )}
          </fieldset>
        </>
      )}
    </fieldset>
  );
}
