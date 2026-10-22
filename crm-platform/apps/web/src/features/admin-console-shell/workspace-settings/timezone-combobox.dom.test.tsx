// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { TimezoneCombobox } from './timezone-combobox';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ZONES = [
  'UTC',
  'Asia/Kolkata',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
];

let host: HTMLElement;
let root: Root;

function mount(value: string, onChange = vi.fn()) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <TimezoneCombobox id="ws-tz" value={value} zones={ZONES} onChange={onChange} />
      </NextIntlClientProvider>,
    );
  });
  return onChange;
}

const input = () => host.querySelector<HTMLInputElement>('input[role="combobox"]')!;
const listbox = () => host.querySelector<HTMLElement>('[role="listbox"]');
const optionTexts = () =>
  [...host.querySelectorAll<HTMLElement>('[role="option"]')].map((o) => o.textContent);

const open = () => act(() => input().click());
const type = (text: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
      input(),
      text,
    );
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
/** Returns true when the key was not cancelled (Enter on an open list must be cancelled, so the form does not submit). */
const key = (k: string) => {
  let live = false;
  act(() => {
    live = input().dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }),
    );
  });
  return live;
};
const leave = () => act(() => void input().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('TimezoneCombobox', () => {
  it('shows the chosen zone with the list closed', () => {
    mount('Asia/Kolkata');
    expect(input().value).toBe('Asia/Kolkata');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(listbox()).toBeNull();
  });

  it('opens with every zone and marks the chosen one', () => {
    mount('Asia/Kolkata');
    open();
    expect(optionTexts()).toEqual(ZONES);
    const chosen = [...host.querySelectorAll('[role="option"]')].find(
      (o) => o.textContent === 'Asia/Kolkata',
    );
    expect(chosen?.getAttribute('aria-selected')).toBe('true');
  });

  it('narrows the list as the search is typed, ignoring case and underscores', () => {
    mount('UTC');
    open();
    type('new york');
    expect(optionTexts()).toEqual(['America/New_York']);
    type('AMERICA/');
    expect(optionTexts()).toEqual(['America/New_York', 'America/Los_Angeles']);
  });

  it('says so when no zone matches', () => {
    mount('UTC');
    open();
    type('mars');
    expect(optionTexts()).toEqual([]);
    expect(host.textContent).toContain('No time zone matches.');
  });

  it('picks the highlighted match with the arrow keys and Enter, without submitting the form', () => {
    const onChange = mount('UTC');
    open();
    type('america');
    key('ArrowDown');
    expect(key('Enter')).toBe(false);
    expect(onChange).toHaveBeenCalledWith('America/Los_Angeles');
    expect(listbox()).toBeNull();
  });

  it('a click on an option picks it', () => {
    const onChange = mount('UTC');
    open();
    const london = [...host.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === 'Europe/London',
    )!;
    act(() => {
      london.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledWith('Europe/London');
  });

  it('Escape drops the search and keeps the chosen zone', () => {
    const onChange = mount('Asia/Kolkata');
    open();
    type('lon');
    key('Escape');
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
    expect(input().value).toBe('Asia/Kolkata');
  });

  it('leaving the box without a pick keeps the chosen zone', () => {
    const onChange = mount('Asia/Kolkata');
    open();
    type('lon');
    leave();
    expect(onChange).not.toHaveBeenCalled();
    expect(listbox()).toBeNull();
    expect(input().value).toBe('Asia/Kolkata');
  });

  it('cannot be opened while disabled', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(
        <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
          <TimezoneCombobox id="ws-tz" value="UTC" zones={ZONES} disabled onChange={vi.fn()} />
        </NextIntlClientProvider>,
      );
    });
    expect(input().disabled).toBe(true);
  });
});
