import { fireEvent, screen } from '@testing-library/react-native';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { HelpArticleScreen } from './help-article-screen';
import { findDoc } from './help-data';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: { id?: string } = { id: 'saved-replies' };
jest.mock('expo-router', () => ({
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
  useLocalSearchParams: () => mockParams,
}));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  mockCanGoBack = true;
  mockParams = { id: 'saved-replies' };
});

describe('HelpArticleScreen', () => {
  it('shows the guide: title, summary and the body', async () => {
    await renderApp(<HelpArticleScreen />);
    const guide = findDoc('saved-replies')!.text.en;
    expect((await screen.findAllByText(guide.title)).length).toBeGreaterThan(0);
    expect(screen.getByText(guide.summary)).toBeTruthy();
    expect(screen.queryByText('This guide is only available in English.')).toBeNull();
  });

  it('says so when the guide is shown in English for another language', async () => {
    await initI18n('de');
    await renderApp(<HelpArticleScreen />);
    expect(await screen.findByText('Diese Anleitung ist nur auf Englisch verfügbar.')).toBeTruthy();
    await initI18n('en');
  });

  it('says so, instead of showing a blank page, when the address is not a guide', async () => {
    mockParams = { id: 'nope' };
    await renderApp(<HelpArticleScreen />);
    expect(await screen.findByText('This guide could not be found.')).toBeTruthy();
  });

  it('goes back, or to the Help list when there is nothing to go back to', async () => {
    await renderApp(<HelpArticleScreen />);
    await screen.findByRole('button', { name: 'Back' });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockBack).toHaveBeenCalled();
    mockCanGoBack = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(mockReplace).toHaveBeenCalledWith('/help');
  });

  it('opens another guide from a link inside a guide', async () => {
    mockParams = { id: 'team-inbox-overview' };
    await renderApp(<HelpArticleScreen />);
    const links = await screen.findAllByRole('link');
    expect(links.length).toBeGreaterThan(0);
    await fireEvent.press(links[0]!);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/help/[id]',
      params: { id: expect.any(String) },
    });
  });
});
