import { useQueryClient } from '@tanstack/react-query';
import * as Application from 'expo-application';
import * as Linking from 'expo-linking';
import { useRouter, type Href } from 'expo-router';
import { useState, type ReactNode } from 'react';
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
import { usePrivacyLink } from './use-privacy-link';
import { useUpdateCheck, type UpdateState } from './use-update-check';

const FADED = 0.4;

/** A line under an expanded row: where it goes, and the permission that opens it. */
interface Child {
  key: string;
  label: string;
  /** A function when the address depends on the moment of the tap. */
  href: Href | (() => Href);
  permission: string;
}

type Group = 'dashboard' | 'contacts';

/**
 * The Account tab, laid out like the reference app's menu: the person at the top, then sections (Workspace, Account, Preferences,
 * About) as one flat list. Dashboard and Contacts open a short list of their own screens. A module the person may not read stays in
 * the list, faded, and explains itself when pressed. Rows with nothing behind them yet (Settings, Away, Appearance, Help Center)
 * are not shown: see README.md.
 */
export function MenuScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useSession();
  const privacyLink = usePrivacyLink();
  const updates = useUpdateCheck();
  const [refreshing, setRefreshing] = useState(false);
  const [noAccess, setNoAccess] = useState(false);
  const [open, setOpen] = useState<Group | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const user = session.data?.user;
  const name = user?.displayName ?? user?.fullName ?? '';
  const roles = session.data?.roles.map((r) => r.name).join(', ') ?? '';
  const version = Application.nativeApplicationVersion;
  const allowed = (permission: string) => can(session.data, permission);
  // While the session loads nothing is faded: a row is not "locked" before the answer is known.
  const faded = (permission: string) => session.data !== undefined && !allowed(permission);

  const refresh = async () => {
    setRefreshing(true);
    await session.refetch();
    setRefreshing(false);
  };

  const go = (permission: string, href: Child['href']) => {
    if (!allowed(permission)) {
      setNoAccess(true);
      return;
    }
    setNoAccess(false);
    router.navigate(typeof href === 'function' ? href() : href);
  };

  const toggle = (group: Group, permission: string) => {
    if (!allowed(permission)) {
      setNoAccess(true);
      return;
    }
    setNoAccess(false);
    setOpen(open === group ? null : group);
  };

  // `at` changes on every tap, so choosing the same view again still reaches a screen that was switched by hand meanwhile.
  const dashboardView =
    (view: 'summary' | 'agent' | 'bot'): (() => Href) =>
    () => ({ pathname: '/', params: { view, at: String(Date.now()) } });
  const dashboardChildren: Child[] = [
    {
      key: 'summary',
      label: t('dashboard.views.summary'),
      href: dashboardView('summary'),
      permission: 'dash.dashboard.read',
    },
    {
      key: 'agent',
      label: t('dashboard.views.agent'),
      href: dashboardView('agent'),
      permission: 'dash.analytics.read',
    },
    {
      key: 'bot',
      label: t('dashboard.views.bot'),
      href: dashboardView('bot'),
      permission: 'dash.dashboard.read',
    },
  ];
  const contactChildren: Child[] = [
    {
      key: 'allContacts',
      label: t('menu.allContacts'),
      href: '/contacts',
      permission: 'record.contacts.read',
    },
    {
      key: 'newContact',
      label: t('menu.newContact'),
      href: '/contact/new',
      permission: 'record.contacts.create',
    },
  ];

  const confirmSignOut = async () => {
    setSigningOut(true);
    await signOut(queryClient);
  };

  return (
    <View style={[styles.fill, { backgroundColor: colors.surface }]}>
      <ScreenHeader>
        <Text variant="heading" accessibilityRole="header" style={styles.title}>
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
          style={[styles.profile, { borderBottomColor: colors.border }]}
        >
          <Avatar name={name} size={52} />
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

        <Section title={t('menu.workspace')}>
          <Row
            icon="grid-outline"
            label={t('menu.dashboard')}
            expanded={open === 'dashboard'}
            faded={faded('dash.dashboard.read')}
            onPress={() => toggle('dashboard', 'dash.dashboard.read')}
          />
          {open === 'dashboard' ? (
            <Children items={dashboardChildren} faded={faded} onOpen={go} />
          ) : null}
          <Row
            icon="chatbubbles-outline"
            label={t('menu.inbox')}
            faded={faded('inbox.conversation.read')}
            onPress={() => go('inbox.conversation.read', '/inbox')}
          />
          <Row
            icon="people-outline"
            label={t('menu.contacts')}
            expanded={open === 'contacts'}
            faded={faded('record.contacts.read')}
            onPress={() => toggle('contacts', 'record.contacts.read')}
          />
          {open === 'contacts' ? (
            <Children items={contactChildren} faded={faded} onOpen={go} />
          ) : null}
          <Row
            icon="clipboard-outline"
            label={t('menu.tasks')}
            faded={faded('record.tasks.read')}
            onPress={() => go('record.tasks.read', '/tasks')}
          />
        </Section>
        {noAccess ? (
          <View style={styles.notice}>
            <Banner tone="warning" message={t('menu.noAccess')} />
          </View>
        ) : null}

        <Section title={t('menu.sectionAccount')}>
          <Row
            icon="person-circle-outline"
            label={t('menu.manageProfile')}
            onPress={() => router.navigate('/profile')}
          />
        </Section>

        <Section title={t('menu.preferences')}>
          <Row
            icon="phone-portrait-outline"
            label={t('menu.devicePermissions')}
            hint={t('menu.devicePermissionsHint')}
            onPress={() => void Linking.openSettings()}
          />
        </Section>

        <Section title={t('menu.about')}>
          {privacyLink ? (
            <Row
              icon="shield-checkmark-outline"
              label={t('menu.dataSecurity')}
              onPress={() => void Linking.openURL(privacyLink)}
            />
          ) : null}
          <Row
            icon="sync-circle-outline"
            label={t('menu.checkUpdates')}
            busy={updates.state === 'checking'}
            onPress={() => (updates.state === 'ready' ? updates.apply() : void updates.check())}
          />
        </Section>
        <UpdateNote state={updates.state} />

        <View style={[styles.signOut, { borderTopColor: colors.border }]}>
          <Row
            icon="log-out-outline"
            label={t('common.signOut')}
            danger
            onPress={() => setConfirming(true)}
          />
        </View>

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

/** A grey band with the section's name, then its rows. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View>
      <View style={[styles.sectionBand, { backgroundColor: colors.background }]}>
        <Text variant="label" muted accessibilityRole="header">
          {title}
        </Text>
      </View>
      {children}
    </View>
  );
}

interface RowProps {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** A second line under the label. */
  hint?: string;
  /** Present for a row that opens a list: the chevron points down, or up while the list is open. */
  expanded?: boolean;
  faded?: boolean;
  busy?: boolean;
  danger?: boolean;
}

/** One line of the menu: an icon, the name, and a chevron when it opens a list. */
function Row({ icon, label, onPress, hint, expanded, faded, busy, danger }: RowProps) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{
        disabled: faded,
        busy,
        ...(expanded !== undefined ? { expanded } : {}),
      }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { borderBottomColor: colors.border, opacity: faded ? FADED : 1 },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      <Icon name={icon} size={22} color={danger ? 'danger' : 'primary'} />
      <View style={styles.rowText}>
        <Text variant="body" color={danger ? 'danger' : undefined} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" muted numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </View>
      {expanded !== undefined ? (
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color="textMuted" />
      ) : null}
    </Pressable>
  );
}

/** The lines under an open row, indented under its icon. */
function Children({
  items,
  faded,
  onOpen,
}: {
  items: readonly Child[];
  faded: (permission: string) => boolean;
  onOpen: (permission: string, href: Child['href']) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ backgroundColor: colors.background }}>
      {items.map((item) => (
        <Pressable
          key={item.key}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityState={{ disabled: faded(item.permission) }}
          onPress={() => onOpen(item.permission, item.href)}
          style={({ pressed }) => [
            styles.child,
            { borderBottomColor: colors.border, opacity: faded(item.permission) ? FADED : 1 },
            pressed && { backgroundColor: colors.surfaceMuted },
          ]}
        >
          <Text variant="body">{item.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** What the "Check for updates" row found, in a sentence under the About section. Nothing before the first tap. */
function UpdateNote({ state }: { state: UpdateState }) {
  const { t } = useTranslation();
  if (state === 'idle' || state === 'checking') return null;
  const tone = state === 'failed' ? 'danger' : 'info';
  return (
    <View style={styles.notice}>
      <Banner tone={tone} message={t(`menu.updates.${state}`)} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { textAlign: 'center' },
  content: { paddingBottom: spacing.xxl },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  profileText: { flex: 1, gap: 2 },
  sectionBand: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  row: {
    minHeight: MIN_TOUCH_TARGET + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1 },
  child: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingLeft: spacing.lg + 22 + spacing.lg,
    paddingRight: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  notice: { padding: spacing.lg },
  signOut: { marginTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
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
