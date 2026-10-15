// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WizardFollowUp } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { templates, uuid } from '../testing';
import { FollowUpsCard } from './follow-ups-card';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: unknown }) => (
    <a href={href}>{children as never}</a>
  ),
}));

const tpl = {
  data: { data: templates() },
  isPending: false,
  isError: false,
  error: null,
  refetch: () => 0,
};
const flows = {
  data: [
    { id: uuid(81), name: 'Welcome flow' },
    { id: uuid(82), name: 'Win-back flow' },
  ],
  isPending: false,
  isError: false,
};

let latest: WizardFollowUp[] = [];

function Harness({
  initial,
  senderKey,
  issues = [],
}: {
  initial: WizardFollowUp[];
  senderKey: string | null;
  issues?: Array<{ path: string; code: never }>;
}) {
  const [list, setList] = useState(initial);
  return (
    <FollowUpsCard
      followUps={list}
      senderKey={senderKey}
      templates={tpl}
      flows={flows}
      issues={issues}
      onFollowUps={(next) => {
        latest = next;
        setList(next);
      }}
    />
  );
}

function mount(props: Parameters<typeof Harness>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <Harness {...props} />
      </NextIntlClientProvider>,
    );
  });
  return { root, host };
}

const waba = `waba:${uuid(31)}`;
const step = (over: Partial<WizardFollowUp> = {}): WizardFollowUp => ({
  trigger: 'not_read',
  waitMinutes: 120,
  action: { kind: 'template', templateId: null },
  ...over,
});
const button = (label: string) =>
  [...document.querySelectorAll('button')].find((b) => b.textContent === label) as
    HTMLButtonElement | undefined;
const rows = () => document.querySelectorAll('[data-testid="follow-up-row"]');

function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function choose(el: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('follow-ups card', () => {
  it('adds a step, and the Add button is disabled with the limit shown at 3', () => {
    const { root } = mount({ initial: [], senderKey: waba });
    expect(rows()).toHaveLength(0);
    for (let n = 1; n <= 3; n++) {
      act(() => button('Add a follow-up')!.click());
      expect(rows()).toHaveLength(n);
    }
    expect(latest).toHaveLength(3);
    expect(button('Add a follow-up')!.disabled).toBe(true);
    expect(document.body.textContent).toContain('Limit reached: 3 follow-ups.');
    act(() => root.unmount());
  });

  it('removes the step it is asked to and renumbers the rest', () => {
    const a = step({ trigger: 'replied' });
    const b = step({ trigger: 'read' });
    const { root } = mount({ initial: [a, b], senderKey: waba });
    act(() =>
      (document.querySelector('button[aria-label="Remove follow-up 1"]') as HTMLElement).click(),
    );
    expect(latest).toEqual([b]);
    expect(rows()).toHaveLength(1);
    expect(document.body.textContent).toContain('Follow-up 1');
    expect(document.body.textContent).not.toContain('Follow-up 2');
    expect(button('Add a follow-up')!.disabled).toBe(false);
    act(() => root.unmount());
  });

  it('turns the wait number and unit into minutes, kept between 1 minute and 7 days', () => {
    const { root } = mount({ initial: [step({ waitMinutes: 120 })], senderKey: waba });
    const amount = document.querySelector('input[inputmode="numeric"]') as HTMLInputElement;
    const unit = document.querySelector('select[aria-label="Time unit"]') as HTMLSelectElement;
    expect(amount.value).toBe('2');
    expect(unit.value).toBe('hours');
    type(amount, '5');
    expect(latest[0]!.waitMinutes).toBe(300);
    choose(unit, 'days');
    expect(latest[0]!.waitMinutes).toBe(5 * 1440);
    type(amount, '30');
    expect(latest[0]!.waitMinutes).toBe(10_080);
    expect(amount.value).toBe('7');
    choose(unit, 'minutes');
    expect(latest[0]!.waitMinutes).toBe(7);
    type(amount, '0');
    expect(latest[0]!.waitMinutes).toBe(1);
    act(() => root.unmount());
  });

  it('shows 90 minutes as minutes, and picks the trigger help text', () => {
    const { root } = mount({
      initial: [step({ waitMinutes: 90, trigger: 'replied' })],
      senderKey: waba,
    });
    const unit = document.querySelector('select[aria-label="Time unit"]') as HTMLSelectElement;
    expect(unit.value).toBe('minutes');
    expect((document.querySelector('input[inputmode="numeric"]') as HTMLInputElement).value).toBe(
      '90',
    );
    expect(document.body.textContent).toContain('Fires the moment they reply');
    act(() => root.unmount());
  });

  it('chooses a template, switches to a flow (clearing the pick) and chooses a flow', () => {
    const { root } = mount({ initial: [step()], senderKey: waba });
    const pick = () => document.querySelector('fieldset select') as HTMLSelectElement;
    choose(pick(), uuid(2));
    expect(latest[0]!.action).toEqual({ kind: 'template', templateId: uuid(2) });
    const radios = document.querySelectorAll<HTMLInputElement>('fieldset input[type="radio"]');
    act(() => radios[1]!.click());
    expect(latest[0]!.action).toEqual({ kind: 'flow', flowId: null });
    choose(pick(), uuid(82));
    expect(latest[0]!.action).toEqual({ kind: 'flow', flowId: uuid(82) });
    act(() => root.unmount());
  });

  it('shows the field error of its own step', () => {
    const { root } = mount({
      initial: [step(), step()],
      senderKey: waba,
      issues: [{ path: 'followUps.1.action', code: 'follow_up_template_required' as never }],
    });
    expect(document.body.textContent).toContain('Choose the template each follow-up sends.');
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    act(() => root.unmount());
  });

  it('is switched off with an explanation for a sender that is not Cloud API', () => {
    const { root } = mount({ initial: [step()], senderKey: `baileys:${uuid(40)}` });
    expect(document.body.textContent).toContain('Follow-ups need a WhatsApp Cloud API number');
    expect(button('Add a follow-up')!.disabled).toBe(true);
    expect((document.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
    // An existing step can still be taken out.
    expect(
      (document.querySelector('button[aria-label="Remove follow-up 1"]') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    act(() => root.unmount());
  });
});
