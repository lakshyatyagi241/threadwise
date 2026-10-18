// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { newReminder, remindersToInput, type ReminderDraft } from '../lib/reminder-rules';
import { ReminderRulesEditor } from './reminder-rules-editor';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let latest: ReminderDraft[] = [];

/** Holds the list the way the booking type editor and the settings card do, and remembers the last value for the assertions. */
function Harness({ initial, disabled }: { initial: ReminderDraft[]; disabled?: boolean }) {
  const [rules, setRules] = useState(initial);
  return (
    <ReminderRulesEditor
      rules={rules}
      onChange={(next) => {
        latest = next;
        setRules(next);
      }}
      disabled={disabled ?? false}
      typeName="Check-up"
      templates={[{ id: 'tpl-1', name: 'visit_reminder', language: 'en' }]}
      idPrefix="t"
    />
  );
}

function mount(initial: ReminderDraft[] = [], disabled = false) {
  latest = initial;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <Harness initial={initial} disabled={disabled} />
      </NextIntlClientProvider>,
    );
  });
}

const buttons = () => [...document.querySelectorAll('button')];
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
function click(el: Element | null | undefined) {
  expect(el).toBeTruthy();
  act(() => {
    (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}
function type(el: Element | null, value: string) {
  expect(el).toBeTruthy();
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the reminder rules editor', () => {
  it('starts empty, says the contact only gets the confirmation, and offers the quick adds', () => {
    mount();
    expect(document.body.textContent).toContain('No reminders or follow-ups');
    for (const t of ['24 hours before', '1 hour before', '2 hours after', '1 day after']) {
      expect(byText(t), t).toBeDefined();
    }
  });

  it('adds a quick reminder OFF, with all channels, and the switch turns it on', () => {
    mount();
    click(byText('24 hours before'));
    expect(latest).toHaveLength(1);
    expect(latest[0]).toMatchObject({ kind: 'before', offset: '1', unit: 'days', enabled: false });
    expect(latest[0]!.channels).toEqual(['whatsapp', 'sms', 'email']);
    // a chip is used once
    expect((byText('24 hours before') as HTMLButtonElement).disabled).toBe(true);

    const sw = document.querySelector<HTMLElement>('[role="switch"]');
    expect(sw?.getAttribute('aria-checked')).toBe('false');
    click(sw);
    expect(latest[0]!.enabled).toBe(true);
    expect(remindersToInput(latest)[0]).toMatchObject({ isActive: true, offsetMinutes: 1440 });
  });

  it('adds a follow-up after the end, and the same moment before and after can both exist', () => {
    mount();
    click(byText('1 hour before'));
    click(byText('Add reminder'));
    expect(latest).toHaveLength(2);
    type(byLabel('Reminder 2, amount of time'), '60');
    act(() => {
      const kind = byLabel('Reminder 2, before or after') as HTMLSelectElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(
        kind,
        'after',
      );
      kind.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(latest.map((r) => [r.kind, r.offset, r.unit])).toEqual([
      ['before', '1', 'hours'],
      ['after', '60', 'minutes'],
    ]);
    expect(remindersToInput(latest).map((r) => [r.kind, r.offsetMinutes])).toEqual([
      ['before', 60],
      ['after', 60],
    ]);
  });

  it('shows the message editor with a live preview, the placeholders and the template picker only for WhatsApp', () => {
    mount();
    click(byText('Add reminder'));
    type(byLabel('Reminder 1, amount of time'), '30');
    // a rule added in this session opens its message editor by itself
    expect(byText('Hide')).toBeDefined();
    // the standard text is previewed with sample values and the service name
    expect(document.body.textContent).toContain('Preview');
    expect(document.body.textContent).toContain('Check-up coming up');
    const body = document.querySelector<HTMLTextAreaElement>('textarea')!;
    type(body, 'Hello {{name}}, {{type}} is at {{time}}');
    expect(latest[0]!.body).toBe('Hello {{name}}, {{type}} is at {{time}}');
    expect(document.body.textContent).toContain('Hello Alex, Check-up is at');
    // WhatsApp is among the channels: the template picker and the email subject are there
    expect(document.querySelector('select#t-template-' + latest[0]!.id)).not.toBeNull();
    expect(document.querySelector('input#t-subject-' + latest[0]!.id)).not.toBeNull();
    // dropping WhatsApp removes the picker
    click(byLabel('Do not use WhatsApp'));
    expect(latest[0]!.channels).toEqual(['sms', 'email']);
    expect(document.querySelector('select#t-template-' + latest[0]!.id)).toBeNull();
  });

  it('reorders the channels and never removes the last one', () => {
    mount([{ ...newReminder('15'), channels: ['whatsapp', 'sms'] }]);
    click(byText('Message and channels'));
    click(byLabel('Try SMS earlier'));
    expect(latest[0]!.channels).toEqual(['sms', 'whatsapp']);
    click(byLabel('Do not use SMS'));
    expect(latest[0]!.channels).toEqual(['whatsapp']);
    expect((byLabel('Do not use WhatsApp') as HTMLButtonElement).disabled).toBe(true);
  });

  it('inserts a placeholder into the message and removes a rule', () => {
    mount([newReminder('10')]);
    click(byText('Message and channels'));
    click(byText('{{join_link}}'));
    expect(latest[0]!.body).toContain('{{join_link}}');
    click(byLabel('Remove reminder 1'));
    expect(latest).toHaveLength(0);
  });

  it('is read-only when disabled', () => {
    mount([newReminder('10')], true);
    expect((document.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    expect((byText('Add reminder') as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel('Remove reminder 1') as HTMLButtonElement).disabled).toBe(true);
  });
});
