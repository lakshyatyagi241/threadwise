import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { I18nextProvider } from 'react-i18next';
import { BackHandler, Pressable, Text } from 'react-native';
import { TabsLayout } from '@/features/shell/tabs-layout';
import { i18n, initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import * as appLayout from '@/app/(app)/_layout';

jest.mock('@/lib/session/api');
// The theme sync has its own test; here it is only a child of the layout.
jest.mock('@/features/menu/theme-sync', () => ({ ThemeSync: () => null }));

// One client for the whole tree, as in the real root layout: the signed-in layout reads the session before it shows anything.
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Root() {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </I18nextProvider>
  );
}
function Tabs() {
  return <TabsLayout />;
}
const { router } = jest.requireActual<typeof import('expo-router')>('expo-router');
const OpenContact = () => (
  <Pressable
    accessibilityRole="button"
    onPress={() => router.push({ pathname: '/contact/[id]', params: { id: '42' } })}
  >
    <Text>OPEN CONTACT</Text>
  </Pressable>
);

/** The app's real nesting: root stack, the real signed-in layout (the one under test), the real tabs; a marker on each page. */
const structure = {
  _layout: Root,
  '(app)/_layout': appLayout,
  '(app)/(tabs)/_layout': Tabs,
  '(app)/(tabs)/index': () => <Text>DASHBOARD PAGE</Text>,
  '(app)/(tabs)/inbox': () => <Text>INBOX PAGE</Text>,
  '(app)/(tabs)/contacts': OpenContact,
  '(app)/(tabs)/menu': () => <Text>MENU PAGE</Text>,
  '(app)/contact/[id]': () => <Text>CONTACT PAGE</Text>,
};
const PAGES = ['DASHBOARD PAGE', 'INBOX PAGE', 'OPEN CONTACT', 'MENU PAGE', 'CONTACT PAGE'];
const showing = () => PAGES.filter((page) => screen.queryByText(page)).join();

/** Android's Back button as React Native delivers it: newest handler first; when none takes it, the app closes. */
type BackListener = Parameters<typeof BackHandler.addEventListener>[1];
const handlers: BackListener[] = [];
const backPress = { type: 'hardwareBackPress', timeStamp: 0 };
const back = async () => {
  let handled = false;
  await act(async () => {
    for (const handler of [...handlers].reverse()) {
      if (handler(backPress)) {
        handled = true;
        break;
      }
    }
  });
  return handled ? showing() : 'the app closes';
};

beforeAll(async () => {
  await initI18n('en');
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    handlers.push(handler);
    return { remove: () => handlers.splice(handlers.indexOf(handler), 1) } as never;
  });
});
beforeEach(() => {
  client.clear();
  handlers.length = 0;
  jest.mocked(fetchSession).mockResolvedValue(session);
});

describe('the Back button inside the signed-in app', () => {
  it('goes from a contact back to the Contacts list, then to the tab before it', async () => {
    await renderRouter(structure, { initialUrl: '/' });
    // The signed-in layout reads the session first (an account gate would replace the app), so the app opens a moment later.
    await screen.findByText('DASHBOARD PAGE');
    await fireEvent.press(screen.getByLabelText('Contacts'));
    await fireEvent.press(screen.getByText('OPEN CONTACT'));
    expect(showing()).toBe('CONTACT PAGE');
    expect(await back()).toBe('OPEN CONTACT');
    expect(await back()).toBe('DASHBOARD PAGE');
    expect(await back()).toBe('the app closes');
  });

  it('still has a screen to go back to when a contact is opened directly (a link, a notification, a reload)', async () => {
    await renderRouter(structure, { initialUrl: '/contact/42' });
    await screen.findByText('CONTACT PAGE');
    expect(showing()).toBe('CONTACT PAGE');
    expect(await back()).toBe('DASHBOARD PAGE');
  });
});
