import { fireEvent, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { initI18n } from '@/lib/i18n';
import { resolveLegalUrl } from '@/lib/links/legal-url';
import { renderApp } from '@/test/render';
import { findDoc } from './help-data';
import { HelpScreen } from './help-screen';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('@/lib/links/legal-url');
const resolveUrl = jest.mocked(resolveLegalUrl);

async function show() {
  await renderApp(<HelpScreen />);
  await screen.findByRole('header', { name: 'Help' });
}
const press = (name: string | RegExp) => fireEvent.press(screen.getByRole('button', { name }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  mockCanGoBack = true;
  resolveUrl.mockReturnValue('https://app.example.test/help');
});

describe('HelpScreen', () => {
  it('opens with the product bar, a welcome with three tips, and a card for each group of guides', async () => {
    await show();
    expect(screen.getByText('Geta CRM')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Help Center' })).toBeTruthy();
    expect(screen.getByText(/Everything you need to get the most out of the app/)).toBeTruthy();
    for (const lead of ['Get started quickly:', 'Explore key features:', 'Need help?']) {
      expect(screen.getByText(lead)).toBeTruthy();
    }
    expect(screen.getByText(/Dive in and get the most out of every conversation!/)).toBeTruthy();
    for (const name of [
      'Getting started',
      'Dashboard',
      'Inbox',
      'Contacts',
      'Settings',
      'Account',
      'Troubleshooting',
    ]) {
      expect(screen.getByRole('header', { name })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Saved replies' })).toBeTruthy();
  });

  it('opens a guide as its own screen', async () => {
    await show();
    await press('Saved replies');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/help/[id]',
      params: { id: 'saved-replies' },
    });
  });

  it('searches from the search button: the cards give way to matching guides, and come back when it closes', async () => {
    await show();
    expect(screen.queryByLabelText('Search guides')).toBeNull();
    await press('Search help guides');
    await fireEvent.changeText(screen.getByLabelText('Search guides'), 'saved replies');
    expect(screen.getByRole('button', { name: 'Saved replies' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Troubleshooting' })).toBeNull();
    await press('Close search');
    expect(screen.queryByLabelText('Search guides')).toBeNull();
    expect(screen.getByRole('header', { name: 'Troubleshooting' })).toBeTruthy();
  });

  it('says so when no guide matches', async () => {
    await show();
    await press('Search help guides');
    await fireEvent.changeText(screen.getByLabelText('Search guides'), 'zzzzqqq');
    expect(screen.getByText('No guide matches "zzzzqqq".')).toBeTruthy();
  });

  it('opens the guide menu, shows one group at a time, and opens a guide from it', async () => {
    await show();
    expect(screen.queryByRole('button', { name: 'Close the guide menu' })).toBeNull();
    await press('Open the guide menu');
    // Only the menu has buttons named after the groups (on the page they are headings).
    expect(screen.getByRole('button', { name: 'Inbox' }).props.accessibilityState.expanded).toBe(
      false,
    );
    await press('Inbox');
    expect(screen.getByRole('button', { name: 'Inbox' }).props.accessibilityState.expanded).toBe(
      true,
    );
    await press('Troubleshooting');
    expect(screen.getByRole('button', { name: 'Inbox' }).props.accessibilityState.expanded).toBe(
      false,
    );
    expect(
      screen.getByRole('button', { name: 'Troubleshooting' }).props.accessibilityState.expanded,
    ).toBe(true);
    // The guide is listed on the page and in the menu; the menu's is the last one drawn.
    await fireEvent.press(screen.getByRole('button', { name: 'Inbox' }));
    await fireEvent.press(
      screen.getAllByRole('button', { name: findDoc('waiting-queue')!.text.en.title }).at(-1)!,
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/help/[id]',
      params: { id: 'waiting-queue' },
    });
    expect(screen.queryByRole('button', { name: 'Close the guide menu' })).toBeNull();
  });

  it('offers the full web Help center in the browser as a last step, when the web address is known', async () => {
    await show();
    await press('Open the full Help Center. Opens in your browser');
    expect(Linking.openURL).toHaveBeenCalledWith('https://app.example.test/help');
  });

  it('shows no web button when the app does not know the web address', async () => {
    resolveUrl.mockReturnValue(null);
    await show();
    expect(screen.queryByRole('button', { name: /Open the full Help Center/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Saved replies' })).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    await show();
    await press('Back');
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack = false;
    await press('Back');
    expect(mockReplace).toHaveBeenCalledWith('/menu');
  });
});
