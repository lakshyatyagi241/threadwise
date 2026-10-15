import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { I18nextProvider } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';
import { i18n, initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { FONT_FAMILY } from '@/lib/theme/fonts';
import { palette } from '@/lib/theme/tokens';
import { session } from '@/test/dashboard-fixtures';
import { TabsLayout } from './tabs-layout';

jest.mock('@/lib/session/api');

const page = (name: string) => () => <Text>{name}</Text>;
const MARKERS = ['DASHBOARD', 'INBOX', 'CONTACTS', 'MENU'] as const;

/** The real tab layout inside the app's real nesting (root stack, app stack, tabs), with a marker on each page. */
function Tabs() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TabsLayout />
      </QueryClientProvider>
    </I18nextProvider>
  );
}
const structure = {
  _layout: () => <Stack screenOptions={{ headerShown: false }} />,
  '(app)/_layout': () => <Stack screenOptions={{ headerShown: false }} />,
  '(app)/(tabs)/_layout': Tabs,
  '(app)/(tabs)/index': page('DASHBOARD'),
  '(app)/(tabs)/inbox': page('INBOX'),
  '(app)/(tabs)/contacts': page('CONTACTS'),
  '(app)/(tabs)/menu': page('MENU'),
};

const showing = () => MARKERS.filter((m) => screen.queryByText(m)).join();
const tab = (name: 'Dashboard' | 'Inbox' | 'Contacts' | 'Menu') =>
  fireEvent.press(screen.getByLabelText(name));
/** What the phone's Back button does: the router goes back when it can; when it cannot, Android leaves the app. */
const back = async () => {
  if (!router.canGoBack()) return 'leaves the app';
  await act(async () => router.back());
  return showing();
};

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.mocked(fetchSession).mockResolvedValue(session);
});

describe('the tabs and the Back button', () => {
  it('goes back one tab at a time, to where the person came from', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    expect(showing()).toBe('DASHBOARD');
    await tab('Contacts');
    await tab('Menu');
    expect(showing()).toBe('MENU');
    expect(await back()).toBe('CONTACTS');
    expect(await back()).toBe('DASHBOARD');
    expect(await back()).toBe('leaves the app');
  });

  it('returns to the Menu after the Dashboard was opened from it, instead of leaving the app', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    await tab('Menu');
    // The Dashboard is the first tab: it used to be the one place Back could not return from.
    await tab('Dashboard');
    expect(showing()).toBe('DASHBOARD');
    expect(await back()).toBe('MENU');
    expect(await back()).toBe('DASHBOARD');
    expect(await back()).toBe('leaves the app');
  });

  it('counts a tab opened by address, as the Menu rows do, as a step too', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    await tab('Menu');
    await act(async () => router.navigate('/contacts'));
    expect(showing()).toBe('CONTACTS');
    expect(await back()).toBe('MENU');
    expect(await back()).toBe('DASHBOARD');
  });

  it('leaves the app from the first tab when there is nothing earlier', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    expect(await back()).toBe('leaves the app');
  });
});

describe('the look of the tab bar', () => {
  it('is the theme blue, with the words on it in the colour made for that blue', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    const backgrounds: unknown[] = [];
    for (let node = screen.getByLabelText('Inbox').parent; node; node = node.parent) {
      if (typeof node.type !== 'string') continue;
      backgrounds.push(StyleSheet.flatten(node.props.style)?.backgroundColor);
    }
    expect(backgrounds).toContain(palette.light.primary);
    const label = StyleSheet.flatten(screen.getByText('Inbox').props.style);
    expect(label.color).toBe(palette.light.onPrimary);
  });

  it('draws the tab that is not open a little softer than the open one', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    const opacityOf = (name: string) =>
      StyleSheet.flatten(screen.getByText(name).props.style).opacity as number;
    expect(opacityOf('Dashboard')).toBe(1);
    expect(opacityOf('Inbox')).toBeLessThan(1);
    expect(opacityOf('Inbox')).toBeGreaterThanOrEqual(0.8);
    await tab('Inbox');
    expect(opacityOf('Inbox')).toBe(1);
    expect(opacityOf('Dashboard')).toBeLessThan(1);
  });

  it('shows the words of the tab that is open in bold, and only those', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    // Bold is the Inter Bold file: the style carries a family per weight, not a fontWeight (see lib/theme/fonts).
    const familyOf = (name: string) =>
      StyleSheet.flatten(screen.getByText(name).props.style).fontFamily;
    expect(familyOf('Dashboard')).toBe(FONT_FAMILY.bold);
    expect(familyOf('Inbox')).not.toBe(FONT_FAMILY.bold);
    await tab('Inbox');
    expect(familyOf('Inbox')).toBe(FONT_FAMILY.bold);
    expect(familyOf('Dashboard')).not.toBe(FONT_FAMILY.bold);
    expect(familyOf('Contacts')).not.toBe(FONT_FAMILY.bold);
  });
});
