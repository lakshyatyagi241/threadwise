import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { Linking } from 'react-native';
import { i18n, initI18n } from '@/lib/i18n';
import { LegalText, plainText } from './legal-text';

beforeAll(async () => {
  await initI18n('en');
});
afterEach(() => jest.restoreAllMocks());

const links = { terms: 'https://example.com/terms', privacy: '/legal/privacy', cookies: null };

const renderLegal = (key: 'auth.legalSignIn' | 'signUp.agree' = 'auth.legalSignIn') =>
  render(
    <I18nextProvider i18n={i18n}>
      <LegalText i18nKey={key} links={links} />
    </I18nextProvider>,
  );

describe('LegalText', () => {
  it('turns a name into a link when its address can be opened, and opens it', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    renderLegal();
    fireEvent.press(screen.getByRole('link', { name: 'Terms' }));
    expect(open).toHaveBeenCalledWith('https://example.com/terms');
  });

  it('leaves a name as plain text when its address cannot be opened (a path, and no web address configured)', () => {
    renderLegal();
    expect(screen.getByText('Privacy policy')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Privacy policy' })).toBeNull();
  });

  it('reads as one sentence in either wording', () => {
    renderLegal('signUp.agree');
    expect(screen.getByText('Terms')).toBeTruthy();
    expect(screen.getByText('Privacy policy')).toBeTruthy();
  });
});

describe('plainText', () => {
  it('drops the tags, so a screen reader reads the sentence for the checkbox', () => {
    expect(
      plainText('I agree to the <terms>Terms</terms> and <privacy>Privacy policy</privacy>.'),
    ).toBe('I agree to the Terms and Privacy policy.');
  });
});
