import { fireEvent, render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@/lib/i18n';
import { PasswordField } from './password-field';

beforeAll(async () => {
  await initI18n('en');
});

const renderField = async () =>
  await render(
    <I18nextProvider i18n={i18n}>
      <PasswordField label="Password" value="secret" onChangeText={() => undefined} />
    </I18nextProvider>,
  );

describe('PasswordField', () => {
  it('hides what was typed until the person asks to see it', async () => {
    await renderField();
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
  });

  it('shows and hides the password with the switch, and the switch says what it will do next', async () => {
    await renderField();
    await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Hide password' }));
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
  });

  it('keeps the text from being capitalised or auto-corrected', async () => {
    await renderField();
    const input = screen.getByLabelText('Password');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.autoCorrect).toBe(false);
  });
});
