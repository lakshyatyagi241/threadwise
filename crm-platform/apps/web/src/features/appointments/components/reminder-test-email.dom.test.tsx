// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { ApiError } from '@/lib/api/errors';
import { buildStep } from '../lib/reminder-timeline';
import type { ReminderDraft } from '../lib/reminder-rules';

const api = vi.hoisted(() => ({ testEmail: vi.fn() }));
vi.mock('../api/sequences-service', () => ({ sequencesApi: api }));

import { ReminderTestEmail } from './reminder-test-email';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
const saved: ReminderDraft = { ...buildStep('reminder_24h'), serverId: 'rule-1' };

function mount(rule: ReminderDraft, over: { dirty?: boolean; canEdit?: boolean } = {}) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <ReminderTestEmail
          typeId="type-1"
          rule={rule}
          dirty={over.dirty ?? false}
          canEdit={over.canEdit ?? true}
        />
      </NextIntlClientProvider>,
    );
  });
}
const button = () =>
  [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('test email')) as
    HTMLButtonElement | undefined;
const send = async () => {
  await act(async () => {
    button()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
  });
};

beforeEach(() => api.testEmail.mockReset());
afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the email test of a step', () => {
  it('sends the saved step and says where it went', async () => {
    api.testEmail.mockResolvedValue({ status: 'queued', reason: null, sentTo: 'a***@example.com' });
    mount(saved);
    expect(button()!.disabled).toBe(false);
    await send();
    expect(api.testEmail).toHaveBeenCalledWith('type-1', 'rule-1', undefined);
    expect(document.body.textContent).toContain('on its way to a***@example.com');
    expect(document.body.textContent).toContain('WhatsApp messages cannot be tested from here');
  });

  it('says so when the signed-in user has no address', async () => {
    api.testEmail.mockResolvedValue({ status: 'skipped', reason: 'no_address', sentTo: null });
    mount(saved);
    await send();
    expect(document.body.textContent).toContain('your user has no email address');
  });

  it('waits for a save when there are unsaved changes or the step is new', async () => {
    mount(saved, { dirty: true });
    expect(button()!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Save your changes first');
    await send();
    expect(api.testEmail).not.toHaveBeenCalled();
    act(() => root.unmount());
    document.body.innerHTML = '';
    mount({ ...saved, serverId: undefined });
    expect(button()!.disabled).toBe(true);
    expect(document.body.textContent).toContain('this step is new');
  });

  it('is not offered for a WhatsApp-only step or to a viewer', () => {
    mount({ ...saved, channels: ['whatsapp'] });
    expect(button()).toBeUndefined();
    act(() => root.unmount());
    document.body.innerHTML = '';
    mount(saved, { canEdit: false });
    expect(button()).toBeUndefined();
  });

  it('sends to a typed address, and refuses an incomplete one', async () => {
    api.testEmail.mockResolvedValue({ status: 'queued', reason: null, sentTo: 'c***@example.org' });
    mount(saved);
    const input = document.querySelector('input[type="email"]') as HTMLInputElement;
    const type = (v: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    type('colleague@');
    expect(button()!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Enter a complete email address');
    type('colleague@example.org');
    expect(button()!.disabled).toBe(false);
    await send();
    expect(api.testEmail).toHaveBeenCalledWith('type-1', 'rule-1', 'colleague@example.org');
  });

  it('shows a failed call', async () => {
    // A plain function, not a spy: a spy keeps its own copy of the rejected promise and reports it as unhandled.
    const spy = api.testEmail;
    api.testEmail = (() => Promise.reject(new ApiError(403, 'FORBIDDEN', 'no'))) as never;
    mount(saved);
    await send();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    api.testEmail = spy;
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
  });
});
