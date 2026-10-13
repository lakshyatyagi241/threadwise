import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { I18nextProvider } from 'react-i18next';
import { Text } from 'react-native';
import { i18n, initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
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
const tab = (name: 'Summary' | 'Inbox' | 'Contacts' | 'Menu') =>
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
    await tab('Summary');
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
