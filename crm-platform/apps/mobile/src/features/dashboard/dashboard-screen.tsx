import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { BrandFrame } from '@/components/ui/brand-frame';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { signOut } from '@/lib/auth/sign-out';
import { identifyUser } from '@/lib/observability/sentry';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { CampaignsCard, TemplatesCard } from './campaign-cards';
import { DevicesCard, InstagramBand, IntegrationsCard } from './channel-cards';
import { DashboardHeader } from './dashboard-header';
import { isForbidden, isPlanLocked } from './format';
import { FunnelCard } from './funnel-card';
import { AutopilotCard, ContactsCard, ReadRateCard, SentCard, WalletCard } from './kpi-cards';
import { PipelineCard } from './pipeline-card';
import { RANGES, type Range } from './ranges';
import { ActivityCard, FlowsCard, InboxCard } from './team-cards';
import { ThroughputPanel } from './throughput-panel';
import { useNow } from './use-now';
import {
  useSummary,
  useThroughput,
  useUnofficialWhatsapp,
  useWalletSummary,
  useWidgets,
} from './use-dashboard';

/**
 * The screen after sign-in (TW-DASH-001 .. 021): the same numbers and cards as the web dashboard, in a single column. One window
 * (24 hours, 7 days, 30 days, quarter to date) drives every card; pulling down refreshes all of them. Cards that depend on the plan
 * or the platform (pipeline, Instagram, devices, wallet) appear only when the API says they exist.
 */
export function DashboardScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const session = useSession();
  const [range, setRange] = useState<Range>('7d');
  const summary = useSummary(range);
  const throughput = useThroughput(range);
  const widgets = useWidgets(range);
  const wallet = useWalletSummary(can(session.data, 'wallet.balance.read'));
  const unofficial = useUnofficialWhatsapp();
  const now = useNow(30_000);
  const [refreshing, setRefreshing] = useState(false);

  const userId = session.data?.user.id;
  useEffect(() => {
    if (userId) identifyUser(userId);
  }, [userId]);

  const refresh = async () => {
    setRefreshing(true);
    await Promise.allSettled([
      summary.refetch(),
      throughput.refetch(),
      widgets.refetch(),
      wallet.refetch(),
      session.refetch(),
    ]);
    setRefreshing(false);
  };

  const user = session.data?.user;
  const org = session.data?.org;
  const timezone = org?.timezone ?? 'UTC';
  const w = widgets.data;
  const s = summary.data;
  const forbidden = isForbidden(summary.error);
  const role = session.data?.roles[0]?.name ?? '';
  const showDevices = unofficial && w !== undefined && !w.devices.unofficialDisabled;
  const rangeName = t(`dashboard.range.long.${range}`);
  const funded = wallet.data !== undefined && wallet.data.balanceMinor > 0;

  return (
    <BrandFrame
      testID="dashboard-scroll"
      compact
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      header={
        <DashboardHeader
          name={user ? (user.displayName ?? user.fullName) : ''}
          timezone={timezone}
          now={now}
          running={w?.campaigns.running ?? 0}
          summary={s}
          showDevices={showDevices}
          devicesOnline={w?.devices.online ?? 0}
          rangeName={rangeName}
          updatedAt={summary.dataUpdatedAt}
        />
      }
    >
      <FadeIn>
        <SegmentedControl
          label={t('dashboard.range.label')}
          value={range}
          onChange={setRange}
          options={RANGES.map((value) => ({
            value,
            label: t(`dashboard.range.short.${value}`),
            accessibilityLabel: t(`dashboard.range.long.${value}`),
          }))}
        />
      </FadeIn>

      {session.data?.landing === 'onboarding' ? (
        <Banner tone="info" message={t('dashboard.setupBanner')} />
      ) : null}

      {forbidden ? (
        <Card>
          <Text accessibilityRole="alert">{t('dashboard.error.forbidden', { role })}</Text>
        </Card>
      ) : summary.error && !s ? (
        <Card>
          <View style={styles.stack}>
            <Text danger accessibilityRole="alert">
              {isPlanLocked(summary.error)
                ? t('dashboard.error.locked')
                : messageForError(summary.error, t)}
            </Text>
            <Button variant="secondary" label={t('common.retry')} onPress={() => void refresh()} />
          </View>
        </Card>
      ) : (
        <>
          <SentCard summary={s} range={t(`dashboard.range.short.${range}`)} />
          <ReadRateCard summary={s} />
          <ContactsCard data={w?.contacts} />
          {funded && wallet.data ? <WalletCard wallet={wallet.data} /> : <AutopilotCard />}

          {w?.instagram ? <InstagramBand data={w.instagram} /> : null}
          {w?.pipeline ? <PipelineCard data={w.pipeline} /> : null}

          <ThroughputPanel
            range={range}
            summary={s}
            throughput={throughput.data}
            failed={Boolean(throughput.error)}
            timezone={timezone}
          />

          {w ? (
            <>
              <CampaignsCard data={w.campaigns} />
              {showDevices ? <DevicesCard data={w.devices} /> : null}
              <TemplatesCard data={w.templates} />
              <InboxCard data={w.inbox} now={now} />
              <FlowsCard data={w.flows} />
            </>
          ) : widgets.error ? (
            <Card>
              <View style={styles.stack}>
                <Text danger accessibilityRole="alert">
                  {messageForError(widgets.error, t)}
                </Text>
                <Button
                  variant="secondary"
                  label={t('common.retry')}
                  onPress={() => void refresh()}
                />
              </View>
            </Card>
          ) : (
            <ActivityIndicator accessibilityLabel={t('common.loading')} />
          )}

          {s ? <FunnelCard funnel={s.funnel} subtitle={rangeName} /> : null}
          {w ? (
            <>
              <ActivityCard data={w.activity} now={now} />
              <IntegrationsCard data={w.integrations} />
            </>
          ) : null}
        </>
      )}

      <Button
        variant="secondary"
        label={t('common.signOut')}
        onPress={() => void signOut(queryClient)}
      />
    </BrandFrame>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
});
