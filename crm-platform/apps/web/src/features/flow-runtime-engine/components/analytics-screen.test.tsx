import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { FlowAnalytics } from '@crm/contracts';
import { AnalyticsScreen } from './analytics-screen';

const FLOW = '11111111-1111-4111-8111-111111111111';

const fixture = vi.hoisted(() => ({ data: null as unknown }));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/flow-runtime/analytics',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('../api/flow-runtime', async (orig) => ({
  ...(await orig<typeof import('../api/flow-runtime')>()),
  useAnalytics: () => ({
    data: fixture.data,
    isPending: false,
    isError: false,
    error: null,
    refetch: () => undefined,
  }),
  useFlowOptions: () => ({ data: [], isPending: false, isError: false }),
}));

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'flow-runtime-engine.json'), 'utf8'),
) as Record<string, unknown>;

const analytics = (): FlowAnalytics => ({
  totals: { enrolled: 4, running: 0, completed: 3, failed: 1, cancelled: 0, expired: 0 },
  completionRate: 0.75,
  avgSecondsToComplete: 120,
  trend: [],
  failureReasons: [],
  bySource: [],
  leaderboard: [
    {
      flowId: FLOW,
      flowName: 'Welcome',
      state: 'live',
      runs: 4,
      running: 0,
      completed: 3,
      failed: 1,
      completionRate: 75,
      failureRate: 25,
      avgSecondsToComplete: 120,
    },
  ],
  extras: {
    contactsReached: 4,
    pausedSubscribers: 0,
    retriedRuns: 0,
    retryAttempts: 0,
    flowsTotal: 1,
    flowsLive: 1,
    flowsWithRuns: 1,
    failureRate: 0.25,
  },
});

const render = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale="en"
      messages={en}
      timeZone="UTC"
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <AnalyticsScreen />
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

/** The flow leaderboard's table: the only table on the overview when no reasons, sources or trend rows are there. */
const leaderboard = (html: string) => html.slice(html.indexOf('<table'), html.indexOf('</table>'));

describe('flow analytics leaderboard alignment', () => {
  it('centres the headers and the figures of each flow, not the end of the cell', () => {
    fixture.data = analytics();
    const table = leaderboard(render());
    expect(table).toContain('Welcome');
    const headers = table.match(/<th class="[^"]*"/g) ?? [];
    expect(headers.length).toBe(7);
    for (const th of headers) {
      expect(th).toContain('text-center');
      expect(th).not.toContain('text-start');
      expect(th).not.toContain('text-end');
    }
    const cells = table.match(/<td class="[^"]*"/g) ?? [];
    expect(cells.length).toBe(7);
    for (const td of cells) expect(td).not.toContain('text-end');
    expect(table).toContain('<td class="px-3 py-2.5 text-center font-mono tabular-nums">4</td>');
    expect(table).toContain('75%');
  });
});
