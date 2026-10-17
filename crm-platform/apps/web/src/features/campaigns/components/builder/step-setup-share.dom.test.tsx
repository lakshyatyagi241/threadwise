// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { act, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposeSender } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';
import { EMPTY_FORM, type BuilderForm } from '../../lib/builder-model';
import { html, uuid } from '../../wizard/testing';
import { SenderBreakdown } from '../sender-breakdown';
import { StepSetup } from './step-setup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));

const sender = (n: number, engine: string, over: Partial<ComposeSender> = {}): ComposeSender => ({
  key: `${engine}:${uuid(n)}`,
  label: `Line ${n}`,
  phone: `+9100000000${n}`,
  engine,
  engineLabel: engine === 'baileys' ? 'Personal' : 'Meta',
  isDefault: n === 1,
  ...over,
});
const A = sender(1, 'baileys');
const B = sender(2, 'baileys');
const C = sender(3, 'waba');

let latest: BuilderForm = EMPTY_FORM;
function Harness({ senders, start }: { senders: ComposeSender[]; start?: Partial<BuilderForm> }) {
  const [form, setForm] = useState<BuilderForm>({ ...EMPTY_FORM, senderKey: A.key, ...start });
  useEffect(() => {
    latest = form;
  });
  return (
    <StepSetup
      form={form}
      patch={(p) => setForm((f) => ({ ...f, ...p }))}
      senders={senders}
      engine="baileys"
      onSender={(key) =>
        setForm((f) => ({ ...f, senderKey: key, senderKeys: [], senderShare: {} }))
      }
      notVerified={false}
    />
  );
}

let root: ReturnType<typeof createRoot> | null = null;
function mount(props: Parameters<typeof Harness>[0]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <Harness {...props} />
      </NextIntlClientProvider>,
    );
  });
}
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
  latest = EMPTY_FORM;
});

const toggle = () =>
  [...document.querySelectorAll('label')]
    .find((l) => l.textContent?.includes('Share this send across several numbers'))
    ?.querySelector('input') as HTMLInputElement | undefined;
const box = (label: string) =>
  document.querySelector(`input[type="checkbox"][aria-label^="${label}"]`) as HTMLInputElement;
const click = (el: Element) => act(() => (el as HTMLElement).click());

describe('the share picker in the classic builder (TW-BCAST-006)', () => {
  it('is offered with two or more numbers, and not with one', () => {
    mount({ senders: [A] });
    expect(toggle()).toBeUndefined();
    act(() => root?.unmount());
    document.body.innerHTML = '';
    mount({ senders: [A, B] });
    expect(toggle()).toBeDefined();
  });

  it('a personal number and a Meta number can be ticked together; the form carries the list, the weights and the first as the primary', () => {
    mount({ senders: [A, B, C] });
    click(toggle()!);
    click(box('Line 3'));
    expect(latest.senderKeys).toEqual([A.key, C.key]);
    expect(latest.senderKey).toBe(A.key);
    const weight = document.querySelector(
      'input[aria-label="Share of Line 1"]',
    ) as HTMLInputElement;
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(weight, '3');
      weight.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(latest.senderShare[A.key]).toBe(3);
    expect(document.querySelector(`[data-testid="share-percent-${A.key}"]`)?.textContent).toBe(
      '75%',
    );
  });

  it('turning sharing off leaves the first number as the one number', () => {
    mount({ senders: [A, B], start: { senderKeys: [A.key, B.key], senderShare: {} } });
    expect(document.querySelector('[data-testid="sender-share-picker"]')).not.toBeNull();
    click(toggle()!);
    expect(latest.senderKey).toBe(A.key);
    expect(latest.senderKeys).toEqual([]);
  });
});

describe('the per-number breakdown', () => {
  const line = (n: number, recipients: number) => ({
    key: `waba:${uuid(n)}`,
    label: `Line ${n}`,
    engine: 'waba',
    recipients,
    sent: recipients - 1,
    delivered: recipients - 2,
    failed: 1,
  });

  it('lists each number with its recipients, sent, delivered and failed', () => {
    const out = html(<SenderBreakdown lines={[line(1, 4), line(2, 2)]} />);
    expect(out).toContain('data-testid="sender-breakdown"');
    expect(out).toContain('Line 1');
    expect(out).toContain('Line 2');
    for (const h of ['Number', 'Recipients', 'Sent', 'Delivered', 'Failed'])
      expect(out).toContain(h);
  });

  it('is hidden for a send from one number', () => {
    expect(html(<SenderBreakdown lines={[]} />)).not.toContain('sender-breakdown');
    expect(html(<SenderBreakdown lines={[line(1, 4)]} />)).not.toContain('sender-breakdown');
    expect(html(<SenderBreakdown lines={undefined} />)).not.toContain('sender-breakdown');
  });

  it('names a number that was removed', () => {
    const out = html(<SenderBreakdown lines={[{ ...line(1, 4), key: null }, line(2, 2)]} />);
    expect(out).toContain('a number that was removed');
  });
});
