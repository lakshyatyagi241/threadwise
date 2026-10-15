// @vitest-environment jsdom
import type { ContactConsent } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  query: {} as Record<string, unknown>,
  record: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('../api/hooks', () => ({
  KEYS: { contact: (id: string) => ['contact-consent', 'contact', id] },
  useContactConsent: () => state.query,
}));
vi.mock('../api/service', () => ({
  consentApi: { record: (...a: unknown[]) => state.record(...a) },
  consentExportUrl: (id?: string) => `/api/v2/contact-consent/contacts/${id}/export`,
}));

import { ConsentCard, consentStatus } from './consent-card';

const consent = (over: Partial<ContactConsent> = {}): ContactConsent => ({
  contactId: 'c1',
  optedOut: false,
  states: [],
  events: [],
  ...over,
});
const q = (data: ContactConsent) => ({ isLoading: false, isError: false, error: null, data });

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['contacts.consent.read', 'contacts.consent.manage']);
  state.query = q(consent());
  state.record.mockReset();
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe('consentStatus', () => {
  it('opted out beats subscribed beats nothing recorded', () => {
    const granted = [
      { channel: 'whatsapp', purpose: 'marketing', state: 'granted', since: '2026-01-01' },
    ] as ContactConsent['states'];
    expect(consentStatus({ optedOut: true, states: granted })).toBe('optedOut');
    expect(consentStatus({ optedOut: false, states: granted })).toBe('subscribed');
    expect(consentStatus({ optedOut: false, states: [] })).toBe('none');
  });
});

describe('Consent card', () => {
  it('says "No consent recorded" for a contact with no history (consent is never invented)', async () => {
    m = await mount(<ConsentCard contactId="c1" />);
    expect(m.host.textContent).toContain(text('card.status.none'));
    expect(m.host.textContent).toContain(text('card.noneRecorded'));
  });

  it('shows the state per channel and the history with who, when, source, note and proof', async () => {
    state.query = q(
      consent({
        optedOut: true,
        states: [
          {
            channel: 'whatsapp',
            purpose: 'marketing',
            state: 'withdrawn',
            since: '2026-03-01T10:00:00Z',
          },
        ],
        events: [
          {
            id: 'e1',
            contactId: 'c1',
            channel: 'whatsapp',
            purpose: 'marketing',
            action: 'withdrawn',
            source: 'keyword',
            evidence: { keyword: 'stop', messageId: 'm-1', consentHash: 'abc' },
            actor: null,
            note: null,
            occurredAt: '2026-03-01T10:00:00Z',
            recordedAt: '2026-03-01T10:00:01Z',
          },
          {
            id: 'e0',
            contactId: 'c1',
            channel: 'whatsapp',
            purpose: 'marketing',
            action: 'granted',
            source: 'manual',
            evidence: {},
            actor: { id: 'u1', name: 'Dana Admin' },
            note: 'Signed the paper form',
            occurredAt: '2026-02-01T10:00:00Z',
            recordedAt: '2026-02-01T10:00:00Z',
          },
        ],
      }),
    );
    m = await mount(<ConsentCard contactId="c1" />);
    const t = m.host.textContent ?? '';
    expect(t).toContain(text('card.status.optedOut'));
    expect(t).toContain('WhatsApp: opted out');
    expect(t).toContain('Keyword reply');
    expect(t).toContain('Keyword: stop');
    expect(t).not.toContain('abc');
    expect(t).toContain('by Dana Admin');
    expect(t).toContain('Signed the paper form');
  });

  it('hides without the read permission and hides the buttons without the manage permission', async () => {
    state.perms = new Set();
    m = await mount(<ConsentCard contactId="c1" />);
    expect(m.host.querySelector('section')).toBeNull();
    await m.unmount();
    state.perms = new Set(['contacts.consent.read']);
    m = await mount(<ConsentCard contactId="c1" />);
    expect(m.host.textContent).toContain(text('card.title'));
    expect(m.host.textContent).not.toContain(text('card.markSubscribed'));
  });

  it('marking as subscribed needs a reason; marking as unsubscribed does not', async () => {
    state.record.mockResolvedValue(consent());
    m = await mount(<ConsentCard contactId="c1" />);
    await click(button(m.host, text('card.markSubscribed')));
    const confirm = button(m.host, text('card.dialog.confirm'));
    expect(confirm.disabled).toBe(true);
    await type(m.host.querySelector<HTMLTextAreaElement>('#consent-note')!, 'Agreed by email');
    expect(confirm.disabled).toBe(false);
    await click(confirm);
    expect(state.record).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ action: 'granted', note: 'Agreed by email', source: 'manual' }),
    );
    await m.unmount();

    state.record.mockClear();
    m = await mount(<ConsentCard contactId="c1" />);
    await click(button(m.host, text('card.markUnsubscribed')));
    const go = button(m.host, text('card.dialog.confirm'));
    expect(go.disabled).toBe(false);
    await click(go);
    expect(state.record).toHaveBeenCalledWith(
      'c1',
      expect.objectContaining({ action: 'withdrawn' }),
    );
  });

  it('renders in Arabic', async () => {
    m = await mount(<ConsentCard contactId="c1" />, { locale: 'ar' });
    expect(m.host.textContent).toContain(text('card.title', 'ar'));
    expect(m.host.textContent).not.toMatch(/contact-consent\./);
  });
});
