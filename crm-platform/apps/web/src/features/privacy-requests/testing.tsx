// Shared helpers of this feature's component tests (jsdom + react-dom/client). Not shipped: only *.test.tsx files import it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PrivacyRequest } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tree = { [key: string]: string | Tree };

export function loadMessages(locale: string): Tree {
  return JSON.parse(
    readFileSync(join(process.cwd(), 'messages', locale, 'privacy-requests.json'), 'utf8'),
  ) as Tree;
}

export const en = loadMessages('en');

/** The text of a key under `privacy-requests` in a locale (English by default). */
export function text(path: string, locale = 'en'): string {
  let cur: unknown = (locale === 'en' ? en : loadMessages(locale))['privacy-requests'];
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

/** A data request as the API sends it, for the component tests. */
export function makeRequest(over: Partial<PrivacyRequest> = {}): PrivacyRequest {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    reference: 'DSR-3F9A12BC',
    requestType: 'erasure',
    status: 'in_progress',
    subjectKind: 'contact',
    contactId: '22222222-2222-4222-8222-222222222222',
    leadId: null,
    subjectLabel: 'A. K. ••• 4821',
    requesterChannel: 'staff',
    internalNote: null,
    receivedAt: '2026-10-01T09:00:00.000Z',
    dueAt: '2026-10-31T09:00:00.000Z',
    daysLeft: 12,
    overdue: false,
    verificationMethod: 'known_contact',
    verificationEvidenceRef: 'TCK-77',
    verifiedAt: '2026-10-02T09:00:00.000Z',
    legalHold: false,
    legalHoldReason: null,
    restricted: false,
    restrictedAt: null,
    restrictionNotice: null,
    historyMode: 'delete',
    rejectionReason: null,
    dryRun: null,
    result: {},
    proof: null,
    completedAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    rowVersion: 1,
    allowed: { verify: true, export: true, erase: true, hold: true, reject: true },
    ...over,
  };
}
