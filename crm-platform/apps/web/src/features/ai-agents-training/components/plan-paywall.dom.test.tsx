// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { PlanPaywall } from './plan-paywall';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// The AI Training page behind the sheet: one control the person could reach with Tab if the sheet did not take focus.
const page = (open: boolean) => (
  <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
    <main>
      <button id="page-behind" type="button">
        New assistant
      </button>
      {open && <PlanPaywall />}
    </main>
  </NextIntlClientProvider>
);

const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]');
const behind = () => host.querySelector<HTMLButtonElement>('#page-behind')!;

describe('the plan upgrade sheet takes focus and holds it (row 313)', () => {
  it('opening the sheet moves focus into the dialog and makes the page behind it inert', async () => {
    await act(async () => root.render(page(false)));
    behind().focus();

    await act(async () => root.render(page(true)));

    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(dialog());
    expect(behind().hasAttribute('inert')).toBe(true);
  });

  it('the dialog has an accessible name: the sheet title it is labelled by', async () => {
    await act(async () => root.render(page(true)));

    const labelledBy = dialog()!.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy!)?.textContent).toBe(
      'AI Training is not in your plan',
    );
  });

  it('Tab and Shift+Tab wrap inside the sheet at its first and last controls', async () => {
    await act(async () => root.render(page(true)));
    const link = host.querySelector<HTMLAnchorElement>('[role="dialog"] a')!;
    // A second control after the link, so the wrap has two ends to move between.
    const extra = document.createElement('button');
    extra.type = 'button';
    extra.textContent = 'Second';
    link.after(extra);

    const press = (el: HTMLElement, shiftKey: boolean) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      act(() => {
        el.dispatchEvent(event);
      });
      return event;
    };

    extra.focus();
    expect(press(extra, false).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(link);

    expect(press(link, true).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(extra);
  });

  it('closing the sheet gives focus back to the control that had it and releases the page', async () => {
    await act(async () => root.render(page(false)));
    behind().focus();
    await act(async () => root.render(page(true)));
    expect(document.activeElement).toBe(dialog());

    await act(async () => root.render(page(false)));

    expect(document.activeElement).toBe(behind());
    expect(behind().hasAttribute('inert')).toBe(false);
  });

  it('a fixed layer above the sheet (a toast or banner) stays usable', async () => {
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    document.body.appendChild(toast);
    try {
      await act(async () => root.render(page(true)));
      expect(toast.hasAttribute('inert')).toBe(false);
    } finally {
      toast.remove();
    }
  });

  it('a node added to the page while the sheet is open is inert too', async () => {
    await act(async () => root.render(page(true)));

    const late = document.createElement('p');
    late.textContent = 'Loaded later';
    host.querySelector('main')!.appendChild(late);
    await act(async () => undefined);

    expect(late.hasAttribute('inert')).toBe(true);
  });
});
