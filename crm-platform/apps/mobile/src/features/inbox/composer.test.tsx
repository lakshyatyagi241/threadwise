import { act, fireEvent, screen } from '@testing-library/react-native';
import { createRef, useState } from 'react';
import { renderApp } from '@/test/render';
import { Composer, type ComposerHandle } from './composer';
import { resetRecentEmoji } from './emoji';

const handle = createRef<ComposerHandle>();

/** The box with its own text, as the thread screen holds it. */
function Harness({
  initial = '',
  mode = 'reply',
  onText,
  onPlus,
  onAi,
  onNote,
}: {
  initial?: string;
  mode?: 'reply' | 'note';
  onText?: (text: string) => void;
  onPlus?: () => void;
  onAi?: () => void;
  onNote?: () => void;
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
      handleRef={handle}
      onOpenPlus={onPlus}
      onOpenAi={onAi}
      onToggleNote={onNote}
    />
  );
}

const box = () => screen.getByLabelText('Message');
/** The formatting row shows while the box has focus, so a test focuses it first. */
const focus = async () => await fireEvent(box(), 'focus');
const select = async (start: number, end = start) => {
  await focus();
  await fireEvent(box(), 'selectionChange', { nativeEvent: { selection: { start, end } } });
};
const press = async (name: string) => await fireEvent.press(screen.getByRole('button', { name }));

beforeEach(() => resetRecentEmoji());

describe('Composer: formatting buttons', () => {
  it('shows the six formatting buttons while the box has focus, and hides them when it loses it', async () => {
    await renderApp(<Harness />);
    expect(screen.queryByLabelText('Message formatting')).toBeNull();
    await focus();
    expect(screen.getByLabelText('Message formatting')).toBeTruthy();
    for (const name of [
      'Bold',
      'Italic',
      'Underline',
      'Strikethrough',
      'Bulleted list',
      'Numbered list',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    await fireEvent(box(), 'blur');
    expect(screen.queryByLabelText('Message formatting')).toBeNull();
  });

  it('has none of them in an internal note', async () => {
    await renderApp(<Harness mode="note" />);
    await fireEvent(screen.getByLabelText('Internal note'), 'focus');
    expect(screen.queryByLabelText('Message formatting')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull();
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

describe('Composer: emoji (opened from the "+" sheet through the handle)', () => {
  const openEmoji = async () => {
    await act(async () => handle.current?.openEmoji());
  };

  it('opens a panel of emoji groups and puts the chosen one at the caret, keeping the panel open', async () => {
    await renderApp(<Harness initial="hello world" />);
    await select(5);
    await openEmoji();
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
    await openEmoji();
    await fireEvent.press(await screen.findByRole('button', { name: '😀' }));
    expect(box().props.value).toBe('say 😀 now');
  });

  it('switches between the groups and lists the ones used last first', async () => {
    await renderApp(<Harness />);
    await openEmoji();
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
    await openEmoji();
    await screen.findByRole('header', { name: 'Emoji' });
    await fireEvent.press(screen.getAllByRole('button', { name: 'Close' })[0]!);
    expect(screen.queryByRole('header', { name: 'Emoji' })).toBeNull();
  });
});

describe('Composer: the bar', () => {
  it('has the plus, the sparkle and the note bubble only when it is given what they open', async () => {
    await renderApp(<Harness />);
    expect(screen.queryByRole('button', { name: 'Attach a file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Smart AI Assistant' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Internal note' })).toBeNull();
  });

  it('calls what each button opens', async () => {
    const onPlus = jest.fn();
    const onAi = jest.fn();
    const onNote = jest.fn();
    await renderApp(<Harness onPlus={onPlus} onAi={onAi} onNote={onNote} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Attach a file' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Smart AI Assistant' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Internal note' }));
    expect(onPlus).toHaveBeenCalledTimes(1);
    expect(onAi).toHaveBeenCalledTimes(1);
    expect(onNote).toHaveBeenCalledTimes(1);
  });

  it('in a note has the bubble (leading back to the reply) and no plus or sparkle', async () => {
    await renderApp(<Harness mode="note" onPlus={jest.fn()} onAi={jest.fn()} onNote={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Reply' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.queryByRole('button', { name: 'Attach a file' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Smart AI Assistant' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
  });

  it('keeps the round send button off until there is text, and tells too long text', async () => {
    await renderApp(<Harness />);
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
    await fireEvent.changeText(box(), 'Hi');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState).toMatchObject({
      disabled: false,
    });
    await fireEvent.changeText(box(), 'a'.repeat(4097));
    expect(await screen.findByText('Messages can be up to 4096 characters.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });
});
