import { WSP_ASSIGNMENT_STRATEGIES, WSP_TEAM_NAME_MAX, type WspTeam } from '@crm/contracts';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { SelectField } from '@/components/ui/select-field';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { isApiError } from '@/lib/api';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { LabelDot } from './label-dot';
import { teamErrorText } from './team-errors';
import {
  draftOfTeam,
  emptyTeamDraft,
  nameProblem,
  sameColor,
  swatchesFor,
  toCreateInput,
  toUpdateInput,
  toggleId,
  type TeamDraft,
} from './team-rules';
import { useMembersSummary } from './use-members';
import {
  useAllMembers,
  useCreateTeam,
  useDeleteTeam,
  useTeamList,
  useUpdateTeam,
} from './use-teams';
import { ERROR_CODES } from '@crm/contracts';

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * Create a team, or edit one (`?teamId=`): its name, its colour, how new conversations are given out, and who is in it (Settings, Teams,
 * TW-WSP-022). The team is found in the list (there is no route for a single team), so editing one that was deleted meanwhile says so.
 * An edit carries the version that was read; a team changed by someone else is read again and the person reviews it and saves again.
 * Needs the right to manage teams (`inbox.team.manage`, the summary's `canManageTeams`). Deleting asks first.
 */
export function TeamFormScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ teamId?: string | string[] }>();
  const teamId = first(params.teamId);
  const editing = teamId !== '';
  const summaryQuery = useMembersSummary();
  const allowed = summaryQuery.data?.me.canManageTeams ?? false;
  const teams = useTeamList(allowed && editing);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/teams'));
  const rows = teams.data?.pages.flatMap((p) => p.data) ?? [];
  const current = rows.find((team) => team.id === teamId);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = teams;

  // The team may be on a later page of the list: keep reading until it is found or the list ends.
  useEffect(() => {
    if (editing && !current && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [editing, current, hasNextPage, isFetchingNextPage, fetchNextPage]);

  let body;
  if (
    summaryQuery.isPending ||
    (allowed && editing && !current && (teams.isPending || hasNextPage))
  ) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (summaryQuery.isError) {
    body = (
      <View style={styles.pad}>
        <Banner tone="danger" message={messageForError(summaryQuery.error, t)} />
        <Button
          variant="secondary"
          label={t('common.retry')}
          onPress={() => void summaryQuery.refetch()}
        />
      </View>
    );
  } else if (!allowed) {
    body = <EmptyState icon="lock-closed-outline" title={t('settings.teams.errors.forbidden')} />;
  } else if (editing && !current) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {teams.isError ? messageForError(teams.error, t) : t('settings.teams.errors.notFound')}
          </Text>
          {teams.isError ? (
            <Button
              variant="secondary"
              label={t('common.retry')}
              onPress={() => void teams.refetch()}
            />
          ) : null}
        </Card>
      </View>
    );
  } else {
    return (
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        <StackHeader
          title={t(editing ? 'settings.teams.editTitle' : 'settings.teams.createTitle')}
          onBack={goBack}
        />
        <TeamEditor key={current?.rowVersion ?? 'new'} team={current ?? null} onDone={goBack} />
      </View>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader
        title={t(editing ? 'settings.teams.editTitle' : 'settings.teams.createTitle')}
        onBack={goBack}
      />
      {body}
    </View>
  );
}

function TeamEditor({ team, onDone }: { team: WspTeam | null; onDone: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const create = useCreateTeam();
  const update = useUpdateTeam(team?.id ?? '');
  const remove = useDeleteTeam();
  const [draft, setDraft] = useState<TeamDraft>(team ? draftOfTeam(team) : emptyTeamDraft());
  const [nameError, setNameError] = useState<string | undefined>();
  const [banner, setBanner] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const members = useAllMembers(true);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = members;

  // Everyone is listed: pull pages until the list ends.
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const people = members.data?.pages.flatMap((p) => p.data) ?? [];
  const set = (patch: Partial<TeamDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const fail = (error: unknown) => {
    if (isApiError(error) && error.code === ERROR_CODES.WSP_TEAM_NAME_TAKEN) {
      setNameError(teamErrorText(error, t));
    }
    setBanner(
      t(team ? 'settings.teams.updateFailed' : 'settings.teams.createFailed', {
        reason: teamErrorText(error, t),
      }),
    );
  };

  const submit = () => {
    setBanner(null);
    const problem = nameProblem(draft.name);
    if (problem) {
      setNameError(
        problem === 'required'
          ? t('settings.teams.nameRequired')
          : t('settings.teams.nameTooLong', { max: WSP_TEAM_NAME_MAX }),
      );
      return;
    }
    if (team) update.mutate(toUpdateInput(draft, team), { onSuccess: onDone, onError: fail });
    else create.mutate(toCreateInput(draft), { onSuccess: onDone, onError: fail });
  };

  const confirmRemove = () => {
    if (!team) return;
    remove.mutate(team, {
      onSuccess: onDone,
      onError: (error) => {
        setConfirmDelete(false);
        setBanner(t('settings.teams.deleteFailed', { reason: teamErrorText(error, t) }));
      },
    });
  };

  const busy = create.isPending || update.isPending || remove.isPending;

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {banner ? <Banner tone="danger" message={banner} /> : null}
        <TextField
          label={t('settings.teams.name')}
          placeholder={t('settings.teams.namePlaceholder')}
          value={draft.name}
          onChangeText={(name) => {
            set({ name });
            setNameError(undefined);
          }}
          error={nameError}
          maxLength={WSP_TEAM_NAME_MAX}
          autoCapitalize="words"
          returnKeyType="done"
        />

        <View style={styles.group}>
          <Text variant="label">{t('settings.teams.color')}</Text>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('settings.teams.color')}
            style={styles.swatches}
          >
            {swatchesFor(draft.color).map((hex) => {
              const selected = sameColor(hex, draft.color);
              return (
                <Pressable
                  key={hex}
                  accessibilityRole="radio"
                  accessibilityLabel={t('settings.teams.colorOption', { color: hex })}
                  accessibilityState={{ selected }}
                  onPress={() => set({ color: hex })}
                  style={[
                    styles.swatch,
                    { borderColor: selected ? colors.primary : colors.border },
                  ]}
                >
                  <LabelDot color={hex} size={28} />
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.group}>
          <Text variant="label">{t('settings.teams.strategy')}</Text>
          <SelectField
            label={t('settings.teams.strategy')}
            placeholder={t('settings.teams.strategy')}
            value={draft.assignmentStrategy}
            options={WSP_ASSIGNMENT_STRATEGIES.map((s) => ({
              value: s,
              label: t(`settings.teams.strategyOptions.${s}`),
            }))}
            onChange={(value) =>
              set({ assignmentStrategy: value as TeamDraft['assignmentStrategy'] })
            }
          />
        </View>

        <View style={styles.group}>
          <Text variant="label">{t('settings.teams.membersLabel')}</Text>
          {members.isError ? (
            <Text danger accessibilityRole="alert">
              {t('settings.teams.membersFailed')}
            </Text>
          ) : members.isPending || hasNextPage ? (
            <ActivityIndicator accessibilityLabel={t('settings.teams.membersLoading')} />
          ) : people.length === 0 ? (
            <Text muted>
              {t(team ? 'settings.teams.membersNoneEdit' : 'settings.teams.membersNoneCreate')}
            </Text>
          ) : (
            <View style={[styles.people, { borderColor: colors.border }]}>
              {people.map((person) => (
                <Pressable
                  key={person.id}
                  accessible={false}
                  onPress={() => set({ memberIds: toggleId(draft.memberIds, person.id) })}
                  style={styles.person}
                >
                  <Checkbox
                    label={person.fullName}
                    checked={draft.memberIds.includes(person.id)}
                    onChange={() => set({ memberIds: toggleId(draft.memberIds, person.id) })}
                  />
                  <Avatar name={person.fullName} size={32} />
                  <Text numberOfLines={1} style={styles.personName}>
                    {person.fullName}
                  </Text>
                  <Text variant="caption" muted>
                    {t(`settings.members.presence.${person.presence}`)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <Button
          label={t(team ? 'settings.teams.save' : 'settings.teams.createSubmit')}
          testID="team-save"
          loading={create.isPending || update.isPending}
          disabled={busy}
          onPress={submit}
        />
        {team ? (
          <Button
            variant="secondary"
            label={t('settings.teams.delete')}
            testID="team-delete"
            disabled={busy}
            onPress={() => setConfirmDelete(true)}
          />
        ) : null}
      </ScrollView>
      <ConfirmDialog
        visible={confirmDelete}
        title={t('settings.teams.deleteTitle')}
        message={t('settings.teams.deleteMessage', { name: team?.name ?? '' })}
        confirmLabel={t('settings.teams.deleteConfirm')}
        cancelLabel={t('settings.members.cancel')}
        pending={remove.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setConfirmDelete(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { gap: spacing.md, padding: spacing.lg },
  content: { gap: spacing.lg, padding: spacing.lg, paddingBottom: spacing.xxl },
  group: { gap: spacing.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: {
    minWidth: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderRadius: radius.pill,
  },
  people: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.md },
  person: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingStart: spacing.md,
    paddingEnd: spacing.md,
  },
  personName: { flex: 1 },
});
