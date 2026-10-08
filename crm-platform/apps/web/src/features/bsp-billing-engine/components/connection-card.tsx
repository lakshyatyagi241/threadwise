'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BSP_CREDIT_CURRENCIES, type BspSettingsResponse } from '@crm/contracts';
import { Badge, Button, Card, Field, Input, PasswordInput, Select, Switch } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../api';
import { errorView, fieldErrors } from '../lib/errors';
import {
  isDirty,
  toDraft,
  toPayload,
  validateDraft,
  type SettingsDraft,
  type SettingsProblem,
} from '../lib/settings-form';

/** Step 1: the Meta connection. The token is write-only: the page only ever learns whether one is stored. */
export function ConnectionCard({
  settings,
  canEdit,
}: {
  settings: BspSettingsResponse;
  canEdit: boolean;
}) {
  const t = useTranslations('bsp-billing-engine.console.step1');
  const te = useTranslations('bsp-billing-engine.errors');
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<SettingsDraft>(() => toDraft(settings));
  const [shown, setShown] = useState(false);
  const [serverFields, setServerFields] = useState<Set<string>>(new Set());

  const problems = new Set<SettingsProblem | string>(validateDraft(draft));
  const showProblems = shown ? problems : new Set<string>();
  const bad = (k: string) => showProblems.has(k) || serverFields.has(k);
  const set = <K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = useMutation({
    mutationFn: () => operatorApi.saveSettings(toPayload(draft)),
    onSuccess: (saved) => {
      qc.setQueryData(KEYS.settings, saved);
      setDraft(toDraft(saved));
      setServerFields(new Set());
      setShown(false);
      toast.success(t('saved'));
    },
    onError: (err) => {
      setServerFields(fieldErrors(err));
      const view = errorView(err);
      toast.error(
        view.kind === 'metaRejected'
          ? te('metaRejected', { detail: view.detail ?? '' })
          : te(view.kind),
      );
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setShown(true);
    if (problems.size === 0) save.mutate();
  };

  const invalidText = (k: SettingsProblem) => (bad(k) ? t(`invalid.${k}`) : undefined);

  return (
    <Card className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('title')}</h2>
        <Badge tone={settings.configured ? 'success' : 'warning'}>
          {settings.configured ? t('connected') : t('notConnected')}
        </Badge>
      </div>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={
              <>
                {t('businessId')}
                <span aria-hidden className="text-danger">
                  {' '}
                  *
                </span>
              </>
            }
            htmlFor="bsp-business"
            hint={t('businessIdHint')}
            error={invalidText('businessId')}
          >
            <Input
              id="bsp-business"
              inputMode="numeric"
              autoComplete="off"
              value={draft.businessId}
              placeholder={t('businessIdPlaceholder')}
              disabled={!canEdit}
              invalid={bad('businessId')}
              onChange={(e) => set('businessId', e.target.value)}
            />
          </Field>
          <Field
            label={
              <>
                {t('token')}
                <span aria-hidden className="text-danger">
                  {' '}
                  *
                </span>
              </>
            }
            htmlFor="bsp-token"
            hint={t('tokenHint')}
          >
            <PasswordInput
              id="bsp-token"
              autoComplete="off"
              value={draft.systemUserToken}
              placeholder={settings.tokenSet ? t('tokenStored') : t('tokenPlaceholder')}
              disabled={!canEdit || draft.clearToken}
              onChange={(e) => set('systemUserToken', e.target.value)}
            />
            {settings.tokenSet && canEdit && (
              <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={draft.clearToken}
                  onChange={(e) => set('clearToken', e.target.checked)}
                />
                {t('clearToken')}
              </label>
            )}
          </Field>
          <Field label={t('creditLine')} htmlFor="bsp-credit" hint={t('creditLineHint')}>
            <Input
              id="bsp-credit"
              autoComplete="off"
              value={draft.extendedCreditId}
              placeholder={t('creditLinePlaceholder')}
              disabled={!canEdit}
              onChange={(e) => set('extendedCreditId', e.target.value)}
            />
          </Field>
          <Field
            label={t('graphVersion')}
            htmlFor="bsp-graph"
            hint={t('graphVersionHint')}
            error={invalidText('graphVersion')}
          >
            <Input
              id="bsp-graph"
              autoComplete="off"
              value={draft.graphVersion}
              placeholder="v26.0"
              disabled={!canEdit}
              invalid={bad('graphVersion')}
              onChange={(e) => set('graphVersion', e.target.value)}
            />
          </Field>
          <Field
            label={t('ratesEndpoint')}
            htmlFor="bsp-rates"
            hint={t('ratesEndpointHint')}
            error={invalidText('ratesEndpoint')}
            className="sm:col-span-2"
          >
            <Input
              id="bsp-rates"
              type="url"
              autoComplete="off"
              value={draft.ratesEndpoint}
              placeholder="https://graph.facebook.com/v26.0/…/pricing"
              disabled={!canEdit}
              invalid={bad('ratesEndpoint')}
              onChange={(e) => set('ratesEndpoint', e.target.value)}
            />
          </Field>
          <Field
            label={t('baseCurrency')}
            htmlFor="bsp-base"
            hint={t('baseCurrencyHint')}
            error={invalidText('baseCurrency')}
          >
            <Input
              id="bsp-base"
              autoComplete="off"
              maxLength={8}
              value={draft.baseCurrency}
              disabled={!canEdit}
              invalid={bad('baseCurrency')}
              onChange={(e) => set('baseCurrency', e.target.value.toUpperCase())}
            />
          </Field>
        </div>

        <div
          className={`rounded-md border p-3 ${draft.autoAttach ? 'border-primary/50' : 'border-border'}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t('autoAttach')}</p>
              <p className="text-xs text-muted-foreground">{t('autoAttachHint')}</p>
            </div>
            <Switch
              checked={draft.autoAttach}
              onCheckedChange={(v) => set('autoAttach', v)}
              label={t('autoAttach')}
              disabled={!canEdit}
            />
          </div>
          {draft.autoAttach && (
            <Field
              label={t('autoCurrency')}
              htmlFor="bsp-auto-currency"
              error={invalidText('autoAttachCurrency')}
              className="mt-3 max-w-xs"
            >
              <Select
                id="bsp-auto-currency"
                value={draft.autoAttachCurrency}
                disabled={!canEdit}
                invalid={bad('autoAttachCurrency')}
                onChange={(e) => set('autoAttachCurrency', e.target.value)}
              >
                <option value="">{t('auto')}</option>
                {BSP_CREDIT_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        {canEdit && (
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-muted-foreground">{t('tokenNote')}</span>
            <Button type="submit" disabled={save.isPending || !isDirty(draft, settings)}>
              {t('save')}
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
