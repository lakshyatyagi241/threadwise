'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Input, Switch } from '@crm/ui';
import { useCanEdit } from '@/features/auth-registration-security/platform/operator-context';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { ReadOnlyNotice } from '@/features/auth-registration-security/platform/ui/read-only-notice';
import { ErrorBlock, LoadingBlock } from '@/features/auth-registration-security/platform/ui/state';
import { ApiError } from '@/lib/api/errors';
import { PLAN_SETTINGS_KEY, fetchPlanSettings, savePlanSettings } from '../api';

const NS = 'plans-subscriptions-trials.operator.settings';

/** Pricing settings (super admin): the yearly switch and the yearly discount. One edit changes checkout, the plan picker and /pricing. */
export function PlanSettingsPage() {
  const t = useTranslations(NS);
  const q = useQuery({
    queryKey: PLAN_SETTINGS_KEY,
    queryFn: ({ signal }) => fetchPlanSettings(signal),
    refetchOnWindowFocus: false,
  });
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <div className="space-y-6">
      <PageHeader title={t('title')} description={t('description')} />
      <Form initial={q.data} />
    </div>
  );
}

function Form({
  initial,
}: {
  initial: { yearlyToggleEnabled: boolean; yearlyDiscountPct: number };
}) {
  const t = useTranslations(NS);
  const qc = useQueryClient();
  const canEdit = useCanEdit('plans');
  const [enabled, setEnabled] = useState(initial.yearlyToggleEnabled);
  const [pct, setPct] = useState(String(initial.yearlyDiscountPct));
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);
  const valid = /^\d{1,2}$/.test(pct) && Number(pct) <= 90;

  const save = useMutation({
    mutationFn: () =>
      savePlanSettings({ yearlyToggleEnabled: enabled, yearlyDiscountPct: Number(pct) }),
    onSuccess: (r) => {
      setMessage({ tone: 'success', text: t('saved') });
      qc.setQueryData(PLAN_SETTINGS_KEY, r);
    },
    onError: (e) =>
      setMessage({
        tone: 'danger',
        text: e instanceof ApiError && e.status === 403 ? t('forbidden') : t('failed'),
      }),
  });

  return (
    <Card className="space-y-4 p-5">
      {!canEdit && <ReadOnlyNotice section="plans" />}
      <fieldset disabled={!canEdit} className="space-y-4">
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={enabled} onCheckedChange={setEnabled} label={t('yearlyToggle')} />
          <span>
            <span className="block font-medium">{t('yearlyToggle')}</span>
            <span className="text-muted-foreground">{t('yearlyToggleHint')}</span>
          </span>
        </label>
        <label className="block max-w-xs space-y-1 text-sm">
          <span className="font-medium">{t('discount')}</span>
          <Input
            inputMode="numeric"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="font-mono"
          />
          <span className="text-muted-foreground">{t('discountHint')}</span>
        </label>
      </fieldset>
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {canEdit && (
        <Button disabled={!valid || save.isPending} onClick={() => save.mutate()}>
          {t('save')}
        </Button>
      )}
    </Card>
  );
}
