// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';
import { loadMessages } from '@/i18n/messages';
import { ENTITLEMENTS_KEY } from '@/lib/use-unofficial-whatsapp';
import { KEYS } from '../api/wizard';
import { draftResponse, session, sender, sources, templates, uuid } from '../testing';
import { CreateScreen } from '../../components/create-screen';
import { WizardScreen } from './wizard-screen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no modal <dialog>: open and close it by its attribute, which is all the screen's dialog needs.
HTMLDialogElement.prototype.showModal = function showModal() {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function close() {
  this.removeAttribute('open');
};

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  usePathname: () => '/campaigns/wizard',
  useSearchParams: () => new URLSearchParams(),
}));

const classic = sender({
  key: `waba:${uuid(51)}`,
  label: 'Acme Restricted',
  isDefault: true,
  guided: false,
});
const verified = sender({ key: `waba:${uuid(52)}`, label: 'Acme Support', isDefault: false });

function mount(
  senders: ReturnType<typeof sender>[],
  onClassic = vi.fn(),
  screen: 'wizard' | 'create' = 'wizard',
) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(ENTITLEMENTS_KEY, { features: [] });
  qc.setQueryData(KEYS.senders, { data: senders, hidden: [] });
  qc.setQueryData(KEYS.templates, { data: templates() });
  qc.setQueryData(KEYS.sources, sources());
  qc.setQueryData(KEYS.draft(uuid(100)), draftResponse({ name: 'x' }));
  qc.setQueryData(['contacts-attributes-tags', 'fields'], []);
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={qc}>
          <SessionProvider session={session()}>
            <ToastProvider dismissLabel="Dismiss">
              {screen === 'wizard' ? (
                <WizardScreen draftId={uuid(100)} onClassic={onClassic} />
              ) : (
                <CreateScreen sender="" draft={uuid(100)} />
              )}
            </ToastProvider>
          </SessionProvider>
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  return { root, host, onClassic };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('the guided flow with only numbers it cannot send from', () => {
  it('offers the switch to the classic builder at once, on the default number, instead of a blank picker', () => {
    const { root } = mount([classic]);
    const dialog = document.querySelector('dialog[open]');
    expect(dialog?.textContent).toContain('Acme Restricted');
    act(() => root.unmount());
  });

  it('does not interrupt when a verified number exists: it is picked for the person', () => {
    const { root } = mount([classic, verified]);
    expect(document.querySelector('dialog[open]')).toBeNull();
    const select = document.querySelector('#wizard-sender') as HTMLSelectElement | null;
    expect(select?.value).toBe(verified.key);
    act(() => root.unmount());
  });

  it('Campaigns, Create: a resumed draft with no verified number gets the same prompt', () => {
    const { root } = mount([classic], vi.fn(), 'create');
    expect(document.querySelector('dialog[open]')?.textContent).toContain('Acme Restricted');
    act(() => root.unmount());
  });
});
