import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useContext } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RealtimeProvider } from '@/lib/realtime';
import { NavCountsContext } from '@/components/shell/nav-badges';
import {
  CONNECTED_POLL_MS,
  DISCONNECTED_POLL_MS,
  INBOX_COUNTS_KEY,
  InboxNavCounts,
  pollMsFor,
} from './counts';

function Probe() {
  const counts = useContext(NavCountsContext);
  return <span data-testid="probe">{JSON.stringify(counts)}</span>;
}

const render = (qc: QueryClient, enabled: boolean) =>
  renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <RealtimeProvider url={undefined}>
        <InboxNavCounts enabled={enabled}>
          <Probe />
        </InboxNavCounts>
      </RealtimeProvider>
    </QueryClientProvider>,
  );
const cached = (unread: number) => {
  const qc = new QueryClient();
  qc.setQueryData(INBOX_COUNTS_KEY, { all: 20, mine: 5, unassigned: 3, unread, archived: 1 });
  return qc;
};

describe('the inbox count for the menu badge', () => {
  it('polls slowly while the socket carries the signals and quickly without it', () => {
    expect(pollMsFor('connected')).toBe(CONNECTED_POLL_MS);
    for (const status of ['idle', 'connecting', 'disconnected', 'error'] as const) {
      expect(pollMsFor(status as never), status).toBe(DISCONNECTED_POLL_MS);
    }
    expect(CONNECTED_POLL_MS).toBeGreaterThan(DISCONNECTED_POLL_MS);
  });

  it('provides the unread conversations from the shared cache, under the inbox-unread key', () => {
    expect(render(cached(6), true)).toContain('{&quot;inbox-unread&quot;:6}');
  });

  it('provides an honest zero when the cache says zero (the pill hides itself)', () => {
    expect(render(cached(0), true)).toContain('{&quot;inbox-unread&quot;:0}');
  });

  it('provides nothing before the first answer, and nothing for a person who may not read the inbox', () => {
    expect(render(new QueryClient(), true)).toContain('>{}<');
    expect(render(cached(6), false)).toContain('>{}<');
  });
});
