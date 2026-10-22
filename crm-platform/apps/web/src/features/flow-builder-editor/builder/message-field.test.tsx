// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageField } from './message-field';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/features/contacts-attributes-tags', () => ({
  usePickerFeed: () => ({ data: undefined }),
}));

let host: HTMLElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  // jsdom has no editing commands; the box asks the browser for them, so the test records the asks instead.
  document.execCommand = vi.fn(() => true);
  act(() => {
    root.render(<MessageField value="hello" onChange={vi.fn()} variables={[]} label="Message" />);
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Reflect.deleteProperty(document, 'execCommand');
});

const press = (init: KeyboardEventInit): KeyboardEvent => {
  const box = host.querySelector<HTMLElement>('[role="textbox"]')!;
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    box.dispatchEvent(ev);
  });
  return ev;
};

describe('the message box shortcuts', () => {
  it('Ctrl+B and Cmd+I ask for bold and italic, and the browser does not run its own', () => {
    const bold = press({ key: 'b', ctrlKey: true });
    expect(document.execCommand).toHaveBeenLastCalledWith('bold', false, undefined);
    expect(bold.defaultPrevented).toBe(true);

    const italic = press({ key: 'i', metaKey: true });
    expect(document.execCommand).toHaveBeenLastCalledWith('italic', false, undefined);
    expect(italic.defaultPrevented).toBe(true);
  });

  it('leaves plain letters and the Shift or Alt combinations alone', () => {
    const plain = press({ key: 'b' });
    press({ key: 'b', ctrlKey: true, shiftKey: true });
    press({ key: 'i', ctrlKey: true, altKey: true });
    expect(document.execCommand).not.toHaveBeenCalled();
    expect(plain.defaultPrevented).toBe(false);
  });
});
