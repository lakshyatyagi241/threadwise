// Shared helpers of this feature's component tests (jsdom + react-dom/client). Not shipped: only *.test.tsx files import it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no native <dialog> behaviour: the dialog's content is in the page either way.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

type Tree = { [key: string]: string | Tree };
const cache = new Map<string, Tree>();
export function messagesFor(locale: string): Tree {
  let m = cache.get(locale);
  if (!m) {
    m = loadMessages(locale) as Tree;
    cache.set(locale, m);
  }
  return m;
}

/** The text of a key in a locale (`audit-log.title`, `notifications.page.title`). */
export function text(path: string, locale = 'en'): string {
  let cur: unknown = messagesFor(locale);
  for (const part of path.split('.')) cur = (cur as Record<string, unknown>)[part];
  if (typeof cur !== 'string') throw new Error(`No message ${path}`);
  return cur;
}

export interface Mounted {
  host: HTMLElement;
  unmount: () => Promise<void>;
}

export async function mount(el: ReactElement, opts: { locale?: string } = {}): Promise<Mounted> {
  const locale = opts.locale ?? 'en';
  const host = document.createElement('div');
  document.body.append(host);
  const root: Root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>{el}</QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return {
    host,
    unmount: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

export const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

export function byText(root: ParentNode, selector: string, label: string): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
    (e) => e.textContent?.trim() === label || e.getAttribute('aria-label') === label,
  );
  if (!found) throw new Error(`No ${selector} "${label}"`);
  return found;
}

export const button = (root: ParentNode, label: string) =>
  byText(root, 'button', label) as HTMLButtonElement;

/** Chooses an option of a native select. */
export async function choose(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
