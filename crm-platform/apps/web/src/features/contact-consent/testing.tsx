// Shared helpers of this feature's component tests (jsdom + react-dom/client). Not shipped: only *.test.tsx files import it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ToastProvider } from '@crm/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = { [key: string]: string | Tree };

export function loadMessages(locale: string): Tree {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'contact-consent.json'), 'utf8'),
  ) as Tree;
}

export const en = loadMessages('en');

/** The text of a key under `contact-consent` in a locale (English by default). */
export function text(path: string, locale = 'en'): string {
  let cur: unknown = (locale === 'en' ? en : loadMessages(locale))['contact-consent'];
  for (const part of path.split('.')) cur = (cur as Record<string, unknown>)[part];
  if (typeof cur !== 'string') throw new Error(`No message ${path}`);
  return cur;
}

// jsdom has no native <dialog> behaviour: the dialog's content is in the page either way.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}

export interface Mounted {
  host: HTMLElement;
  root: Root;
  unmount: () => Promise<void>;
}

export async function mount(
  el: ReactElement,
  opts: { locale?: string; client?: QueryClient } = {},
): Promise<Mounted> {
  const locale = opts.locale ?? 'en';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale={locale} messages={loadMessages(locale)} timeZone="UTC">
        <QueryClientProvider client={opts.client ?? new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return {
    host,
    root,
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

/** Types into a React-controlled input or textarea. */
export async function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
