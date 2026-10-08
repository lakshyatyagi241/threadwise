'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type BspSettingsResponse } from '@crm/contracts';
import { Alert, Button, Card, ConfirmDialog, EmptyState, Field, Select, Spinner } from '@crm/ui';
import { useToast } from '@/features/auth-registration-security/platform/ui/toast';
import { KEYS, operatorApi } from '../api';
import { defaultCurrency, optionParts, optionValue, parseOption } from '../lib/attach-form';
import { errorView } from '../lib/errors';

/** Step 2: attach the credit line to one customer's number by hand, or to every connected number of a reseller workspace. */
export function AttachCard({
  settings,
  canEdit,
}: {
  settings: BspSettingsResponse;
  canEdit: boolean;
}) {
  const t = useTranslations('bsp-billing-engine.console.step2');
  const te = useTranslations('bsp-billing-engine.errors');
  const tc = useTranslations('bsp-billing-engine.common');
  const qc = useQueryClient();
  const toast = useToast();
  const [picked, setPicked] = useState('');
  const [currency, setCurrency] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const candidates = useQuery({
    queryKey: KEYS.candidates,
    queryFn: ({ signal }) => operatorApi.candidates(signal),
    refetchOnWindowFocus: false,
  });

  const enabled = settings.configured && canEdit;
  const list = candidates.data?.data ?? [];
  const chosen = list.find((c) => optionValue(c) === picked);
  // The currency follows the chosen number until the operator picks one themselves.
  const effectiveCurrency =
    currency ?? defaultCurrency(chosen, settings.baseCurrency, settings.creditCurrencies);

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: KEYS.allocations }),
      qc.invalidateQueries({ queryKey: KEYS.candidates }),
    ]);

  const reportError = (err: unknown) => {
    const view = errorView(err);
    toast.error(
      view.kind === 'metaRejected'
        ? te('metaRejected', { detail: view.detail ?? '' })
        : te(view.kind),
    );
  };

  const attach = useMutation({
    mutationFn: () => {
      const target = parseOption(picked);
      if (!target) throw new Error('no number picked');
      return operatorApi.attach({ ...target, currency: effectiveCurrency });
    },
    onSuccess: async (al) => {
      if (al.status === 'attached') toast.success(t('attached', { waba: al.wabaId }));
      else toast.error(t('failed', { error: al.lastError ?? '' }));
      await refresh();
    },
    onError: reportError,
  });

  const attachAll = useMutation({
    mutationFn: () => operatorApi.attachAll(),
    onSuccess: async (r) => {
      toast.success(
        t('attachAllDone', { attached: r.attached, failed: r.failed, skipped: r.skipped }),
      );
      if (r.remaining > 0) toast.success(t('attachAllMore', { remaining: r.remaining }));
      setConfirmAll(false);
      await refresh();
    },
    onError: (err) => {
      setConfirmAll(false);
      reportError(err);
    },
  });

  return (
    <Card className={`space-y-4 ${enabled || !canEdit ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-0.5">
          <h2 className="text-base font-semibold">{t('title')}</h2>
          <p className="text-xs text-muted-foreground">
            {settings.autoAttach ? t('hintAuto') : t('hintManual')}
          </p>
        </div>
        {settings.configured && canEdit && (
          <Button variant="secondary" size="sm" onClick={() => setConfirmAll(true)}>
            {t('attachAll')}
          </Button>
        )}
      </div>

      {candidates.isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner label={tc('loading')} />
          {tc('loading')}
        </div>
      ) : candidates.isError ? (
        <Alert tone="danger">{tc('loadFailed')}</Alert>
      ) : list.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <form
          className="grid gap-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (picked) attach.mutate();
          }}
        >
          <Field label={t('number')} htmlFor="bsp-number" hint={t('numberHint')}>
            <Select
              id="bsp-number"
              required
              value={picked}
              disabled={!enabled}
              onChange={(e) => {
                setPicked(e.target.value);
                setCurrency(null);
              }}
            >
              <option value="">{t('pick')}</option>
              {list.map((c) => {
                const p = optionParts(c);
                return (
                  <option key={optionValue(c)} value={optionValue(c)}>
                    {t('workspaceOption', {
                      workspace: p.workspace,
                      phone: p.phone ?? t('noPhone'),
                      tail: p.tail,
                    })}
                  </option>
                );
              })}
            </Select>
          </Field>
          <Field label={t('currency')} htmlFor="bsp-attach-currency" hint={t('currencyHint')}>
            <Select
              id="bsp-attach-currency"
              required
              value={effectiveCurrency}
              disabled={!enabled}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {settings.creditCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <p className="rounded-md border border-danger/30 bg-danger/5 p-2 text-xs text-muted-foreground sm:col-span-3">
            <strong className="text-danger">{t('locked')}</strong>
          </p>
          <Button type="submit" disabled={!enabled || !picked || attach.isPending}>
            {attach.isPending && <Spinner />}
            {t('attach')}
          </Button>
        </form>
      )}
      {!settings.configured && <p className="text-xs text-muted-foreground">{t('finishStep1')}</p>}

      <ConfirmDialog
        open={confirmAll}
        title={t('attachAllTitle')}
        message={t('attachAllBody')}
        confirmLabel={t('attachAllConfirm')}
        cancelLabel={tc('cancel')}
        busy={attachAll.isPending}
        onConfirm={() => attachAll.mutate()}
        onClose={() => setConfirmAll(false)}
      />
    </Card>
  );
}
