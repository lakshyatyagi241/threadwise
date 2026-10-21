// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';
import { buildStep, type StepChoice } from '../lib/reminder-timeline';
import { remindersToInput, type ReminderDraft } from '../lib/reminder-rules';
import { ReminderTimeline } from './reminder-timeline';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let latest: ReminderDraft[] = [];

function Harness({ initial, disabled }: { initial: ReminderDraft[]; disabled: boolean }) {
  const [rules, setRules] = useState(initial);
  return (
    <ReminderTimeline
      rules={rules}
      onChange={(next) => {
        latest = next;
        setRules(next);
      }}
      disabled={disabled}
      typeName="Check-up"
      templates={[{ id: 'tpl-1', name: 'visit_reminder', language: 'en' }]}
      idPrefix="t"
    />
  );
}

/** `features`: the plan's features (null = unknown plan, everything on). */
function mount(
  initial: ReminderDraft[] = [],
  opts: { disabled?: boolean; features?: string[] | null } = {},
) {
  latest = initial;
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <PlanFeaturesProvider features={opts.features ?? null}>
          <Harness initial={initial} disabled={opts.disabled ?? false} />
        </PlanFeaturesProvider>
      </NextIntlClientProvider>,
    );
  });
}

const buttons = () => [...document.querySelectorAll('button')];
const byText = (text: string) => buttons().find((b) => b.textContent?.trim() === text);
const byLabel = (label: string) => document.querySelector<HTMLElement>(`[aria-label="${label}"]`);
const items = () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const itemText = (text: string) => items().find((i) => i.textContent?.includes(text));
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
const addViaMenu = (label: string) => {
  click(byText('Add step'));
  click(itemText(label));
};
const card = (step: string) => document.querySelector<HTMLElement>(`[data-step="${step}"]`);
const idOf = (kind: string, i = 0) => `t-${kind}-${latest[i]!.id}`;

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = '';
});

describe('the reminder timeline', () => {
  it('shows the three lanes in order and says how to start', () => {
    mount();
    const lanes = [...document.querySelectorAll('h4')].map((h) => h.textContent);
    expect(lanes).toEqual(['When it is booked', 'Before the appointment', 'After the appointment']);
    expect(document.body.textContent).toContain('No steps yet');
    expect(document.body.textContent).toContain('0 of 5 steps with a time');
  });

  it('adds each kind of step OFF, in its lane, with a card that names it', () => {
    mount();
    addViaMenu('Booking confirmation');
    addViaMenu('24 hours before');
    addViaMenu('No-show message');
    addViaMenu('Rebook message, some days later');
    expect(latest.map((r) => r.stepKind)).toEqual([
      'confirmation',
      'reminder_24h',
      'no_show',
      'rebook',
    ]);
    expect(latest.every((r) => !r.enabled)).toBe(true);
    const lanes = [...document.querySelectorAll('ol > li')];
    expect(lanes[0]!.querySelector('[data-step="confirmation"]')).not.toBeNull();
    expect(lanes[1]!.querySelector('[data-step="reminder_24h"]')).not.toBeNull();
    expect(lanes[2]!.querySelector('[data-step="no_show"]')).not.toBeNull();
    expect(lanes[2]!.querySelector('[data-step="rebook"]')).not.toBeNull();
    // the saved shape is the one the API takes
    expect(remindersToInput(latest).map((r) => [r.stepKind, r.kind, r.offsetMinutes])).toEqual([
      ['confirmation', 'event', 0],
      ['no_show', 'event', 1],
      ['reminder_24h', 'before', 1440],
      ['rebook', 'after', 43_200],
    ]);
  });

  it('opens the message editor of a step it just added', () => {
    mount();
    addViaMenu('2 hours before');
    expect(document.querySelector('textarea')).not.toBeNull();
  });

  it('disables a step that is already there, and every timed step at the cap of five', () => {
    const five: StepChoice[] = [
      'reminder_24h',
      'reminder_2h',
      'reminder_15m',
      'after_visit',
      'rebook',
    ];
    mount(five.map((c) => buildStep(c)));
    expect(document.body.textContent).toContain('5 of 5 steps with a time');
    expect(document.body.textContent).toContain('You have reached 5 steps with a time');
    click(byText('Add step'));
    expect(itemText('24 hours before')!.getAttribute('aria-disabled')).toBe('true');
    expect(itemText('Reminder at another time')!.getAttribute('aria-disabled')).toBe('true');
    expect(itemText('Reminder at another time')!.textContent).toContain('Limit reached');
    // the two event steps are not counted
    expect(itemText('Booking confirmation')!.getAttribute('aria-disabled')).toBeNull();
    click(itemText('Reminder at another time'));
    expect(latest).toHaveLength(5);
  });

  it('shows the state of the WhatsApp template and the email fallback', () => {
    const base = { ...buildStep('reminder_24h'), enabled: true };
    mount([{ ...base, waTemplateStatus: 'pending', waTemplateName: 'appt_clinic_24h_en' }]);
    const c = card('reminder_24h')!;
    expect(c.textContent).toContain('Waiting for Meta approval');
    expect(c.textContent).toContain('appt_clinic_24h_en');
    expect(c.textContent).toContain('goes out by email');
    act(() => root.unmount());
    document.body.innerHTML = '';
    mount([{ ...base, waTemplateStatus: 'approved' }]);
    expect(card('reminder_24h')!.textContent).toContain('Template approved');
    expect(card('reminder_24h')!.textContent).not.toContain('goes out by email');
  });

  it('warns that WhatsApp-only has no fallback while the template is not approved', () => {
    mount([{ ...buildStep('reminder_24h'), channels: ['whatsapp'], waTemplateStatus: 'rejected' }]);
    expect(card('reminder_24h')!.textContent).toContain('Rejected by Meta');
    expect(card('reminder_24h')!.textContent).toContain('Add email as a fallback');
  });

  it('switches a step on and edits the buttons, the skip rule and the fallback wait on the card', () => {
    mount([buildStep('reminder_24h')]);
    click(card('reminder_24h')!.querySelector<HTMLElement>('[role="switch"]'));
    expect(latest[0]!.enabled).toBe(true);
    click(document.getElementById(idOf('buttons')));
    expect(latest[0]!.buttonsEnabled).toBe(true);
    click(document.getElementById(idOf('skip')));
    expect(latest[0]!.skipIfConfirmed).toBe(true);
    type(document.getElementById(idOf('fallback')), '45');
    expect(remindersToInput(latest)[0]).toMatchObject({
      isActive: true,
      buttonsEnabled: true,
      skipIfConfirmed: true,
      undeliveredFallbackMinutes: 45,
    });
  });

  it('shows the buttons only on reminders before the appointment, and the wait only with a second channel', () => {
    mount([buildStep('after_visit'), { ...buildStep('reminder_2h'), channels: ['email'] }]);
    expect(card('after_visit')!.querySelector('[id*="-buttons-"]')).toBeNull();
    const before = card('reminder_2h')!;
    expect(before.querySelector('[id*="-buttons-"]')).not.toBeNull();
    expect(before.querySelector('[id*="-fallback-"]')).toBeNull();
  });

  it('edits the time of a timed step', () => {
    mount([buildStep('reminder_2h')]);
    type(byLabel('Time of: 2 hour reminder'), '3');
    expect(remindersToInput(latest)[0]).toMatchObject({ offsetMinutes: 180, kind: 'before' });
  });

  it('shows plan-gated controls with an upgrade hint instead of hiding them', () => {
    mount([buildStep('reminder_24h'), buildStep('rebook')], { features: ['appointment_booking'] });
    const c = card('reminder_24h')!;
    const buttonsSwitch = document.getElementById(idOf('buttons')) as HTMLButtonElement;
    expect(buttonsSwitch).not.toBeNull();
    expect(buttonsSwitch.disabled).toBe(true);
    expect(c.textContent).toContain('buttons are not part of your plan');
    expect(c.querySelector('a[href="/account/plans"]')).not.toBeNull();
    // the rebook step can be set up but not switched on
    const rebook = card('rebook')!;
    expect((rebook.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    expect(rebook.textContent).toContain('cannot be switched on with your current plan');
    expect(document.body.textContent).toContain('Rebook messages are not part of your plan');
    click(byText('Add step'));
    expect(itemText('Rebook message')!.textContent).toContain('Plan upgrade needed');
  });

  it('lets a plan that lost the buttons still switch them off', () => {
    mount([{ ...buildStep('reminder_24h'), buttonsEnabled: true }], { features: [] });
    const sw = document.getElementById(idOf('buttons')) as HTMLButtonElement;
    expect(sw.disabled).toBe(false);
    click(sw);
    expect(latest[0]!.buttonsEnabled).toBe(false);
  });

  it('removes a step', () => {
    mount([buildStep('reminder_24h')]);
    click(byLabel('Remove: 24 hour reminder'));
    expect(latest).toHaveLength(0);
  });

  it('is read-only when disabled', () => {
    mount([buildStep('reminder_24h')], { disabled: true });
    expect((byLabel('Remove: 24 hour reminder') as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
