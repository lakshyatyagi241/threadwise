import type { LegalPagePublic } from '@crm/contracts';
import { fireEvent, screen } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { fetchLegalPage } from './legal-api';
import { LegalScreen } from './legal-screen';

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: { slug?: string } = { slug: 'terms' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, canGoBack: () => mockCanGoBack }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-linking', () => ({ openURL: jest.fn().mockResolvedValue(true) }));
jest.mock('./legal-api');
const pageCall = jest.mocked(fetchLegalPage);

const page: LegalPagePublic = {
  slug: 'terms',
  title: 'Terms of Service',
  subtitle: 'Please read these terms.',
  updatedLabel: 'October 2026',
  effectiveLabel: '1 November 2026',
  readMinutes: 3,
  sections: [
    {
      n: '01',
      title: 'Agreement',
      body: '<p>By using Desk you <strong>agree</strong>. Write to <a href="mailto:legal@example.test">legal@example.test</a>.</p>',
    },
    {
      n: '02',
      title: 'Your account',
      body: '<ol><li>Keep it safe</li><li>Tell us of misuse</li></ol>',
    },
  ],
};

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = true;
  mockParams = { slug: 'terms' };
  pageCall.mockResolvedValue(page);
});

describe('LegalScreen', () => {
  it('shows the document: title, subtitle, dates, numbered sections and their text', async () => {
    await renderApp(<LegalScreen />);
    expect((await screen.findAllByText('Terms of Service')).length).toBeGreaterThan(0);
    expect(pageCall).toHaveBeenCalledWith('terms', expect.anything());
    expect(screen.getByText('Please read these terms.')).toBeTruthy();
    expect(screen.getByText('Updated: October 2026')).toBeTruthy();
    expect(screen.getByText('Effective: 1 November 2026')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Agreement' })).toBeTruthy();
    expect(screen.getByText('01')).toBeTruthy();
    expect(screen.getByText(/By using Desk you/)).toBeTruthy();
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('Tell us of misuse')).toBeTruthy();
  });

  it('opens an email link of the document outside the app', async () => {
    await renderApp(<LegalScreen />);
    await fireEvent.press(await screen.findByRole('link', { name: 'legal@example.test' }));
    expect(Linking.openURL).toHaveBeenCalledWith('mailto:legal@example.test');
  });

  it('shows the privacy policy for its own address, with the screen titled before it loads', async () => {
    mockParams = { slug: 'privacy' };
    pageCall.mockReturnValue(new Promise(() => undefined));
    await renderApp(<LegalScreen />);
    expect(screen.getByRole('header', { name: 'Privacy Policy' })).toBeTruthy();
    expect(screen.getByLabelText('Loading…')).toBeTruthy();
    expect(pageCall).toHaveBeenCalledWith('privacy', expect.anything());
  });

  it('says why and offers Try again when the document cannot be read', async () => {
    pageCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    pageCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await renderApp(<LegalScreen />);
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    pageCall.mockResolvedValue(page);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect((await screen.findAllByText('Terms of Service')).length).toBeGreaterThan(0);
  });

  it('says the document is not available for an address that is not one, and asks nothing', async () => {
    mockParams = { slug: 'nope' };
    await renderApp(<LegalScreen />);
    expect(await screen.findByText('This document is not available right now.')).toBeTruthy();
    expect(pageCall).not.toHaveBeenCalled();
  });

  it('goes back, or to Data & Security when there is nothing to go back to', async () => {
    await renderApp(<LegalScreen />);
    await screen.findByRole('button', { name: 'Back' });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockReplace).toHaveBeenCalledWith('/data-security');
  });
});
