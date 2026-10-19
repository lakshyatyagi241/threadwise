import { WSP_INVITE_TTL_DAYS, type WspMember } from '@crm/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { StackHeader } from '@/components/ui/stack-header';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import { messageForError } from '@/lib/api/error-message';
import { SEARCH_DEBOUNCE_MS, useDebounced } from '@/lib/hooks/use-debounced';
import { useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';
import { LinkBanner } from './link-banner';
import { MemberActionsSheet } from './member-actions-sheet';
import { memberErrorText } from './member-errors';
import { MemberRow } from './member-row';
import { hasActions, seatsLine, tierQuery, visibleTiers, type FilterTier } from './member-rules';
import {
  membersKey,
  useChangeRole,
  useMemberList,
  useMembersSummary,
  useRemoveMember,
  useResendInvite,
  useResetPassword,
} from './use-members';

interface HandOver {
  key: string;
  title: string;
  body: string;
  link: string;
  email: string;
}

/**
 * Settings, Team members (TW-WSP-015 to 019): everyone with access to the workspace, highest role first, with the role counts as filters,
 * a search box, and the seats the plan allows. Every member may read the list; what a person may do to each row (change the role, send an
 * invite again, reset a password, remove) follows the web's rules and the summary the server sends, and the server stays the authority.
 * Inviting is a screen of its own. Leave and delegation (the web's "Leave and delegate") are not built here (see README).
 */
export function MembersScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);
  const [tier, setTier] = useState<FilterTier>('all');
  const summaryQuery = useMembersSummary();
  const list = useMemberList(q, tierQuery(tier));
  const changeRole = useChangeRole();
  const resend = useResendInvite();
  const reset = useResetPassword();
  const remove = useRemoveMember();
  const [menuFor, setMenuFor] = useState<WspMember | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'remove' | 'reset'; member: WspMember } | null>(
    null,
  );
  const [notice, setNotice] = useState<{ tone: 'info' | 'danger'; message: string } | null>(null);
  const [handOvers, setHandOvers] = useState<HandOver[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const summary = summaryQuery.data;
  const me = summary?.me;
  const seats = seatsLine(summary?.seats);
  const rows = useMemo(() => list.data?.pages.flatMap((p) => p.data) ?? [], [list.data]);
  const failed = summaryQuery.isError ? summaryQuery.error : list.isError ? list.error : null;
  const loading = summaryQuery.isPending || list.isPending;
  const count = q ? rows.length : (summary?.counts[tier] ?? rows.length);
  const seatLimit = summary?.seats.limit ?? null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/menu'));

  const changeRoleOf = async (member: WspMember, roleId: string) => {
    setNotice(null);
    try {
      await changeRole.mutateAsync({ member, roleId });
      setNotice({ tone: 'info', message: t('settings.members.roleUpdated') });
    } catch (e) {
      setNotice({
        tone: 'danger',
        message: t('settings.members.roleFailed', { reason: memberErrorText(e, t, seatLimit) }),
      });
    }
  };

  const confirmRemove = async (member: WspMember) => {
    try {
      await remove.mutateAsync(member);
      setNotice({ tone: 'info', message: t('settings.members.removed') });
    } catch (e) {
      setNotice({
        tone: 'danger',
        message: t('settings.members.removeFailed', { reason: memberErrorText(e, t, seatLimit) }),
      });
    } finally {
      setConfirm(null);
    }
  };

  /** A reset or a new invite: said as sent, or, when the server has no mail, the one-time link is shown to pass on by hand. */
  const handOver = async (member: WspMember, kind: 'reset' | 'resend') => {
    setNotice(null);
    try {
      const res = await (kind === 'reset' ? reset : resend).mutateAsync(member);
      const sent = t(
        kind === 'reset' ? 'settings.members.resetEmailed' : 'settings.members.resendEmailed',
        {
          email: member.email,
        },
      );
      if (!res.emailSent && res.inviteLink) {
        const link = res.inviteLink;
        setHandOvers((cur) => [
          {
            key: `${kind}:${member.id}`,
            title: t('settings.members.linkTitle', { name: member.fullName }),
            body:
              kind === 'reset'
                ? t('settings.members.linkReset')
                : t('settings.members.linkInvite', { count: WSP_INVITE_TTL_DAYS }),
            link,
            email: member.email,
          },
          ...cur.filter((h) => h.key !== `${kind}:${member.id}`),
        ]);
      }
      setNotice({ tone: 'info', message: sent });
    } catch (e) {
      setNotice({
        tone: 'danger',
        message: t(
          kind === 'reset' ? 'settings.members.resetFailed' : 'settings.members.resendFailed',
          {
            reason: memberErrorText(e, t, seatLimit),
          },
        ),
      });
    } finally {
      setConfirm(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: membersKey });
    setRefreshing(false);
  };

  let body;
  if (loading && rows.length === 0) {
    body = <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.loading} />;
  } else if (failed !== null) {
    body = (
      <View style={styles.pad}>
        <Card>
          <Text danger accessibilityRole="alert">
            {messageForError(failed, t)}
          </Text>
          <Button
            variant="secondary"
            label={t('common.retry')}
            onPress={() => {
              void summaryQuery.refetch();
              void list.refetch();
            }}
          />
        </Card>
      </View>
    );
  } else {
    body = (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <MemberRow
            member={item}
            isMe={item.id === me?.id}
            actionable={me !== undefined && hasActions(item, me)}
            onMore={setMenuFor}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text muted>
              {t('settings.members.subtitle', { workspace: session.data?.org.name ?? '' })}
            </Text>
            {me?.canInvite ? (
              <View style={styles.invite}>
                <Button
                  label={t('settings.members.invite')}
                  testID="member-invite"
                  onPress={() => router.push('/member-invite')}
                />
                {seats ? (
                  <Text
                    variant="caption"
                    color={seats.full ? 'warning' : 'textMuted'}
                    testID="member-seats"
                  >
                    {t(seats.full ? 'settings.members.seatsFull' : 'settings.members.seats', {
                      used: seats.used,
                      limit: seats.limit,
                    })}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {handOvers.map((h) => (
              <LinkBanner
                key={h.key}
                title={h.title}
                body={h.body}
                link={h.link}
                email={h.email}
                onDismiss={() => setHandOvers((cur) => cur.filter((x) => x.key !== h.key))}
              />
            ))}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              accessibilityRole="radiogroup"
              accessibilityLabel={t('settings.members.filterBy')}
              contentContainerStyle={styles.chips}
            >
              {visibleTiers(summary).map((value) => {
                const selected = tier === value;
                return (
                  <Pressable
                    key={value}
                    accessibilityRole="radio"
                    accessibilityLabel={`${t(`settings.members.filters.${value}`)} (${summary?.counts[value] ?? 0})`}
                    accessibilityState={{ selected }}
                    onPress={() => setTier(value)}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? colors.primarySoft : colors.surface,
                        borderColor: selected ? colors.primary : colors.borderStrong,
                      },
                    ]}
                  >
                    <Text variant="caption" color={selected ? 'primary' : 'text'}>
                      {`${t(`settings.members.filters.${value}`)} (${summary?.counts[value] ?? 0})`}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <TextField
              label={t('settings.members.searchLabel')}
              placeholder={t('settings.members.search')}
              value={search}
              onChangeText={setSearch}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Text variant="caption" muted testID="member-count">
              {t('settings.members.count', { count })}
            </Text>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={
              q !== '' || tier !== 'all'
                ? t('settings.members.emptyFiltered')
                : t('settings.members.emptyNone')
            }
          />
        }
        ListFooterComponent={
          list.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel={t('common.loading')} style={styles.footer} />
          ) : null
        }
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <StackHeader title={t('settings.members.title')} onBack={goBack} />
      {notice ? (
        <View style={styles.notice}>
          <Banner tone={notice.tone} message={notice.message} />
        </View>
      ) : null}
      <View style={styles.fill}>{body}</View>
      {summary ? (
        <MemberActionsSheet
          member={menuFor}
          summary={summary}
          onClose={() => setMenuFor(null)}
          onChangeRole={(member, roleId) => void changeRoleOf(member, roleId)}
          onResend={(member) => void handOver(member, 'resend')}
          onReset={(member) => setConfirm({ kind: 'reset', member })}
          onRemove={(member) => setConfirm({ kind: 'remove', member })}
        />
      ) : null}
      <ConfirmDialog
        visible={confirm !== null}
        title={t(
          confirm?.kind === 'remove'
            ? 'settings.members.removeTitle'
            : 'settings.members.resetTitle',
        )}
        message={t(
          confirm?.kind === 'remove'
            ? 'settings.members.removeMessage'
            : 'settings.members.resetMessage',
          {
            name: confirm?.member.fullName ?? '',
          },
        )}
        confirmLabel={t(
          confirm?.kind === 'remove'
            ? 'settings.members.removeConfirm'
            : 'settings.members.resetConfirm',
        )}
        cancelLabel={t('settings.members.cancel')}
        pending={remove.isPending || reset.isPending}
        onConfirm={() => {
          if (!confirm) return;
          if (confirm.kind === 'remove') void confirmRemove(confirm.member);
          else void handOver(confirm.member, 'reset');
        }}
        onCancel={() => setConfirm(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  loading: { marginTop: spacing.xl },
  pad: { padding: spacing.lg },
  notice: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  header: { gap: spacing.md, padding: spacing.lg },
  invite: { gap: spacing.xs },
  chips: { gap: spacing.sm },
  chip: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  footer: { paddingVertical: spacing.lg },
  listContent: { flexGrow: 1, paddingBottom: spacing.xxl },
});
