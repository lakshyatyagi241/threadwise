import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Icon, type IconName } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { can, useSession } from '@/lib/session/use-session';
import { useTheme } from '@/lib/theme/use-theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** A tab whose module the person cannot read stays visible but faded; its screen explains why (the API refuses regardless). */
const FADED = 0.4;

interface TabSpec {
  name: string;
  icon: IconName;
  iconFocused: IconName;
  label: 'summary' | 'inbox' | 'contacts' | 'menu';
  /** The permission that unlocks the tab; the menu is for everyone. */
  permission?: string;
}

const TABS: readonly TabSpec[] = [
  {
    name: 'index',
    icon: 'grid-outline',
    iconFocused: 'grid',
    label: 'summary',
    permission: 'dash.dashboard.read',
  },
  {
    name: 'inbox',
    icon: 'chatbubbles-outline',
    iconFocused: 'chatbubbles',
    label: 'inbox',
    permission: 'inbox.conversation.read',
  },
  {
    name: 'contacts',
    icon: 'people-outline',
    iconFocused: 'people',
    label: 'contacts',
    permission: 'record.contacts.read',
  },
  { name: 'menu', icon: 'menu-outline', iconFocused: 'menu', label: 'menu' },
];

/**
 * The phone's Back button undoes the last tab switch: it returns to the tab the person came from ("fullHistory", one step at a
 * time, like a web browser). The default only knows the first tab (the Dashboard), so after Menu -> Dashboard there was nothing to go
 * back to and Back closed the app. Plain "history" forgets the first visit of a tab that was visited twice, which brought the same
 * bug back (Dashboard -> Menu -> Dashboard -> Back -> Menu -> Back closed the app from the Menu). With nothing earlier, Back still
 * leaves the app, as on any Android home screen.
 */
const BACK_BEHAVIOR = 'fullHistory';

export function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const session = useSession();

  return (
    <Tabs
      backBehavior={BACK_BEHAVIOR}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          height: 56 + insets.bottom,
          paddingHorizontal: 8,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarItemStyle: { paddingBottom: 8, gap: 3 },
        tabBarLabelPosition: 'below-icon',
      }}
    >
      {TABS.map((tab) => {
        const faded =
          tab.permission !== undefined &&
          session.data !== undefined &&
          !can(session.data, tab.permission);
        const label = t(`tabs.${tab.label}`);
        return (
          <Tabs.Screen
            key={tab.name}
            name={tab.name}
            options={{
              title: label,
              tabBarAccessibilityLabel: label,
              tabBarIcon: ({ focused }) => (
                <Icon
                  name={focused ? tab.iconFocused : tab.icon}
                  size={22}
                  color={focused ? 'primary' : 'textMuted'}
                />
              ),
              tabBarLabel: ({ focused }) => (
                <Text
                  variant="caption"
                  color={focused ? 'primary' : 'textMuted'}
                  style={faded ? { opacity: FADED } : undefined}
                >
                  {label}
                </Text>
              ),
              tabBarItemStyle: { paddingBottom: 8, gap: 3, opacity: faded ? FADED : 1 },
            }}
          />
        );
      })}
    </Tabs>
  );
}
