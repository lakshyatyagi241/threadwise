'use client';

import { useTranslations } from 'next-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BspBillingMode } from '@crm/contracts';
import { Alert, Badge, Button, Card, Spinner, useToast } from '@crm/ui';
import { KEYS, customerApi } from '../api';
import { errorView } from '../lib/errors';
import { wabaTail } from '../lib/format';

/**
 * "How do you want to be billed for messages?": two cards, one choice each (TW-BSP-011). The WhatsApp devices screen (WADEV)
 * embeds this component; until that screen exists it is also served on its own page.
 */
export function BillingModeCard({ canManage }: { canManage: boolean }) {
  const t = useTranslations('bsp-billing-engine.customer');
  const te = useTranslations('bsp-billing-engine.errors');
  const tc = useTranslations('bsp-billing-engine.common');
  const qc = useQueryClient();
  const { toast } = useToast();

  const q = useQuery({
    queryKey: KEYS.billingMode,
    queryFn: ({ signal }) => customerApi.billingMode(signal),
    refetchOnWindowFocus: false,
  });
  const set = useMutation({
    mutationFn: (mode: BspBillingMode) => customerApi.setBillingMode(mode),
    onSuccess: (res) => {
      const { attach, ...state } = res;
      qc.setQueryData(KEYS.billingMode, state);
      toast(res.mode === 'reseller' ? t('savedReseller') : t('savedDirect'), 'success');
      if (attach && attach.attached + attach.failed + attach.skipped > 0) {
        toast(
          t('attachSummary', {
            attached: attach.attached,
            failed: attach.failed,
            skipped: attach.skipped,
          }),
          'info',
        );
      }
    },
    onError: (err) => {
      toast(te(errorView(err).kind), 'danger');
      void qc.invalidateQueries({ queryKey: KEYS.billingMode });
    },
  });

  if (q.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner label={tc('loading')} />
        {tc('loading')}
      </div>
    );
  }
  if (q.isError) {
    return (
      <Alert tone="danger" className="flex items-center justify-between gap-2">
        {tc('loadFailed')}
        <Button variant="secondary" size="sm" onClick={() => void q.refetch()}>
          {tc('retry')}
        </Button>
      </Alert>
    );
  }

  const d = q.data;
  const options: Array<{ mode: BspBillingMode; key: 'direct' | 'reseller'; unavailable: boolean }> =
    [
      { mode: 'meta_direct', key: 'direct', unavailable: false },
      { mode: 'reseller', key: 'reseller', unavailable: !d.resellerAvailable },
    ];

  return (
    <div className="space-y-4">
      {!canManage && <Alert tone="info">{t('readOnly')}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {options.map(({ mode, key, unavailable }) => {
          const active = d.mode === mode;
          const saving = set.isPending && set.variables === mode;
          return (
            <Card
              key={mode}
              className={`space-y-3 ${active ? 'border-primary' : ''}`}
              data-testid={`mode-${mode}`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-semibold">{t(`${key}.title`)}</h3>
                {active && <Badge tone="success">{t('active')}</Badge>}
                {!active && unavailable && <Badge tone="neutral">{t('notAvailable')}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground">{t(`${key}.body`)}</p>
              <Button
                variant={active ? 'secondary' : 'primary'}
                size="sm"
                disabled={!canManage || unavailable || active || set.isPending}
                onClick={() => set.mutate(mode)}
              >
                {saving ? t('switching') : t('choose')}
              </Button>
            </Card>
          );
        })}
      </div>
      <Card className="space-y-2">
        <h3 className="text-base font-semibold">{t('numbers')}</h3>
        {d.accounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noNumbers')}</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {d.accounts.map((a) => (
              <li key={a.wabaId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium" dir="ltr">
                    {a.phone ?? t('noPhone')}
                  </span>{' '}
                  <span className="font-mono text-xs text-muted-foreground" dir="ltr">
                    {wabaTail(a.wabaId)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {a.allocationStatus
                    ? t(`allocation.${a.allocationStatus}`, { currency: a.currency ?? '' })
                    : t('allocation.none')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
