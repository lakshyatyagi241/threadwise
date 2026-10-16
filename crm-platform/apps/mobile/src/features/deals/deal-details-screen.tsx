import type { DealActivityResponse, DealResponse, DealStageRef } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { HeaderIconButton } from '@/components/ui/screen-header';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { isApiError } from '@/lib/api';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { ActivityComposer } from './activity-composer';
import { ActivityRow } from './activity-row';
import { describeDealFailure, isConflict, isNotFound, isPlanLocked } from './deal-errors';
import { dueState, formatDay, whatsappLink } from './deal-format';
import { StageLabel, StatusBadge } from './deal-parts';
import { formatMoney } from './money';
import { LostSheet } from './lost-sheet';
import { toLostBody, type LostReasonPayload } from './lost-reasons';
import { firstParam } from './route-params';
import { StageSheet } from './stage-sheet';
import {
  dealKey,
  useActivities,
  useAddActivity,
  useBoard,
  useDeal,
  useDeleteDeal,
  useMarkLost,
  useMarkWon,
  useMoveDeal,
  useReopenDeal,
  useToggleActivity,
} from './use-deals';
import { formatMoment } from '@/lib/format/dates';
import { useQueryClient } from '@tanstack/react-query';

/** A label above its value, one line of the deal card. */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.detail}>
      <Text variant="caption" muted>
        {label}
      </Text>
      {children}
    </View>
  );
}

/**
 * One deal: its value, stage and status, the buttons for what happens to it (won, lost, move, reopen), the customer, the details
 * and the timeline of notes, calls and tasks with a box to add one. People who may update can edit the deal and add to the timeline;
 * people who may delete can delete it after a confirmation.
 */
export function DealDetailsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = firstParam(params.id);
  const session = useSession();
  const canRead = can(session.data, 'record.deals.read');
  const canUpdate = can(session.data, 'record.deals.update');
  const canDelete = can(session.data, 'record.deals.delete');
  const canReadSettings = can(session.data, 'record.pipelines.read');
  const canOpenContact = can(session.data, 'record.contacts.read');

  const deal = useDeal(id, canRead);
  const data = deal.data;
  // The pipeline's stages come from its board (readable with the deals), which also feeds "Move to".
  const board = useBoard(data?.pipeline.id, {}, canRead && data !== undefined);
  const stages: DealStageRef[] = useMemo(
    () => (board.data?.stages ?? []).map((s) => s.stage),
    [board.data],
  );
  const hasWon = stages.some((s) => s.kind === 'won');
  const hasLost = stages.some((s) => s.kind === 'lost');

  const activities = useActivities(id, canRead && data !== undefined);
  const entries = useMemo(
    () => activities.data?.pages.flatMap((page) => page.data) ?? [],
    [activities.data],
  );

  const move = useMoveDeal();
  const won = useMarkWon();
  const lost = useMarkLost();
  const reopen = useReopenDeal();
  const remove = useDeleteDeal();
  const add = useAddActivity(id);
  const toggle = useToggleActivity(id);
  const [moving, setMoving] = useState(false);
  const [lostFor, setLostFor] = useState<{ stageId?: string } | null>(null);
  const [lostError, setLostError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [added, setAdded] = useState(0);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/deals'));
  const busy = move.isPending || won.isPending || lost.isPending || reopen.isPending;

  /** A change did not happen: say why, and show the deal as it is now. */
  const failed = (error: unknown) => {
    setNotice(
      isApiError(error) && isConflict(error)
        ? t('deals.details.conflict')
        : describeDealFailure(error, t),
    );
    void queryClient.invalidateQueries({ queryKey: dealKey(id) });
  };

  const markWon = (current: DealResponse) => {
    setNotice(null);
    won.mutate(current, { onError: failed });
  };
  const reopenDeal = (current: DealResponse) => {
    setNotice(null);
    reopen.mutate(current, { onError: failed });
  };
  const moveTo = (current: DealResponse, stage: DealStageRef) => {
    setNotice(null);
    if (stage.kind === 'lost' && current.status !== 'lost') {
      setLostError(null);
      setLostFor({ stageId: stage.id });
      return;
    }
    move.mutate({ deal: current, body: { stageId: stage.id } }, { onError: failed });
  };
  const confirmLost = (reason: LostReasonPayload) => {
    if (!data || !lostFor) return;
    setLostError(null);
    const done = {
      onSuccess: () => setLostFor(null),
      onError: (error: unknown) => {
        // A missing reason keeps the sheet open to try again; anything else closes it and says what happened.
        if (isApiError(error) && !isConflict(error) && !isNotFound(error)) {
          setLostError(describeDealFailure(error, t));
          return;
        }
        setLostFor(null);
        failed(error);
      },
    };
    if (lostFor.stageId) {
      move.mutate(
        {
          deal: data,
          body: {
            stageId: lostFor.stageId,
            ...('lostReasonId' in reason || 'lostReason' in reason ? reason : {}),
          },
        },
        done,
      );
    } else {
      lost.mutate({ deal: data, body: toLostBody(reason) }, done);
    }
  };
  const confirmDelete = () =>
    remove.mutate(id, {
      onSuccess: () => {
        setConfirming(false);
        goBack();
      },
      onError: (error) => {
        setConfirming(false);
        if (isNotFound(error)) goBack();
        else setNotice(describeDealFailure(error, t));
      },
    });
  const addEntry = (body: Parameters<typeof add.mutate>[0]) => {
    setAddError(null);
    add.mutate(body, {
      onSuccess: () => setAdded((n) => n + 1),
      onError: (error) => setAddError(describeDealFailure(error, t)),
    });
  };
  const toggleEntry = (entry: DealActivityResponse) => {
    setNotice(null);
    toggle.mutate(
      { activityId: entry.id, done: !entry.done },
      { onError: (error) => setNotice(describeDealFailure(error, t)) },
    );
  };

  let body;
  if (session.data === undefined) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (!canRead) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={t('deals.denied.title')}
        hint={t('deals.denied.hint')}
      />
    );
  } else if (!data) {
    if (deal.isPending) {
      body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
    } else if (isPlanLocked(deal.error)) {
      body = (
        <EmptyState
          icon="lock-closed-outline"
          title={t('deals.planLocked.title')}
          hint={t('deals.planLocked.hint')}
        />
      );
    } else {
      const missing = isNotFound(deal.error);
      body = (
        <View style={styles.pad}>
          <Card>
            <Text danger accessibilityRole="alert">
              {describeDealFailure(deal.error, t)}
            </Text>
            {missing ? null : (
              <Button
                variant="secondary"
                label={t('common.retry')}
                onPress={() => void deal.refetch()}
              />
            )}
          </Card>
        </View>
      );
    }
  } else {
    const language = i18n.language;
    const open = data.status === 'open';
    const state = open ? dueState(data.expectedCloseDate) : null;
    const wa = whatsappLink(data.contact?.phone);
    const sourceLabel = t(`deals.source.${data.source}`);
    const header = (
      <View style={styles.content}>
        {notice ? <Banner tone="warning" message={notice} /> : null}
        <View style={styles.hero}>
          <Text variant="title" accessibilityRole="header">
            {data.title}
          </Text>
          <Text variant="heading">{formatMoney(data.value, data.currency, language)}</Text>
          <View style={styles.badges}>
            <StatusBadge status={data.status} />
            <StageLabel name={data.stage.name} color={data.stage.color} />
          </View>
        </View>

        {data.status === 'lost' && data.lostReason ? (
          <Banner
            tone="danger"
            message={t('deals.details.lostReason', { reason: data.lostReason })}
          />
        ) : null}

        {canUpdate ? (
          <View style={styles.actions}>
            {open && hasWon ? (
              <Button
                label={t('deals.actions.markWon')}
                loading={won.isPending}
                disabled={busy}
                onPress={() => markWon(data)}
              />
            ) : null}
            {open && hasLost ? (
              <Button
                variant="secondary"
                label={t('deals.actions.markLost')}
                disabled={busy}
                onPress={() => {
                  setNotice(null);
                  setLostError(null);
                  setLostFor({});
                }}
              />
            ) : null}
            {!open ? (
              <Button
                variant="secondary"
                label={t('deals.actions.reopen')}
                loading={reopen.isPending}
                disabled={busy}
                onPress={() => reopenDeal(data)}
              />
            ) : null}
            {stages.length > 0 ? (
              <Button
                variant="secondary"
                label={t('deals.actions.moveTo')}
                disabled={busy}
                onPress={() => setMoving(true)}
              />
            ) : null}
          </View>
        ) : null}

        <Card>
          <Text variant="subheading" accessibilityRole="header">
            {t('deals.details.customer')}
          </Text>
          {data.contact ? (
            <>
              <Text>{data.contact.name || data.contact.phone || t('deals.unknownContact')}</Text>
              {data.contact.phone && data.contact.name ? (
                <Text variant="caption" muted>
                  {data.contact.phone}
                </Text>
              ) : null}
              {data.contact.email ? (
                <Text variant="caption" muted>
                  {data.contact.email}
                </Text>
              ) : null}
              <View style={styles.actions}>
                {canOpenContact ? (
                  <Button
                    variant="secondary"
                    label={t('deals.details.openContact')}
                    onPress={() =>
                      router.push({ pathname: '/contact/[id]', params: { id: data.contact!.id } })
                    }
                  />
                ) : null}
                {wa ? (
                  <Button
                    variant="secondary"
                    label={t('deals.details.message')}
                    onPress={() => void Linking.openURL(wa)}
                  />
                ) : null}
              </View>
            </>
          ) : (
            <Text muted>{t('deals.details.noContact')}</Text>
          )}
          {data.company ? (
            <Text variant="caption" muted>
              {t('deals.details.company', { name: data.company.name })}
            </Text>
          ) : null}
        </Card>

        <Card>
          <Text variant="subheading" accessibilityRole="header">
            {t('deals.details.details')}
          </Text>
          <DetailRow label={t('deals.details.owner')}>
            <Text muted={!data.owner}>{data.owner?.name ?? t('deals.unassigned')}</Text>
          </DetailRow>
          <DetailRow label={t('deals.details.expectedClose')}>
            {data.expectedCloseDate ? (
              <Text danger={state === 'overdue'}>
                {formatDay(data.expectedCloseDate, language)}
              </Text>
            ) : (
              <Text muted>{t('deals.details.noClose')}</Text>
            )}
          </DetailRow>
          <DetailRow label={t('deals.details.source')}>
            <View style={styles.badges}>
              <Badge tone="neutral" label={sourceLabel} />
            </View>
          </DetailRow>
          <DetailRow label={t('deals.details.created')}>
            <Text>{formatMoment(data.createdAt, language)}</Text>
          </DetailRow>
          {data.wonAt ? (
            <DetailRow label={t('deals.details.wonAt')}>
              <Text>{formatMoment(data.wonAt, language)}</Text>
            </DetailRow>
          ) : null}
          {data.lostAt ? (
            <DetailRow label={t('deals.details.lostAt')}>
              <Text>{formatMoment(data.lostAt, language)}</Text>
            </DetailRow>
          ) : null}
          {data.notes ? (
            <DetailRow label={t('deals.details.notes')}>
              <Text>{data.notes}</Text>
            </DetailRow>
          ) : null}
        </Card>

        <Text variant="subheading" accessibilityRole="header">
          {t('deals.timeline.title')}
        </Text>
        {canUpdate ? (
          <ActivityComposer
            pending={add.isPending}
            error={addError}
            onAdd={addEntry}
            resetKey={added}
          />
        ) : null}
        {activities.isPending ? (
          <ActivityIndicator accessibilityLabel={t('common.loading')} />
        ) : null}
        {activities.isError ? (
          <Card>
            <Text danger accessibilityRole="alert">
              {describeDealFailure(activities.error, t)}
            </Text>
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void activities.refetch()}
            />
          </Card>
        ) : null}
        {activities.data && entries.length === 0 ? (
          <Text muted style={styles.empty}>
            {t('deals.timeline.empty')}
          </Text>
        ) : null}
      </View>
    );
    body = (
      <KeyboardAvoidingView style={styles.fill} behavior="padding">
        <FlatList
          testID="deal-timeline"
          data={entries}
          extraData={toggle.isPending ? toggle.variables?.activityId : undefined}
          keyExtractor={(entry) => entry.id}
          renderItem={({ item }) => (
            <ActivityRow
              activity={item}
              canToggle={canUpdate}
              busy={toggle.isPending && toggle.variables?.activityId === item.id}
              onToggle={toggleEntry}
            />
          )}
          ListHeaderComponent={header}
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (activities.hasNextPage && !activities.isFetchingNextPage)
              void activities.fetchNextPage();
          }}
          ListFooterComponent={
            activities.isFetchingNextPage ? (
              <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
            ) : null
          }
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        />
        <StageSheet
          visible={moving}
          dealTitle={data.title}
          stages={stages}
          currentId={data.stage.id}
          onClose={() => setMoving(false)}
          onPick={(stage) => {
            setMoving(false);
            moveTo(data, stage);
          }}
        />
        {lostFor ? (
          <LostSheet
            dealTitle={data.title}
            canReadSettings={canReadSettings}
            pending={move.isPending || lost.isPending}
            error={lostError}
            onClose={() => setLostFor(null)}
            onConfirm={confirmLost}
          />
        ) : null}
        <ConfirmDialog
          visible={confirming}
          title={t('deals.delete.title')}
          message={t('deals.delete.message', { title: data.title })}
          confirmLabel={t('deals.delete.confirm')}
          cancelLabel={t('deals.cancel')}
          pending={remove.isPending}
          onConfirm={confirmDelete}
          onCancel={() => setConfirming(false)}
        />
      </KeyboardAvoidingView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t('deals.details.title')}
        onBack={goBack}
        actions={
          data ? (
            <>
              {canUpdate ? (
                <HeaderIconButton
                  icon="create-outline"
                  label={t('deals.actions.edit')}
                  onPress={() => router.push({ pathname: '/deal-form', params: { dealId: id } })}
                />
              ) : null}
              {canDelete ? (
                <HeaderIconButton
                  icon="trash-outline"
                  label={t('deals.actions.delete')}
                  onPress={() => setConfirming(true)}
                />
              ) : null}
            </>
          ) : null
        }
      />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
  content: { padding: spacing.lg, gap: spacing.lg },
  hero: { gap: spacing.xs },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detail: { gap: spacing.xs },
  empty: { paddingVertical: spacing.sm },
  footer: { paddingVertical: spacing.lg },
  listContent: { paddingBottom: spacing.xxl },
});
