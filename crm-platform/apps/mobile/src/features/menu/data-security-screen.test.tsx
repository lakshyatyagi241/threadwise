import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { DataSecurityScreen } from './data-security-screen';
import { fetchLegalLinks } from './links-api';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, back: mockBack, canGoBack: () => true }),
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('./links-api');
jest.mock('@/config/env', () => ({
  env: { ...jest.requireActual('@/config/env').env, webUrl: 'https://app.example.test' },
}));

const linksCall = jest.mocked(fetchLegalLinks);
const links = (terms: string, privacy: string) =>
  ({ links: { terms, privacy, cookies: null } }) as Awaited<ReturnType<typeof fetchLegalLinks>>;

async function show() {
  const view = await renderApp(<DataSecurityScreen />);
  await screen.findByRole('header', { name: 'Data & Security' });
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  linksCall.mockResolvedValue(links('/legal/terms', 'https://policy.example.test/privacy'));
});

describe('DataSecurityScreen', () => {
  it('lists the terms, the privacy policy and the request for account deletion', async () => {
    await show();
    for (const name of ['Terms of Use', 'Privacy Policy', 'Request for Account Deletion']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it("opens the platform's own terms on the app's own screen, and a policy pointed elsewhere in the browser", async () => {
    await show();
    await press('Terms of Use');
    expect(mockNavigate).toHaveBeenLastCalledWith({
      pathname: '/legal/[slug]',
      params: { slug: 'terms' },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
    await press('Privacy Policy');
    expect(Linking.openURL).toHaveBeenLastCalledWith('https://policy.example.test/privacy');
  });

  it("opens the app's own screen for each when no address is set, or the web address of the document is", async () => {
    linksCall.mockResolvedValue(links('', 'https://app.example.test/legal/privacy'));
    await show();
    await press('Terms of Use');
    expect(mockNavigate).toHaveBeenLastCalledWith({
      pathname: '/legal/[slug]',
      params: { slug: 'terms' },
    });
    await press('Privacy Policy');
    expect(mockNavigate).toHaveBeenLastCalledWith({
      pathname: '/legal/[slug]',
      params: { slug: 'privacy' },
    });
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it('says so when an address cannot be opened, instead of opening something else', async () => {
    linksCall.mockResolvedValue(
      links('javascript:alert(1)', 'https://policy.example.test/privacy'),
    );
    await show();
    expect(
      screen.getByRole('button', { name: 'Terms of Use' }).props.accessibilityState.disabled,
    ).toBe(true);
    await press('Terms of Use');
    expect(Linking.openURL).not.toHaveBeenCalled();
    expect(await screen.findByText(/This link is not available yet/)).toBeTruthy();
  });

  it('opens the account deletion screen', async () => {
    await show();
    await press('Request for Account Deletion');
    expect(mockNavigate).toHaveBeenCalledWith('/delete-account');
  });
});
