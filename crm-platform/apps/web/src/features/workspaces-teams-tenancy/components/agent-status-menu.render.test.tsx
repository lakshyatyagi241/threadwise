import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '@crm/contracts';
import { KEYS } from '../api/hooks';
import { readMessages } from '../lib/test-support';
import { AgentStatusMenu } from './agent-status-menu';

const base: AgentStatus = {
  status: 'online',
  state: 'available',
  reason: 'default',
  manual: false,
  changesAt: null,
  leaveUntil: null,
  hours: { configured: true, automate: true, timezone: 'UTC', emptySchedule: false },
  features: { bar: true, automation: true },
};

const html = (status: AgentStatus | null, variant: 'topbar' | 'inbox' = 'topbar') => {
  const client = new QueryClient();
  if (status) client.setQueryData(KEYS.availability, status);
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={readMessages('en')} timeZone="UTC">
      <QueryClientProvider client={client}>
        <AgentStatusMenu variant={variant} />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
};

describe('AgentStatusMenu pill', () => {
  it('draws nothing until the status is known (an operator session cannot read it)', () => {
    expect(html(null)).toBe('');
  });

  it('Available: a green dot and the word', () => {
    const out = html(base);
    expect(out).toContain('data-testid="agent-status-pill-topbar"');
    expect(out).toContain('data-state="available"');
    expect(out).toContain('Available');
    expect(out).not.toContain('agent-status-outside-hours');
  });

  it('Away by choice', () => {
    const out = html({ ...base, status: 'offline', state: 'away', reason: 'manual', manual: true });
    expect(out).toContain('data-state="away"');
    expect(out).toContain('>Away<');
  });

  it('On leave until a date, in the workspace words', () => {
    const out = html({
      ...base,
      status: 'offline',
      state: 'away',
      reason: 'leave',
      leaveUntil: '2026-06-05',
    });
    expect(out).toContain('data-state="leave"');
    expect(out).toContain('On leave until');
    expect(out).toContain('Jun');
  });

  it('Away outside working hours, with the info text in the Inbox', () => {
    const out = html({ ...base, status: 'offline', state: 'away', reason: 'schedule' }, 'inbox');
    expect(out).toContain('data-testid="agent-status-pill-inbox"');
    expect(out).toContain('Away outside working hours');
    expect(out).toContain('data-testid="agent-status-outside-hours"');
    expect(out).toContain('Outside of working hours');
  });

  it('the info text needs the automation on the plan', () => {
    const out = html({
      ...base,
      status: 'offline',
      state: 'away',
      reason: 'schedule',
      features: { bar: true, automation: false },
    });
    expect(out).not.toContain('agent-status-outside-hours');
  });
});
