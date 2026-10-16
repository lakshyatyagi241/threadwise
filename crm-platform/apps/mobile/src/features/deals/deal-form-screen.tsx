import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { DealEditor } from './deal-editor';
import {
  describeDealFailure,
  describeDealFormFailure,
  isNotFound,
  isPlanLocked,
  type DealField,
} from './deal-errors';
import {
  buildCreateBody,
  buildUpdateBody,
  contractProblems,
  emptyDeal,
  valuesOfDeal,
  type DealFormProblems,
  type DealFormValues,
} from './deal-validation';
import { firstParam } from './route-params';
import { dealKey, useBoard, useCreateDeal, useDeal, useUpdateDeal } from './use-deals';

type Failure = { banner: string | null; fields: Partial<Record<DealField, string>> };

/**
 * Add a deal (`?pipelineId=` and `?stageId=` say which column the round button was pressed in) or edit one (`?dealId=`). Saving a
 * new deal sends it once, whatever the connection does; saving an edit sends only what changed with the version that was read,
 * and a deal changed by someone else in the meantime is reloaded with a note to review it and save again.
 */
export function DealFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{
    dealId?: string | string[];
    pipelineId?: string | string[];
    stageId?: string | string[];
  }>();
  const dealId = firstParam(params.dealId);
  const pipelineParam = firstParam(params.pipelineId);
  const stageParam = firstParam(params.stageId);
  const editing = dealId !== '';
  const session = useSession();
  const canRead = can(session.data, 'record.deals.read');
  const canWrite = can(session.data, editing ? 'record.deals.update' : 'record.deals.create');
  const canReadContacts = can(session.data, 'record.contacts.read');
  const myId = session.data?.user.id;

  const deal = useDeal(dealId, editing && canWrite && canRead);
  // The pipeline's stages and currency: a new deal asks for the one it was opened from (else the workspace default).
  const pipelineId = editing ? deal.data?.pipeline.id : pipelineParam || undefined;
  const board = useBoard(
    pipelineId,
    {},
    canWrite && canRead && (!editing || deal.data !== undefined),
  );
  const create = useCreateDeal();
  const update = useUpdateDeal(dealId);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/deals'));
  const header = (
    <StackHeader
      title={editing ? t('deals.form.editTitle') : t('deals.form.addTitle')}
      onBack={goBack}
    />
  );
  const loading = (
    <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />
  );

  const showProblems = (problems: DealFormProblems) => {
    const fields: Failure['fields'] = {};
    for (const [field, key] of Object.entries(problems) as [
      DealField,
      NonNullable<DealFormProblems[keyof DealFormProblems]>,
    ][]) {
      fields[field] = t(key);
    }
    setFailure({ banner: null, fields });
  };

  let body;
  if (session.data === undefined) {
    body = loading;
  } else if (!canWrite || !canRead) {
    body = (
      <EmptyState
        icon="lock-closed-outline"
        title={editing ? t('deals.denied.editTitle') : t('deals.denied.createTitle')}
        hint={editing ? t('deals.denied.editHint') : t('deals.denied.createHint')}
      />
    );
  } else if (editing && !deal.data) {
    if (deal.isPending) body = loading;
    else if (isPlanLocked(deal.error)) {
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
  } else if (!board.data) {
    if (board.isPending) body = loading;
    else {
      body = (
        <View style={styles.pad}>
          <Card>
            <Text danger accessibilityRole="alert">
              {describeDealFailure(board.error, t)}
            </Text>
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void board.refetch()}
            />
          </Card>
        </View>
      );
    }
  } else {
    const current = deal.data;
    const stages = board.data.stages.map((s) => s.stage);
    const currency = current?.currency ?? board.data.pipeline.currency;
    const startStage =
      stages.find((s) => s.id === stageParam)?.id ??
      stages.find((s) => s.kind === 'open')?.id ??
      stages[0]?.id ??
      '';
    const initial: DealFormValues = current
      ? valuesOfDeal(current, myId)
      : emptyDeal(currency, startStage);

    const onSubmit = (values: DealFormValues) => {
      setFailure(null);
      setNotice(null);
      if (current) {
        const changes = buildUpdateBody(current, values, myId);
        if (Object.keys(changes).length === 0) {
          goBack();
          return;
        }
        const payload = { ...changes, rowVersion: current.rowVersion };
        const problems = contractProblems(payload, 'update');
        if (Object.keys(problems).length > 0) return showProblems(problems);
        update.mutate(payload, {
          onSuccess: goBack,
          onError: (error) => {
            const described = describeDealFormFailure(error, t);
            if (described.conflict) {
              setNotice(t('deals.form.conflict'));
              void queryClient.invalidateQueries({ queryKey: dealKey(dealId) });
            } else {
              setFailure(described);
            }
          },
        });
        return;
      }
      const payload = buildCreateBody(values, board.data?.pipeline.id);
      const problems = contractProblems(payload, 'create');
      if (Object.keys(problems).length > 0) return showProblems(problems);
      create.mutate(payload, {
        onSuccess: (created) => {
          // The new deal opens in place of the form, so Back returns to the list.
          router.replace({ pathname: '/deal/[id]', params: { id: created.id } });
        },
        onError: (error) => setFailure(describeDealFormFailure(error, t)),
      });
    };

    return (
      <DealEditor
        // Keyed by the version, so a reload after a conflict shows the other person's values.
        key={current?.rowVersion ?? 'new'}
        mode={editing ? 'edit' : 'create'}
        initial={initial}
        stages={stages}
        pipelineCurrency={board.data.pipeline.currency}
        canListTeam={canReadContacts}
        myId={myId}
        pending={create.isPending || update.isPending}
        banner={failure?.banner}
        notice={notice}
        serverErrors={failure?.fields}
        onBack={goBack}
        onSubmit={onSubmit}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      {header}
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pad: { padding: spacing.lg },
  loading: { marginTop: spacing.xxl },
});
