import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ExpenseEvent, ExpenseGroup } from '@crm/contracts';
import { ExpenseTable, GroupTable } from './components/customer/expenses-page';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const WEB = resolve(__dirname, '../../..');
const raw = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'wallet-message-billing.json'), 'utf8'),
);

const wrap = (el: ReactElement) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale="en" messages={raw} timeZone="UTC">
        {el}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const event = (over: Partial<ExpenseEvent>): ExpenseEvent => ({
  id: 'wamid.X',
  kind: 'whatsapp_message',
  units: 1,
  createdAt: '2026-10-19T10:30:00.000Z',
  status: 'charged',
  billingMode: 'wallet',
  freeReason: null,
  source: 'campaign',
  engine: 'waba',
  country: 'IN',
  category: 'marketing',
  template: 'order_update',
  subjectName: 'Diwali sale',
  chargedMinor: 596,
  chargedExact: '5.956',
  refundedMinor: 0,
  refundedExact: '0.00',
  netMinor: 596,
  netExact: '5.956',
  uncollectedMinor: 0,
  refundedAt: null,
  ...over,
});

describe('message expense log', () => {
  it('shows what each expense is: a message, an SMS with its segments, a call with its minutes, an AI request', () => {
    const html = wrap(
      <ExpenseTable
        rows={[
          event({ id: 'a', kind: 'whatsapp_message' }),
          event({ id: 'b', kind: 'sms', units: 3, template: null, subjectName: 'Spring promo' }),
          event({ id: 'c', kind: 'whatsapp_call', units: 1, template: null, subjectName: null }),
          event({ id: 'd', kind: 'ai', template: null, subjectName: 'AI lead scoring' }),
        ]}
        currency="USD"
      />,
    );
    expect(html).toContain('WhatsApp message');
    expect(html).toContain('>SMS<');
    expect(html).toContain('3 segments');
    expect(html).toContain('WhatsApp call');
    expect(html).toContain('1 minute');
    expect(html).toContain('AI lead scoring');
    // An AI request has no units line: one request is one request.
    expect(html).not.toContain('1 request');
  });

  it('shows the template, the campaign, the category and what the message cost', () => {
    const html = wrap(<ExpenseTable rows={[event({})]} currency="USD" />);
    expect(html).toContain('order_update');
    expect(html).toContain('Diwali sale');
    expect(html).toContain('Campaign');
    expect(html).toContain('Marketing');
    expect(html).toContain('$5.956');
    expect(html).toContain('Charged');
  });

  it('says why a free message was free, and that a template is not recorded when it is not', () => {
    const html = wrap(
      <ExpenseTable
        rows={[
          event({
            id: 'wamid.FREE',
            status: 'free',
            freeReason: 'within_plan_free_quota',
            chargedMinor: 0,
            chargedExact: '0.00',
            netMinor: 0,
            netExact: '0.00',
            template: null,
            subjectName: null,
            source: 'inbox',
          }),
        ]}
        currency="USD"
      />,
    );
    expect(html).toContain('Included in your plan');
    expect(html).toContain('Not billed');
    expect(html).toContain('Not recorded');
    // Team inbox sends are "Chat" to the customer, the same label the statement uses.
    expect(html).toContain('>Chat<');
  });

  it('shows a refund with the time it came back and its net', () => {
    const html = wrap(
      <ExpenseTable
        rows={[
          event({
            status: 'refunded',
            refundedMinor: 596,
            refundedExact: '5.956',
            netMinor: 0,
            netExact: '0.00',
            refundedAt: '2026-10-19T11:00:00.000Z',
          }),
        ]}
        currency="USD"
      />,
    );
    expect(html).toContain('Refunded');
    expect(html).toContain('Returned');
    expect(html).toContain('$0.00');
  });

  it('shows the cost of each group and a group with no template as not recorded', () => {
    const groups: ExpenseGroup[] = [
      {
        key: 'order_update',
        messages: 3,
        charged: 3,
        refunded: 1,
        free: 0,
        chargedMinor: 1788,
        chargedExact: '17.868',
        refundedMinor: 596,
        refundedExact: '5.956',
        netMinor: 1192,
        netExact: '11.912',
      },
      {
        key: null,
        messages: 1,
        charged: 0,
        refunded: 0,
        free: 1,
        chargedMinor: 0,
        chargedExact: '0.00',
        refundedMinor: 0,
        refundedExact: '0.00',
        netMinor: 0,
        netExact: '0.00',
      },
    ];
    const html = wrap(<GroupTable groups={groups} groupBy="template" currency="USD" />);
    expect(html).toContain('order_update');
    expect(html).toContain('$17.868');
    expect(html).toContain('$11.912');
    expect(html).toContain('Not recorded');
  });
});
