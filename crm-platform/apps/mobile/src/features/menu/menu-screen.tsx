import { useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import * as Application from 'expo-application';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { Avatar } from '@/components/ui/avatar';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Icon, type IconName } from '@/components/ui/icon';
import { ScreenHeader } from '@/components/ui/screen-header';
import { Text } from '@/components/ui/text';
import { signOut } from '@/lib/auth/sign-out';
import { can, useSession } from '@/lib/session/use-session';
import { MIN_TOUCH_TARGET, radius, spacing } from '@/lib/theme/tokens';
import { useTheme } from '@/lib/theme/use-theme';

/** A row the person can open. A module they cannot read stays in the list, faded, and explains itself when pressed. */
interface Destination {
  key: 'summary' | 'inbox' | 'contacts' | 'tasks' | 'addTask';
  icon: IconName;
  href: Href;
  permission: string;
}

const DESTINATIONS: readonly Destination[] = [
  { key: 'summary', icon: 'grid-outline', href: '/', permission: 'dash.dashboard.read' },
  {
    key: 'inbox',
    icon: 'chatbubbles-outline',
    href: '/inbox',
    permission: 'inbox.conversation.read',
  },
  {
    key: 'contacts',
    icon: 'people-outline',
    href: '/contacts',
    permission: 'record.contacts.read',
  },
  { key: 'tasks', icon: 'checkbox-outline', href: '/tasks', permission: 'record.tasks.read' },
  {
    key: 'addTask',
    icon: 'add-circle-outline',
    href: '/task-form',
    permission: 'record.tasks.create',
  },
];

const FADED = 0.4;

export function MenuScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const [refreshing, setRefreshing] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const user = session.data?.user;
  const name = user?.displayName ?? user?.fullName ?? '';
  const roles = session.data?.roles.map((r) => r.name).join(', ') ?? '';
  const version = Application.nativeApplicationVersion;

  const refresh = async () => {
    setRefreshing(true);
    await session.refetch();
    setRefreshing(false);
  };

  const open = (d: Destination) => {
    if (!can(session.data, d.permission)) {
      setNoAccess(true);
      return;
    }
    setNoAccess(false);
    router.navigate(d.href);
  };

  const confirmSignOut = async () => {
    setSigningOut(true);
    await signOut(queryClient);
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <ScreenHeader>
        <Text variant="heading" accessibilityRole="header">
          {t('menu.title')}
        </Text>
      </ScreenHeader>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <View
          accessible
          accessibilityLabel={t('menu.profileLabel', { name, email: user?.email ?? '' })}
          style={[styles.profile, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Avatar name={name} size={56} />
          <View style={styles.profileText}>
            <Text variant="heading" numberOfLines={1}>
              {name}
            </Text>
            <Text muted numberOfLines={1}>
              {user?.email}
            </Text>
            {session.data ? (
              <Text variant="caption" muted numberOfLines={1}>
                {roles ? `${session.data.org.name} · ${roles}` : session.data.org.name}
              </Text>
            ) : null}
          </View>
        </View>

        <Text variant="overline" muted style={styles.section}>
          {t('menu.workspace')}
        </Text>
        <View
          style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          {DESTINATIONS.map((d, i) => {
            const allowed = can(session.data, d.permission);
            return (
              <Pressable
                key={d.key}
                accessibilityRole="button"
                accessibilityLabel={t(`menu.${d.key}`)}
                accessibilityState={{ disabled: !allowed }}
                onPress={() => open(d)}
                style={[
                  styles.row,
                  i > 0 && {
                    borderTopWidth: StyleSheet.hairlineWidth,
                    borderTopColor: colors.border,
                  },
                  { opacity: allowed || !session.data ? 1 : FADED },
                ]}
              >
                <Icon name={d.icon} size={22} color="primary" />
                <Text variant="label" style={styles.rowLabel}>
                  {t(`menu.${d.key}`)}
                </Text>
                <Icon name="chevron-forward" size={18} color="textMuted" />
              </Pressable>
            );
          })}
        </View>
        {noAccess ? <Banner tone="warning" message={t('menu.noAccess')} /> : null}

        <Button
          label={t('common.signOut')}
          variant="secondary"
          onPress={() => setConfirming(true)}
        />

        <View style={styles.about}>
          <Text variant="label" muted>
            {t('menu.appName')}
          </Text>
          {version ? (
            <Text variant="caption" muted>
              {t('menu.version', { version })}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <Modal
        transparent
        visible={confirming}
        animationType="fade"
        onRequestClose={() => setConfirming(false)}
      >
        <View style={[styles.scrim, { backgroundColor: colors.scrim }]}>
          <View
            accessibilityViewIsModal
            style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="heading" accessibilityRole="header">
              {t('menu.signOutTitle')}
            </Text>
            <Text muted>{t('menu.signOutConfirm')}</Text>
            <View style={styles.dialogButtons}>
              <View style={styles.fill}>
                <Button
                  label={t('menu.signOutNo')}
                  variant="secondary"
                  onPress={() => setConfirming(false)}
                />
              </View>
              <View style={styles.fill}>
                <Button
                  label={t('menu.signOutYes')}
                  loading={signingOut}
                  onPress={confirmSignOut}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: spacing.lg, gap: spacing.lg },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  profileText: { flex: 1, gap: 2 },
  section: { paddingHorizontal: spacing.xs },
  group: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  rowLabel: { flex: 1 },
  about: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg },
  scrim: { flex: 1, justifyContent: 'center', padding: spacing.xl },
  dialog: {
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dialogButtons: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.sm },
});
