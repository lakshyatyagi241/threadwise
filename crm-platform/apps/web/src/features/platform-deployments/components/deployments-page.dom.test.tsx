// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentsResponse, DeploymentRow } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  fetchDeployments: (status: unknown, signal?: AbortSignal) => state.fetch(status, signal),
}));

import { DeploymentsPage } from './deployments-page';

const row = (over: Partial<DeploymentRow> = {}): DeploymentRow => ({
  id: '6f1e0c1a-0000-4000-8000-0000000000a1',
  workspaceId: '6f1e0c1a-0000-4000-8000-0000000000b1',
  workspaceName: 'Acme Retail',
  flowId: '6f1e0c1a-0000-4000-8000-0000000000c1',
  flowName: 'Welcome flow',
  publishVersion: 2,
  status: 'running',
  step: 'publish_bot',
  failedStep: null,
  lastError: null,
  attemptedAt: '2026-10-19T10:00:00.000Z',
  updatedAt: '2026-10-19T10:00:01.000Z',
  stalled: false,
  ...over,
});

const page = (
  rows: DeploymentRow[],
  counts: Partial<DeploymentsResponse['counts']> = {},
): DeploymentsResponse => ({
  generatedAt: '2026-10-19T10:00:05.000Z',
  counts: { running: 0, queued: 0, failed: 0, live: 0, stalled: 0, ...counts },
  rows,
  truncated: false,
});

const messages = loadMessages('en') as unknown as Record<string, Record<string, unknown>>;
const en = (path: string): string => {
  let cur: unknown = messages['platform-deployments'];
  for (const p of path.split('.')) cur = (cur as Record<string, unknown>)[p];
  return cur as string;
};

let host: HTMLElement;
let root: Root;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <DeploymentsPage />
        </QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
  // Let the query resolve and React commit the result.
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

beforeEach(() => {
  state.fetch.mockReset();
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

describe('DeploymentsPage', () => {
  it('shows each deployment with its exact status, step and version', async () => {
    state.fetch.mockResolvedValue(
      page(
        [
          row(),
          row({
            id: 'q',
            flowName: 'Order alerts',
            status: 'queued',
            step: 'configuration_update',
            attemptedAt: null,
            publishVersion: 1,
          }),
        ],
        { running: 1, queued: 1 },
      ),
    );
    await mount();
    expect(host.textContent).toContain('Acme Retail');
    expect(host.textContent).toContain('Welcome flow');
    expect(host.textContent).toContain('Order alerts');
    expect(host.textContent).toContain(en('status.running'));
    expect(host.textContent).toContain(en('status.queued'));
    expect(host.textContent).toContain(en('steps.publish_bot'));
    expect(host.textContent).toContain(en('notStarted'));
  });

  it('shows the failed step and the stored error of a failed publish', async () => {
    state.fetch.mockResolvedValue(
      page(
        [
          row({
            status: 'failed',
            step: 'publish_bot',
            failedStep: 'publish_bot',
            lastError: 'Geta answered 503',
          }),
        ],
        { failed: 1 },
      ),
    );
    await mount();
    expect(host.textContent).toContain(en('failedAt').replace('{step}', en('steps.publish_bot')));
    expect(host.textContent).toContain('Geta answered 503');
  });

  it('warns when deployments have stalled', async () => {
    state.fetch.mockResolvedValue(
      page([row({ status: 'running', stalled: true })], { running: 1, stalled: 1 }),
    );
    await mount();
    expect(host.textContent).toContain(en('stalledBadge'));
    expect(host.textContent).toContain('1 deployment(s) have not changed for 10 minutes');
  });

  it('shows the empty state when nothing matches', async () => {
    state.fetch.mockResolvedValue(page([]));
    await mount();
    expect(host.textContent).toContain(en('empty.title'));
    expect(host.textContent).toContain(en('empty.all'));
  });
});
