'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WalletSettings } from '@crm/contracts';
import { Button, Card, Field, Input, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../../api';
import { errorKind } from '../../lib/errors';
import { currencySymbol, formatMinor, parseAmount } from '../../lib/money';
import {
  checkSettings,
  rewardMessages,
  settingsDirty,
  toDraft,
  type SettingsDraft,
  type SettingsField,
} from '../../lib/settings-form';

/** The three flat economics figures and the launch coverage, saved apart from the rate grid and the switches. */
export function EconomicsForm({
  settings,
  canEdit,
}: {
  settings: WalletSettings;
  canEdit: boolean;
}) {
  const t = useTranslations('wallet-message-billing.admin.pricing.economics');
  const te = useTranslations('wallet-message-billing.errors');
  const locale = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [shown, setShown] = useState(false);
  const check = checkSettings(draft);
  const dirty = settingsDirty(draft, settings);
  const set = (k: SettingsField, v: string) => setDraft((d) => ({ ...d, [k]: v }));
  const problem = (k: SettingsField) => {
    const p = shown ? check.problems[k] : undefined;
    return p ? t(`problems.${p}`) : undefined;
  };

  const save = useMutation({
    mutationFn: () => {
      if (!check.input) throw new Error('unreachable: the form validates before saving');
      return operatorApi.saveSettings(check.input);
    },
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      setDraft(toDraft(saved));
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

  const prefix = currencySymbol(settings.currency, locale);
  const money = (id: SettingsField, label: string, hint?: string) => (
    <Field label={label} htmlFor={`eco-${id}`} hint={hint} error={problem(id)}>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground" aria-hidden="true">
          {prefix}
        </span>
        <Input
          id={`eco-${id}`}
          inputMode="decimal"
          autoComplete="off"
          value={draft[id]}
          disabled={!canEdit}
          invalid={Boolean(problem(id))}
          onChange={(e) => set(id, e.target.value)}
        />
      </div>
    </Field>
  );

  const flat = parseAmount(draft.flatPrice);
  const reward = parseAmount(draft.referralSignup);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">{t('liveKeys')}</span>
      </div>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {money('flatPrice', t('flatPrice'), t('flatPriceHint'))}
          {money('referralSignup', t('referralSignup'), t('referralSignupHint'))}
          {money('lowBalanceThreshold', t('lowBalance'), t('lowBalanceHint'))}
          <Field
            label={t('coverage')}
            htmlFor="eco-launchCoveragePercent"
            hint={t('coverageHint')}
            error={problem('launchCoveragePercent')}
          >
            <div className="flex items-center gap-2">
              <Input
                id="eco-launchCoveragePercent"
                inputMode="numeric"
                autoComplete="off"
                value={draft.launchCoveragePercent}
                disabled={!canEdit}
                invalid={Boolean(problem('launchCoveragePercent'))}
                onChange={(e) => set('launchCoveragePercent', e.target.value)}
              />
              <span className="text-sm text-muted-foreground" aria-hidden="true">
                %
              </span>
            </div>
          </Field>
        </div>
        {flat !== null && flat > 0 && reward !== null && (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('rewardSentence', {
              reward: formatMinor(reward, settings.currency, locale),
              count: rewardMessages(reward, flat),
            })}
          </p>
        )}
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
