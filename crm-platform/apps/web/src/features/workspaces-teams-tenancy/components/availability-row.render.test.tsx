import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KEYS } from '../api/hooks';
import { readMessages } from '../lib/test-support';
import { AvailabilityRow } from './availability-row';

const html = (status: 'online' | 'offline' | null) => {
  const client = new QueryClient();
  if (status) client.setQueryData(KEYS.availability, { status });
  return renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={readMessages('en')} timeZone="UTC">
      <QueryClientProvider client={client}>
        <AvailabilityRow className="row" />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );
};

describe('AvailabilityRow', () => {
  it("draws nothing until the caller's own availability is known (or when it cannot be read)", () => {
    expect(html(null)).toBe('');
  });

  it('is a switch that reads Available while routing may give the agent chats', () => {
    const out = html('online');
    expect(out).toContain('role="switch"');
    expect(out).toContain('aria-checked="true"');
    expect(out).toContain('Available');
  });

  it('reads Offline, unchecked, when the agent is out of automatic assignment', () => {
    const out = html('offline');
    expect(out).toContain('aria-checked="false"');
    expect(out).toContain('Offline');
    expect(out).toContain('no new chats are assigned');
  });
});
