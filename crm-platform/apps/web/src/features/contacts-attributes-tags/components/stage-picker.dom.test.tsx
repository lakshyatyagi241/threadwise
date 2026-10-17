// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { Choice } from '../lib/option-sets';
import { StagePicker, type StagePickerProps } from './stage-picker';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const STAGES: Choice[] = [
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'won', label: 'Won', isWon: true },
];
const MANY: Choice[] = Array.from({ length: 10 }, (_, i) => ({
  value: `s${i}`,
  label: `Stage ${i}`,
}));
const STATUSES: Record<string, Choice[]> = {
  qualified: [
    { value: 'waiting', label: 'Waiting for quote' },
    { value: 'sent', label: 'Quote sent' },
  ],
};

let host: HTMLElement;
let root: Root;

function mount(ui: ReactNode, locale: 'en' | 'ar' = 'en') {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
        {ui}
      </NextIntlClientProvider>,
    );
  });
}

const picker = (over: Partial<StagePickerProps> = {}) => {
  const onPick = vi.fn();
  mount(
    <StagePicker
      value="new"
      status={null}
      stages={STAGES}
      statusesOf={(s) => STATUSES[s] ?? []}
      defaultStatusOf={(s) => (s === 'qualified' ? 'waiting' : null)}
      hint={(s) => (s === 'won' ? 'Status will be cleared' : null)}
      name="Priya"
      onPick={onPick}
      {...over}
    />,
  );
  return onPick;
};

const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const panel = () => document.body.querySelector<HTMLElement>('[role="dialog"]');
const rows = () => [...document.body.querySelectorAll<HTMLElement>('[data-stage-row]')];
const key = (el: Element, k: string) =>
  act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));
const open = () => act(() => trigger().click());

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = '';
});

describe('StagePicker', () => {
  it('is a button that opens a vertical list with the current stage checked and a dot per stage', () => {
    picker();
    expect(panel()).toBeNull();
    open();
    expect(panel()).not.toBeNull();
    expect(rows().map((r) => r.querySelector('.truncate')!.textContent)).toEqual([
      'New',
      'Qualified',
      'Won',
    ]);
    expect(rows().filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(rows()[0]!.getAttribute('aria-checked')).toBe('true');
    expect(panel()!.querySelectorAll('[aria-hidden="true"].rounded-full')).toHaveLength(3);
    // never a horizontal scroller
    expect(panel()!.querySelector('ul')!.className).toContain('overflow-x-hidden');
    expect(panel()!.querySelector('ul')!.className).toContain('overflow-y-auto');
  });

  it('shows a search box only when there are more than eight stages, and it narrows the list', () => {
    picker();
    open();
    expect(panel()!.querySelector('input[type="search"]')).toBeNull();
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';

    picker({ stages: MANY, value: 's1', statusesOf: undefined });
    open();
    const search = panel()!.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search).not.toBeNull();
    expect(document.activeElement).toBe(search);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'stage 7',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(rows().map((r) => r.textContent)).toEqual(['Stage 7']);
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(
        search,
        'zzz',
      );
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(panel()!.textContent).toContain('No stage matches.');
  });

  it('moves at once to a stage that has no statuses', () => {
    const onPick = picker();
    open();
    act(() => rows()[2]!.click());
    expect(onPick).toHaveBeenCalledWith('won', undefined);
    expect(panel()).toBeNull();
  });

  it('shows the statuses of a stage that has them as small choices; a choice moves and sets it, "Move" uses the default', () => {
    const onPick = picker();
    open();
    act(() => rows()[1]!.click());
    expect(onPick).not.toHaveBeenCalled();
    const group = panel()!.querySelector('[role="group"]')!;
    expect(group.textContent).toContain('Waiting for quote');
    expect(group.textContent).toContain('default');
    act(() =>
      [...group.querySelectorAll('button')]
        .find((b) => b.textContent?.includes('Quote sent'))!
        .click(),
    );
    expect(onPick).toHaveBeenCalledWith('qualified', 'sent');

    open();
    act(() => rows()[1]!.click());
    const move = [...panel()!.querySelectorAll('button')].find(
      (b) => b.textContent === 'Move to Qualified',
    )!;
    act(() => move.click());
    expect(onPick).toHaveBeenLastCalledWith('qualified', undefined);
  });

  it('says what a move does to the status under the stage', () => {
    picker();
    open();
    expect(rows()[2]!.textContent).toContain('Status will be cleared');
    expect(rows()[0]!.textContent).not.toContain('Status will');
  });

  it('is driven by the keyboard: the cursor starts on the current stage, arrows move, Enter chooses, Escape closes and returns the focus', () => {
    const onPick = picker();
    open();
    expect(document.activeElement).toBe(rows()[0]);
    key(panel()!, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[1]);
    key(panel()!, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[2]);
    key(panel()!, 'ArrowDown');
    expect(document.activeElement).toBe(rows()[0]);
    key(panel()!, 'ArrowUp');
    expect(document.activeElement).toBe(rows()[2]);
    key(panel()!, 'End');
    expect(document.activeElement).toBe(rows()[2]);
    key(panel()!, 'Home');
    expect(document.activeElement).toBe(rows()[0]);
    // Enter is the button's own click
    act(() => rows()[2]!.click());
    expect(onPick).toHaveBeenCalledWith('won', undefined);

    open();
    key(panel()!, 'Escape');
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('closes on a press outside', () => {
    picker();
    open();
    act(() => void document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(panel()).toBeNull();
  });

  it('is plain text, with no button and no list, for someone who may not change the stage', () => {
    picker({ readOnly: true });
    expect(trigger()).toBeNull();
    expect(host.textContent).toContain('New');
    picker({ readOnly: true, look: 'field', triggerText: 'Qualified', progress: true });
    expect(host.querySelector('button')).toBeNull();
  });

  it('can offer "Keep" first (the bulk form), which means no stage', () => {
    const onPick = picker({ value: '', keepLabel: 'Keep as is', look: 'field' });
    expect(trigger().textContent).toContain('Keep as is');
    open();
    expect(rows()[0]!.textContent).toBe('Keep as is');
    expect(rows()[0]!.getAttribute('aria-checked')).toBe('true');
    act(() => rows()[3]!.click());
    expect(onPick).toHaveBeenCalledWith('won', undefined);
  });

  it('draws the field look with a prefix and the "n of m" hint', () => {
    picker({ look: 'field', prefix: 'Stage', triggerText: 'New', progress: true });
    expect(trigger().textContent).toContain('Stage');
    expect(trigger().textContent).toContain('New');
    expect(host.textContent).toContain('1 of 3');
  });

  it('becomes a bottom sheet on a phone', () => {
    const original = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    picker();
    open();
    expect(panel()!.className).toContain('bottom-0');
    expect(panel()!.className).toContain('rounded-t-2xl');
    Object.defineProperty(window, 'innerWidth', { value: original, configurable: true });
  });

  it('reads in Arabic', () => {
    mount(<StagePicker value="new" stages={STAGES} name="بريا" onPick={() => undefined} />, 'ar');
    open();
    expect(panel()!.getAttribute('aria-label')).not.toContain('contacts-attributes-tags');
  });
});
