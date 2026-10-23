'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WALLET_COST_PLUS_KINDS,
  WALLET_UNIT_PRICED_KINDS,
  type WalletCostPlusKind,
  type WalletUnitPricedKind,
  type WalletUsageSettings,
} from '@crm/contracts';
import { Button, Card, Field, Input, Spinner, Switch } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import { currencySymbol } from '../../lib/money';
import {
  checkUsageRates,
  toUsageDraft,
  usageRatesDirty,
  type UsageRatesDraft,
} from '../../lib/usage-rates-form';
import { ErrorState, LoadingBlock } from '../state';

/** "What else costs money": SMS, email, calls, contact lookups, other chat channels, and the markup on AI and translation. */
export function UsagePricesSection({ canEdit }: { canEdit: boolean }) {
  const usage = useQuery({
    queryKey: KEYS.usageRates,
    queryFn: ({ signal }) => operatorApi.usageRates(signal),
    refetchOnWindowFocus: false,
  });
  if (usage.isPending) return <LoadingBlock />;
  if (usage.isError) return <ErrorState error={usage.error} onRetry={() => void usage.refetch()} />;
  return (
    <UsagePricesForm key={usage.data.updatedAt ?? 'new'} settings={usage.data} canEdit={canEdit} />
  );
}

function UsagePricesForm({
  settings,
  canEdit,
}: {
  settings: WalletUsageSettings;
  canEdit: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.pricing.usage');
  const tk = useTranslations('wallet-message-billing.kinds');
  const tc = useTranslations('wallet-message-billing.common');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<UsageRatesDraft>(() => toUsageDraft(settings));
  const [shown, setShown] = useState(false);
  const check = checkUsageRates(draft);
  const dirty = usageRatesDirty(draft, settings);
  const prefix = currencySymbol(settings.currency, locale);

  const setPrice = (
    kind: WalletUnitPricedKind,
    patch: Partial<UsageRatesDraft['prices'][typeof kind]>,
  ) =>
    setDraft((d) => ({ ...d, prices: { ...d.prices, [kind]: { ...d.prices[kind], ...patch } } }));
  const setCostPlus = (kind: WalletCostPlusKind, on: boolean) =>
    setDraft((d) => ({ ...d, costPlus: { ...d.costPlus, [kind]: on } }));

  const save = useMutation({
    mutationFn: () => {
      if (!check.input) throw new Error('unreachable: the form validates before saving');
      return operatorApi.saveUsageRates(check.input);
    },
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.usageRates, saved);
      setDraft(toUsageDraft(saved));
      setShown(false);
      toast.success(t('saved'));
    },
    onError: (err) => toast.error(te(errorKind(err))),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (check.input) save.mutate();
  };

  const unitName = (kind: WalletUnitPricedKind) =>
    settings.prices.find((p) => p.kind === kind)?.unit ?? 'message';

  return (
    <Card className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      <form onSubmit={onSubmit} className="space-y-6" noValidate>
        <div className="space-y-4">
          {WALLET_UNIT_PRICED_KINDS.map((kind) => {
            const problem = shown ? check.problems.prices[kind] : undefined;
            const id = `usage-${kind}`;
            return (
              <div
                key={kind}
                className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_14rem_auto]"
              >
                <div className="space-y-0.5">
                  <label htmlFor={`${id}-price`} className="text-sm font-medium">
                    {tk(kind)}
                  </label>
                  <p className="text-xs text-muted-foreground">{t(`hints.${kind}`)}</p>
                </div>
                <Field
                  label={t('perUnit', { unit: t(`units.${unitName(kind)}`) })}
                  htmlFor={`${id}-price`}
                  error={problem ? t(`problems.${problem}`) : undefined}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground" aria-hidden="true">
                      {prefix}
                    </span>
                    <Input
                      id={`${id}-price`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={draft.prices[kind].price}
                      disabled={!canEdit}
                      invalid={Boolean(problem)}
                      onChange={(e) => setPrice(kind, { price: e.target.value })}
                    />
                  </div>
                </Field>
                <div className="flex items-center gap-2 sm:pt-7">
                  <Switch
                    id={`${id}-on`}
                    checked={draft.prices[kind].enabled}
                    onCheckedChange={(on) => setPrice(kind, { enabled: on })}
                    label={t('chargeFor', { kind: tk(kind) })}
                    disabled={!canEdit}
                  />
                  <span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
                    {draft.prices[kind].enabled ? tc('on') : tc('off')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="space-y-4 border-t border-border pt-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold">{t('costPlus.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('costPlus.body')}</p>
          </div>
          {WALLET_COST_PLUS_KINDS.map((kind) => (
            <div key={kind} className="flex flex-wrap items-center justify-between gap-3">
              <label htmlFor={`usage-${kind}-on`} className="text-sm font-medium">
                {tk(kind)}
              </label>
              <div className="flex items-center gap-2">
                <Switch
                  id={`usage-${kind}-on`}
                  checked={draft.costPlus[kind]}
                  onCheckedChange={(on) => setCostPlus(kind, on)}
                  label={t('chargeFor', { kind: tk(kind) })}
                  disabled={!canEdit}
                />
                <span className="text-xs font-medium text-muted-foreground" aria-hidden="true">
                  {draft.costPlus[kind] ? tc('on') : tc('off')}
                </span>
              </div>
            </div>
          ))}
          <Field
            label={t('markup')}
            htmlFor="usage-markup"
            hint={t('markupHint')}
            error={
              shown && check.problems.markup ? t(`problems.${check.problems.markup}`) : undefined
            }
          >
            <div className="flex items-center gap-2">
              <Input
                id="usage-markup"
                inputMode="decimal"
                autoComplete="off"
                value={draft.markupPercent}
                disabled={!canEdit}
                invalid={Boolean(shown && check.problems.markup)}
                onChange={(e) => setDraft((d) => ({ ...d, markupPercent: e.target.value }))}
              />
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                %
              </span>
            </div>
          </Field>
        </div>

        {canEdit && (
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending && <Spinner label={t('saving')} />}
            {t('save')}
          </Button>
        )}
      </form>
    </Card>
  );
}
