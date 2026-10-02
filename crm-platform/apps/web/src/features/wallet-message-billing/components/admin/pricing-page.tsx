'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Card, StatTile } from '@crm/ui';
import type { WalletSettings } from '@crm/contracts';
import { PageHeader } from '@/features/auth-registration-security/platform/ui/page-header';
import { KEYS, operatorApi } from '../../api';
import { formatMinor } from '../../lib/money';
import { messagesPer100 } from '../../lib/settings-form';
import { ErrorState, LoadingBlock } from '../state';
import { Breadcrumb, ReadOnlyBanner, useCanWrite } from './admin-parts';
import { EconomicsForm } from './economics-form';
import { RateGrid } from './rate-grid';
import { SwitchesCard } from './switches-card';

/** "Message pricing" (wallet rules): the flat economics, the two master switches and the per-country rate grid. */
export function PricingPage() {
  const t = useTranslations('wallet-message-billing.admin.pricing');
  const tb = useTranslations('wallet-message-billing.admin');
  const canEdit = useCanWrite();
  const settings = useQuery({
    queryKey: KEYS.settings,
    queryFn: ({ signal }) => operatorApi.settings(signal),
    refetchOnWindowFocus: false,
  });
  const rates = useQuery({
    queryKey: KEYS.rates,
    queryFn: ({ signal }) => operatorApi.rates(signal),
    refetchOnWindowFocus: false,
  });

  return (
    <div className="space-y-6">
      <Breadcrumb items={[{ label: tb('wallet'), href: '/admin/wallet' }, { label: t('crumb') }]} />
      <PageHeader title={t('title')} description={t('subtitle')} />
      {!canEdit && <ReadOnlyBanner />}
      {settings.isPending ? (
        <LoadingBlock />
      ) : settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <>
          <Kpis settings={settings.data} />
          <EconomicsForm key={settings.data.updatedAt ?? 'new'} settings={settings.data} canEdit={canEdit} />
          <SwitchesCard settings={settings.data} canEdit={canEdit} />
        </>
      )}
      {rates.isPending ? (
        <LoadingBlock />
      ) : rates.isError ? (
        <ErrorState error={rates.error} onRetry={() => void rates.refetch()} />
      ) : (
        <RateGrid rates={rates.data} canEdit={canEdit} />
      )}
      <Guides />
    </div>
  );
}

export function Kpis({ settings }: { settings: WalletSettings }) {
  const t = useTranslations('wallet-message-billing.admin.pricing.kpi');
  const locale = useLocale();
  const money = (m: number) => formatMinor(m, settings.currency, locale);
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatTile label={t('signup')} value={money(settings.referralSignupMinor)} />
      <StatTile label={t('cost')} value={money(settings.flatPriceMinor)} hint={t('costHint')} />
      <StatTile
        label={t('spending')}
        value={new Intl.NumberFormat(locale).format(messagesPer100(settings.flatPriceMinor))}
        hint={t('spendingHint', { amount: money(10_000) })}
      />
      <StatTile label={t('lowBalance')} value={money(settings.lowBalanceThresholdMinor)} />
    </div>
  );
}

function Guides() {
  const t = useTranslations('wallet-message-billing.admin.pricing.guides');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {(['crossBorder', 'how', 'order'] as const).map((k) => (
        <Card key={k} className="space-y-1.5">
          <h2 className="text-sm font-semibold">{t(`${k}.title`)}</h2>
          <p className="text-sm text-muted-foreground">{t(`${k}.body`)}</p>
        </Card>
      ))}
    </div>
  );
}
