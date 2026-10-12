import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { initI18n } from '@/lib/i18n';
import { Text } from './text';

/** What the text component appends for scripts that need room at the end of a line (a no-break space). */
const SLACK = String.fromCharCode(0xa0);

afterEach(async () => {
  await initI18n('en');
});

describe('Text in English', () => {
  beforeEach(async () => {
    await initI18n('en');
  });

  it('shows its text exactly as given', async () => {
    await render(<Text>Hello</Text>);
    expect(screen.getByText('Hello').props.children).toBe('Hello');
  });

  it('turns an overline into spaced capitals', async () => {
    await render(<Text variant="overline">Operator dashboard</Text>);
    const style = StyleSheet.flatten(screen.getByText('Operator dashboard').props.style);
    expect(style).toMatchObject({ textTransform: 'uppercase', letterSpacing: 1.2 });
  });
});

describe('Text in Hindi and Marathi', () => {
  it.each(['hi', 'mr'] as const)('adds room at the end of plain text (%s)', async (language) => {
    await initI18n(language);
    await render(<Text>नमस्ते</Text>);
    expect(screen.getByText('नमस्ते').props.children).toBe(`नमस्ते${SLACK}`);
  });

  it('treats a number and a run of strings and numbers as one piece of text', async () => {
    await initI18n('hi');
    await render(
      <>
        <Text testID="number">{42}</Text>
        <Text testID="run">
          {'डिलीवर हुए'} {1200}
        </Text>
      </>,
    );
    expect(screen.getByTestId('number').props.children).toBe(`42${SLACK}`);
    expect(screen.getByTestId('run').props.children).toBe(`डिलीवर हुए 1200${SLACK}`);
  });

  it('leaves text that holds other elements, and empty text, alone', async () => {
    await initI18n('hi');
    await render(
      <>
        <Text testID="nested">
          नमस्ते <Text>दुनिया</Text>
        </Text>
        <Text testID="empty">{null}</Text>
      </>,
    );
    expect(Array.isArray(screen.getByTestId('nested').props.children)).toBe(true);
    expect(screen.getByTestId('empty').props.children).toBeNull();
  });

  it('does not space out or capitalise an overline: it would pull the letters apart', async () => {
    await initI18n('hi');
    await render(<Text variant="overline">ऑपरेटर डैशबोर्ड</Text>);
    const style = StyleSheet.flatten(screen.getByText('ऑपरेटर डैशबोर्ड').props.style);
    expect(style.textTransform).toBeUndefined();
    expect(style.letterSpacing).toBeUndefined();
  });
});
