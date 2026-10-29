// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentsResponse, DeploymentRow } from '@crm/contracts';
import { loadMessages } from '@/i18n/messages';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({ fetch: vi.fn(), publishes: vi.fn(), releases: vi.fn() }));
vi.mock('../api', async (orig) => ({
  ...(await orig<typeof import('../api')>()),
  fetchDeployments: (status: unknown, signal?: AbortSignal) => state.fetch(status, signal),
  fetchPublishes: (status: unknown, signal?: AbortSignal) => state.publishes(status, signal),
  fetchReleases: (signal?: AbortSignal) => state.releases(signal),
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

async function openTab(label: string) {
  const tab = [...host.querySelectorAll('button')].find((b) => b.textContent === label);
  await act(async () => {
    tab?.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

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
  state.publishes.mockReset();
  state.releases.mockReset();
  state.releases.mockResolvedValue({
    generatedAt: '2026-10-19T10:00:05.000Z',
    live: { tag: '701ca2c1a', finishedAt: '2026-10-19T09:30:00.000Z' },
    inProgress: false,
    rows: [],
  });
  state.publishes.mockResolvedValue({
    generatedAt: '2026-10-19T10:00:05.000Z',
    counts: { running: 0, queued: 0, failed: 0, done: 0, stalled: 0 },
    rows: [],
    truncated: false,
  });
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
    await openTab(en('tabs.geta'));
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
    await openTab(en('tabs.geta'));
    expect(host.textContent).toContain(en('failedAt').replace('{step}', en('steps.publish_bot')));
    expect(host.textContent).toContain('Geta answered 503');
  });

  it('warns when deployments have stalled', async () => {
    state.fetch.mockResolvedValue(
      page([row({ status: 'running', stalled: true })], { running: 1, stalled: 1 }),
    );
    await mount();
    await openTab(en('tabs.geta'));
    expect(host.textContent).toContain(en('stalledBadge'));
    expect(host.textContent).toContain('1 deployment(s) have not changed for 10 minutes');
  });

  it('shows the empty state when nothing matches', async () => {
    state.fetch.mockResolvedValue(page([]));
    await mount();
    await openTab(en('tabs.geta'));
    expect(host.textContent).toContain(en('empty.title'));
    expect(host.textContent).toContain(en('empty.all'));
  });

  it('shows the live release and any failed attempt on the product releases tab by default', async () => {
    state.releases.mockResolvedValue({
      generatedAt: '2026-10-19T10:00:05.000Z',
      live: { tag: '701ca2c1a', finishedAt: '2026-10-19T09:30:00.000Z' },
      inProgress: false,
      rows: [
        {
          id: '11111111-2222-4333-8444-555555555555',
          tag: '29f32b7b6',
          state: 'failed',
          step: 'schema',
          error: 'migration failed; the running release is untouched',
          changes: [
            {
              pr: 830,
              title: 'feat(flows): the featured flow tile names its bot',
              author: 'Akshay',
            },
          ],
          startedAt: '2026-10-19T10:00:00.000Z',
          updatedAt: '2026-10-19T10:01:00.000Z',
          finishedAt: '2026-10-19T10:01:00.000Z',
          stalled: false,
        },
      ],
    });
    state.fetch.mockResolvedValue(page([]));
    await mount();
    expect(host.textContent).toContain('701ca2c1a');
    expect(host.textContent).toContain('29f32b7b6');
    expect(host.textContent).toContain(en('releases.state.failed'));
    expect(host.textContent).toContain('migration failed; the running release is untouched');
    expect(host.textContent).toContain('#830');
    expect(host.textContent).toContain('feat(flows): the featured flow tile names its bot');
    expect(host.textContent).toContain('Akshay');
  });

  it('shows what a PR changes and when it was raised in Indian time', async () => {
    state.releases.mockResolvedValue({
      generatedAt: '2026-10-26T10:00:05.000Z',
      live: null,
      inProgress: false,
      rows: [
        {
          id: '11111111-2222-4333-8444-555555555555',
          tag: 'abc123def',
          state: 'ok',
          step: null,
          error: null,
          changes: [
            {
              pr: 823,
              title: 'Show PR details on releases',
              author: 'Vedant',
              body: 'Adds the description and raised time.',
              createdAt: '2026-10-26T08:15:00.000Z',
            },
            { pr: 824, title: 'Older entry', author: 'Akshay', body: null, createdAt: null },
          ],
          startedAt: '2026-10-26T09:00:00.000Z',
          updatedAt: '2026-10-26T09:05:00.000Z',
          finishedAt: '2026-10-26T09:05:00.000Z',
          stalled: false,
        },
      ],
    });
    state.fetch.mockResolvedValue(page([]));
    await mount();
    const all = (id: string) =>
      [...host.querySelectorAll(`[data-testid="${id}"]`)].map((e) => e.textContent ?? '');
    expect(host.textContent).toContain('#823');
    // Two lines per change: the PR description is never shown, even when the API sends one.
    expect(host.textContent).not.toContain('Adds the description and raised time.');
    expect(all('release-description')).toHaveLength(0);
    // 08:15 UTC is 13:45 in India, whatever zone the test machine is in; an entry without a time shows none.
    expect(all('release-raised')).toHaveLength(1);
    expect(all('release-raised')[0]).toMatch(/1:45:00/);
    expect(all('release-raised')[0]).toContain('IST');
  });

  describe('release times, unexplained blanks and missing descriptions', () => {
    const attempt = (over: Record<string, unknown> = {}) => ({
      id: '11111111-2222-4333-8444-555555555555',
      tag: 'abc123def',
      state: 'ok',
      step: null,
      error: null,
      changes: [{ pr: 900, title: 'A change', author: 'Vedant' }],
      startedAt: '2026-10-28T05:16:03.000Z',
      updatedAt: '2026-10-28T05:20:00.000Z',
      finishedAt: '2026-10-28T05:20:00.000Z',
      stalled: false,
      ...over,
    });
    const show = async (rows: unknown[]) => {
      state.releases.mockResolvedValue({
        generatedAt: '2026-10-28T05:30:00.000Z',
        live: { tag: 'abc123def', finishedAt: '2026-10-28T05:20:00.000Z' },
        inProgress: false,
        rows,
      });
      state.fetch.mockResolvedValue(page([]));
      await mount();
    };

    it('writes every time in Indian time with the zone, whatever the browser zone is', async () => {
      await show([attempt()]);
      // 05:16:03 UTC is 10:46:03 in India (the time on the operator's screen); 05:20 is 10:50; the page clock is 11:00.
      expect(host.textContent).toMatch(/10:46:03\s?AM IST/);
      expect(host.textContent).toMatch(/10:50:00\s?AM IST/);
      expect(host.textContent).toMatch(/11:00:00\s?AM IST/);
    });

    it('says why a failed attempt with no stored error failed, and why a stalled one is quiet', async () => {
      await show([
        attempt({ id: 'a', state: 'failed', error: null }),
        attempt({ id: 'b', state: 'building', stalled: true, finishedAt: null }),
      ]);
      expect(host.textContent).toContain(en('noDetail'));
      expect(host.textContent).toContain(en('releases.noProgress').replace('{minutes}', '45'));
    });

    it('shows each change in exactly two lines, the number and title then who and when in IST, and never the description', async () => {
      const body = 'The picker sent one request per ticked channel. '.repeat(14);
      await show([
        attempt({
          changes: [
            {
              pr: 901,
              title: 'Fix the picker',
              author: 'Lakshya',
              body,
              createdAt: '2026-10-28T06:05:26Z',
            },
          ],
        }),
      ]);
      const li = host.querySelector('li') as HTMLElement;
      const lines = [...li.children].map((e) => e.textContent ?? '');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('#901');
      expect(lines[0]).toContain('Fix the picker');
      expect(lines[1]).toContain('Lakshya');
      expect(lines[1]).toMatch(/11:35:26\s?AM/); // 06:05:26 UTC in India
      expect(lines[1]).toContain('IST');
      expect(li.textContent).not.toContain('The picker sent one request');
    });

    it('lists the first five PRs of a release and folds the rest into "N more"', async () => {
      const many = Array.from({ length: 7 }, (_, i) => ({
        pr: 800 + i,
        title: `Change ${i}`,
        author: 'Dev',
      }));
      await show([attempt({ changes: many })]);
      const details = host.querySelector('details') as HTMLElement;
      expect(details.querySelector('summary')!.textContent).toBe(
        en('releases.moreChanges').replace('{count}', '2'),
      );
      expect(details.textContent).toContain('Change 5');
      expect(details.textContent).toContain('Change 6');
      expect(details.textContent).not.toContain('Change 4'); // the fifth is listed above the fold
      expect(host.textContent).toContain('Change 4');
    });

    it('has no fold when a release carries five PRs or fewer', async () => {
      await show([attempt()]);
      expect(host.querySelector('details')).toBeNull();
    });

    it('warns when the newest releases do not list their pull requests', async () => {
      const bare = (id: string) => attempt({ id, changes: [] });
      await show([bare('a'), bare('b'), bare('c')]);
      expect(host.textContent).toContain(en('releases.noChangesAlert'));
    });

    it('stays quiet when only some of the newest releases lack changes', async () => {
      await show([
        attempt({ id: 'a' }),
        attempt({ id: 'b', changes: [] }),
        attempt({ id: 'c', changes: [] }),
      ]);
      expect(host.textContent).not.toContain(en('releases.noChangesAlert'));
    });

    it('stays quiet when there are too few releases to judge', async () => {
      await show([attempt({ id: 'a', changes: [] }), attempt({ id: 'b', changes: [] })]);
      expect(host.textContent).not.toContain(en('releases.noChangesAlert'));
    });
  });

  it('lists flow publishes with their state, attempts and error', async () => {
    state.publishes.mockResolvedValue({
      generatedAt: '2026-10-19T10:00:05.000Z',
      counts: { running: 0, queued: 1, failed: 1, done: 4, stalled: 0 },
      rows: [
        {
          workspaceId: '6f1e0c1a-0000-4000-8000-0000000000b1',
          workspaceName: 'Acme Retail',
          flowId: '6f1e0c1a-0000-4000-8000-0000000000c1',
          flowName: 'Welcome flow',
          status: 'failed',
          attempts: 5,
          lastError: 'Connection refused',
          queuedAt: '2026-10-19T09:00:00.000Z',
          processedAt: null,
          stalled: false,
        },
      ],
      truncated: false,
    });
    state.fetch.mockResolvedValue(page([]));
    await mount();
    await openTab(en('tabs.publishes'));
    expect(host.textContent).toContain('Acme Retail');
    expect(host.textContent).toContain('Welcome flow');
    expect(host.textContent).toContain(en('status.failed'));
    expect(host.textContent).toContain('Connection refused');
    expect(host.textContent).toContain(en('publishes.notProcessed'));
  });
});
