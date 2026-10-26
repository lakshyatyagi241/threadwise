// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { AppointmentReminder } from '../api/schemas';
import { ReminderHistory } from './reminder-history';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const reminder = (over: Partial<AppointmentReminder> = {}): AppointmentReminder => ({
  kind: 'before',
  stepKind: 'reminder_24h',
  offsetMinutes: 1440,
  label: null,
  dueAt: '2030-01-14T10:00:00.000Z',
  status: 'sent',
  reason: null,
  channel: 'whatsapp',
  sentAt: '2030-01-14T10:00:05.000Z',
  attempts: [{ channel: 'whatsapp', status: 'sent', reason: null }],
  delivery: 'unknown',
  buttonReplies: [],
  ...over,
});

function mount(r: AppointmentReminder) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <ReminderHistory reminder={r} zone="UTC" />
      </NextIntlClientProvider>,
    );
  });
}
const text = () => document.body.textContent ?? '';

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the history of a reminder in the drawer', () => {
  it('says nothing about a step that went by its only channel with nothing to report', () => {
    mount(reminder());
    expect(document.querySelector('[data-testid="reminder-history"]')).toBeNull();
  });

  it('explains a fallback: the channels in order with the reason, and where it went', () => {
    mount(
      reminder({
        channel: 'email',
        attempts: [
          { channel: 'whatsapp', status: 'skipped', reason: 'template_unavailable' },
          { channel: 'email', status: 'sent', reason: null },
        ],
      }),
    );
    expect(text()).toContain('Sent by Email because the first channel could not deliver it.');
    expect(text()).toContain('WhatsApp: not used');
    expect(text()).toContain('The chosen WhatsApp template cannot be sent.');
    expect(text()).toContain('Email: sent');
  });

  it('shows what WhatsApp reported and the button taps with their times', () => {
    mount(
      reminder({
        delivery: 'delivered',
        buttonReplies: [
          { action: 'confirm', at: '2030-01-14T11:30:00.000Z' },
          { action: 'reschedule', at: '2030-01-14T12:00:00.000Z' },
        ],
      }),
    );
    expect(text()).toContain('WhatsApp reported it as delivered.');
    expect(text()).toContain('Tapped Confirm');
    expect(text()).toContain('Tapped Reschedule');
    expect(text()).not.toContain('Tapped Cancel');
  });

  it('shows why a step that was not sent did not go, per channel', () => {
    mount(
      reminder({
        status: 'skipped',
        channel: null,
        sentAt: null,
        attempts: [
          { channel: 'whatsapp', status: 'skipped', reason: 'no_consent' },
          { channel: 'email', status: 'skipped', reason: 'no_contact_point' },
        ],
      }),
    );
    expect(text()).toContain('No recorded consent.');
    expect(text()).toContain('The contact has no number or address for this channel.');
    expect(text()).not.toContain('Sent by');
  });
});
