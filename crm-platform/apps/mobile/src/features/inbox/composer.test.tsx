import { fireEvent, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { renderApp } from '@/test/render';
import { Composer } from './composer';
import { resetRecentEmoji } from './emoji';

/** The box with its own text, as the thread screen holds it. */
function Harness({
  initial = '',
  mode = 'reply',
  onText,
}: {
  initial?: string;
  mode?: 'reply' | 'note';
  onText?: (text: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Composer
      mode={mode}
      value={value}
      onChange={(v) => {
        setValue(v);
        onText?.(v);
      }}
      onSend={jest.fn()}
    />
  );
}

const box = () => screen.getByLabelText('Message');
const select = async (start: number, end = start) =>
  await fireEvent(box(), 'selectionChange', { nativeEvent: { selection: { start, end } } });
const press = async (name: string) => await fireEvent.press(screen.getByRole('button', { name }));

beforeEach(() => resetRecentEmoji());

describe('Composer: formatting buttons', () => {
  it('has the six formatting buttons and the emoji button on a reply, as the web inbox does', async () => {
    await renderApp(<Harness />);
    expect(screen.getByLabelText('Message formatting')).toBeTruthy();
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Bulleted list',
      'Numbered list',
      'Insert an emoji',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('has none of them in a private note', async () => {
    await renderApp(<Harness mode="note" />);
    expect(screen.queryByLabelText('Message formatting')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Insert an emoji' })).toBeNull();
  });

  it('puts WhatsApp bold round the selected word, and takes it off with a second press', async () => {
    await renderApp(<Harness initial="say hello now" />);
    await select(4, 9);
    await press('Bold');
    expect(box().props.value).toBe('say *hello* now');
    await press('Bold');
    expect(box().props.value).toBe('say hello now');
  });

  it('writes italic and strikethrough marks, and widens a partly selected word to the whole word', async () => {
    await renderApp(<Harness initial="Hello wonderful world" />);
    await select(9, 12);
    await press('Italic');
    expect(box().props.value).toBe('Hello _wonderful_ world');
    await select(0, 5);
    await press('Strikethrough');
    expect(box().props.value).toBe('~Hello~ _wonderful_ world');
  });

  it('puts a pair of marks at the caret when nothing is selected', async () => {
    await renderApp(<Harness initial="hi " />);
    await select(3);
    await press('Bold');
    expect(box().props.value).toBe('hi **');
  });

  it('underlines the selection with a combining line, as the web does', async () => {
    await renderApp(<Harness initial="say hi now" />);
    await select(4, 6);
    await press('Underline');
    expect(box().props.value).toBe('say h̲i̲ now');
  });

  it('makes bullets and numbers of the lines under the selection', async () => {
    await renderApp(<Harness initial={'one\ntwo\nthree'} />);
    await select(0, 7);
    await press('Bulleted list');
    expect(box().props.value).toBe('- one\n- two\nthree');
    await select(0, 11);
    await press('Numbered list');
    expect(box().props.value).toBe('1. one\n2. two\nthree');
  });

  it('shows the button as pressed while the caret is inside that formatting', async () => {
    await renderApp(<Harness initial="a *bold* b" />);
    await select(4);
    expect(screen.getByRole('button', { name: 'Bold' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByRole('button', { name: 'Italic' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
    await select(0);
    expect(screen.getByRole('button', { name: 'Bold' }).props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('does not push the text over the length limit', async () => {
    const full = 'a'.repeat(4095);
    const seen = jest.fn();
    await renderApp(<Harness initial={full} onText={seen} />);
    await select(0, 4095);
    await press('Bold');
    // Two marks would make 4097 characters: the edit is dropped.
    expect(box().props.value).toBe(full);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('Composer: emoji', () => {
  it('opens a panel of emoji groups and puts the chosen one at the caret, keeping the panel open', async () => {
    await renderApp(<Harness initial="hello world" />);
    await select(5);
    await press('Insert an emoji');
    expect(await screen.findByRole('header', { name: 'Emoji' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '😀' }));
    expect(box().props.value).toBe('hello😀 world');
    // A second one lands after the first, and the panel is still there.
    await fireEvent.press(screen.getByRole('button', { name: '😃' }));
    expect(box().props.value).toBe('hello😀😃 world');
    expect(screen.getByRole('header', { name: 'Emoji' })).toBeTruthy();
  });

  it('replaces a selection with the emoji', async () => {
    await renderApp(<Harness initial="say hi now" />);
    await select(4, 6);
    await press('Insert an emoji');
    await fireEvent.press(await screen.findByRole('button', { name: '😀' }));
    expect(box().props.value).toBe('say 😀 now');
  });

  it('switches between the groups and lists the ones used last first', async () => {
    await renderApp(<Harness />);
    await press('Insert an emoji');
    expect(screen.queryByText('Recently used')).toBeNull();
    await fireEvent.press(await screen.findByRole('tab', { name: 'Gestures' }));
    await fireEvent.press(screen.getByRole('button', { name: '👍' }));
    expect(box().props.value).toBe('👍');
    expect(screen.getByText('Recently used')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Smileys' }));
    expect(screen.getByRole('button', { name: '😀' })).toBeTruthy();
  });

  it('closes with the close button', async () => {
    await renderApp(<Harness />);
    await press('Insert an emoji');
    await screen.findByRole('header', { name: 'Emoji' });
    await fireEvent.press(screen.getAllByRole('button', { name: 'Close' })[0]!);
    expect(screen.queryByRole('header', { name: 'Emoji' })).toBeNull();
  });
});
