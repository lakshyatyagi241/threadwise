import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { FadeIn } from '@/components/ui/fade-in';
import { MenuTitle } from '@/components/ui/menu-title';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { messageForError } from '@/lib/api/error-message';
import { formatCount } from '@/lib/format/numbers';
import { identifyUser } from '@/lib/observability/sentry';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { AgentView } from './agent-view';
import { BotView } from './bot-view';
import { CampaignsCard, TemplatesCard } from './campaign-cards';
import { DevicesCard, InstagramBand, IntegrationsCard } from './channel-cards';
import { asDashView, DASH_VIEWS, type DashView } from './dash-views';
import { DEFAULT_PRESET, presetRange, todayIn, type DateRange } from './date-range';
import { DateRangePill, DateRangeSheet } from './date-range-sheet';
import { isForbidden, isPlanLocked } from './format';
import { FunnelCard } from './funnel-card';
import { AutopilotCard, ContactsCard, ReadRateCard, SentCard, WalletCard } from './kpi-cards';
import { PipelineCard } from './pipeline-card';
import { windowLabel } from './ranges';
import {
  BarRows,
  PairCard,
  StatusGrid,
  TitledCard,
  type BarItem,
  type GridItem,
} from './summary-cards';
import { ActivityCard, FlowsCard, InboxCard } from './team-cards';
import { ThroughputPanel } from './throughput-panel';
import { useNow } from './use-now';
import {
  useInboxCounts,
  useNewContacts,
  useSummary,
  useTaskCounts,
  useTeamPanel,
  useThroughput,
  useUnofficialWhatsapp,
  useWalletSummary,
  useWidgets,
} from './use-dashboard';

/** A figure that could not be read (no permission, or the plan has no such feature) shows as a dash, never as a zero. */
const DASH = '—';

/**
 * The dashboard tab: a dropdown at the top (Summary, Agent, Bot) that picks the view, a date pill, then the cards. Summary is the
 * set of cards below; Agent is how each person of the team did in the window; Bot is the automation flows. The pill opens a calendar sheet (quick choices or two days); one window
 * drives every card, and pulling down refreshes all of them. The first cards follow the reference app: new contacts and open
 * tasks, messages sent and received, the live conversation counts, and every message figure. The CRM's own cards (read rate,
 * wallet, pipeline, campaigns, templates, the inbox, flows, the funnel, activity) follow, unchanged. Cards that depend on the plan or
 * the platform appear only when the API says they exist.
 */
export function DashboardScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const session = useSession();
  const now = useNow(30_000);
  const timezone = session.data?.org.timezone ?? 'UTC';
  const today = useMemo(() => todayIn(timezone, now), [timezone, now]);
  const [picked, setPicked] = useState<DateRange | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The Menu opens a view by name (`view`); `at` changes with every tap so the same choice made twice still lands here.
  const params = useLocalSearchParams<{ view?: string; at?: string }>();
  const asked = `${String(params.view)}|${String(params.at)}`;
  const [view, setView] = useState<DashView>(() => asDashView(params.view));
  const [seen, setSeen] = useState(asked);
  if (seen !== asked) {
    // A new request from the Menu: take it once, here, so the screen never paints the old view first.
    setSeen(asked);
    if (params.view !== undefined) setView(asDashView(params.view));
  }
  const win = useMemo(() => picked ?? presetRange(DEFAULT_PRESET, today), [picked, today]);

  const canContacts = can(session.data, 'record.contacts.read');
  const canTasks = can(session.data, 'record.tasks.read');
  const canInbox = can(session.data, 'inbox.conversation.read');
  const summary = useSummary(win);
  const throughput = useThroughput(win);
  const widgets = useWidgets(win);
  const newContacts = useNewContacts(win, canContacts);
  const canAnalytics = can(session.data, 'dash.analytics.read');
  // The people panel is only asked for while the Agent view is open.
  const team = useTeamPanel(win, canAnalytics && view === 'agent');
  const taskCounts = useTaskCounts(canTasks);
  const inboxCounts = useInboxCounts(canInbox);
  const wallet = useWalletSummary(can(session.data, 'wallet.balance.read'));
  const unofficial = useUnofficialWhatsapp();
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
      ...(canAnalytics && view === 'agent' ? [team.refetch()] : []),
      ...(canContacts ? [newContacts.refetch()] : []),
      ...(canTasks ? [taskCounts.refetch()] : []),
      ...(canInbox ? [inboxCounts.refetch()] : []),
    ]);
    setRefreshing(false);
  };

  const w = widgets.data;
  const s = summary.data;
  const forbidden = isForbidden(summary.error);
  const role = session.data?.roles[0]?.name ?? '';
  const showDevices = unofficial && w !== undefined && !w.devices.unofficialDisabled;
  const rangeName = windowLabel(win, i18n.language);
  const funded = wallet.data !== undefined && wallet.data.balanceMinor > 0;
  const n = (value: number | undefined) =>
    value === undefined ? DASH : formatCount(value, i18n.language);
  const viewOptions = DASH_VIEWS.map((value) => ({ value, label: t(`dashboard.views.${value}`) }));

  const counts = inboxCounts.data;
  const statusItems: GridItem[] = [
    {
      key: 'all',
      icon: 'chatbubbles-outline',
      label: t('summary.status.all'),
      value: n(counts?.all),
    },
    {
      key: 'mine',
      icon: 'person-outline',
      label: t('summary.status.mine'),
      value: n(counts?.mine),
    },
    {
      key: 'unassigned',
      icon: 'person-remove-outline',
      label: t('summary.status.unassigned'),
      value: n(counts?.unassigned),
    },
    {
      key: 'assigned',
      icon: 'person-circle-outline',
      label: t('summary.status.assigned'),
      value: n(counts ? counts.all - counts.unassigned : undefined),
    },
    {
      key: 'unread',
      icon: 'mail-unread-outline',
      label: t('summary.status.unread'),
      value: n(counts?.unread),
    },
    {
      key: 'archived',
      icon: 'archive-outline',
      label: t('summary.status.archived'),
      value: n(counts?.archived),
    },
  ];
  const messageItems: BarItem[] = s
    ? (
        [
          {
            key: 'sent',
            label: t('summary.allMessages.sent'),
            value: s.current.sent,
            tone: 'primary',
          },
          {
            key: 'delivered',
            label: t('summary.allMessages.delivered'),
            value: s.current.delivered,
            tone: 'success',
          },
          {
            key: 'received',
            label: t('summary.allMessages.received'),
            value: s.current.replies,
            tone: 'primary',
          },
          {
            key: 'read',
            label: t('summary.allMessages.read'),
            value: s.current.read,
            tone: 'success',
          },
          {
            key: 'failed',
            label: t('summary.allMessages.failed'),
            value: s.current.failed,
            tone: 'danger',
          },
        ] satisfies Omit<BarItem, 'text'>[]
      ).map((item) => ({ ...item, text: n(item.value) }))
    : [];

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScreenHeader>
        <MenuTitle
          label={t('dashboard.views.label')}
          options={viewOptions}
          value={view}
          onChange={setView}
        />
      </ScreenHeader>
      <ScrollView
        testID="dashboard-scroll"
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      >
        {view !== 'bot' ? (
          <FadeIn>
            <DateRangePill range={win} onPress={() => setSheetOpen(true)} />
          </FadeIn>
        ) : null}

        {session.data?.landing === 'onboarding' ? (
          <Banner tone="info" message={t('dashboard.setupBanner')} />
        ) : null}

        {view === 'agent' ? (
          <AgentView
            query={team}
            allowed={canAnalytics}
            role={role}
            rangeName={rangeName}
            onRetry={() => void team.refetch()}
          />
        ) : view === 'bot' ? (
          <BotView query={widgets} onRetry={() => void widgets.refetch()} />
        ) : forbidden ? (
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
              <Button
                variant="secondary"
                label={t('common.retry')}
                onPress={() => void refresh()}
              />
            </View>
          </Card>
        ) : (
          <>
            <PairCard
              left={{
                title: t('summary.contacts'),
                subtitle: t('summary.contactsNote'),
                value: canContacts ? n(newContacts.data) : DASH,
                icon: 'people-outline',
                tone: 'success',
                onPress: canContacts ? () => router.navigate('/contacts') : undefined,
              }}
              right={{
                title: t('summary.tasks'),
                subtitle: t('summary.tasksNote'),
                value: canTasks ? n(taskCounts.data?.open) : DASH,
                icon: 'checkbox-outline',
                tone: 'primary',
                onPress: canTasks ? () => router.push('/tasks') : undefined,
              }}
            />
            <PairCard
              left={{
                title: t('summary.messages'),
                subtitle: t('summary.sentNote'),
                value: n(s?.current.sent),
                icon: 'paper-plane-outline',
                tone: 'warning',
              }}
              right={{
                title: t('summary.messages'),
                subtitle: t('summary.receivedNote'),
                value: n(s?.current.replies),
                icon: 'chatbubble-ellipses-outline',
                tone: 'instagram',
              }}
            />
            {canInbox ? (
              <TitledCard
                title={t('summary.conversations')}
                note={t('summary.conversationsNote')}
                trailing={counts ? n(counts.all) : undefined}
              >
                <StatusGrid items={statusItems} />
              </TitledCard>
            ) : null}
            {s ? (
              <TitledCard title={t('summary.allMessages.title')} trailing={n(s.current.sent)}>
                <BarRows items={messageItems} />
              </TitledCard>
            ) : (
              <ActivityIndicator accessibilityLabel={t('common.loading')} />
            )}

            <Text variant="overline" muted style={styles.more}>
              {t('summary.moreTitle')}
            </Text>
            <SentCard summary={s} range={rangeName} />
            <ReadRateCard summary={s} />
            <ContactsCard data={w?.contacts} />
            {funded && wallet.data ? <WalletCard wallet={wallet.data} /> : <AutopilotCard />}

            {w?.instagram ? <InstagramBand data={w.instagram} /> : null}
            {w?.pipeline ? <PipelineCard data={w.pipeline} /> : null}

            <ThroughputPanel
              rangeName={rangeName}
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
      </ScrollView>

      <DateRangeSheet
        visible={sheetOpen}
        range={win}
        today={today}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setPicked(next);
          setSheetOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl },
  stack: { gap: spacing.lg },
  more: { marginTop: spacing.md, paddingHorizontal: spacing.xs },
});
