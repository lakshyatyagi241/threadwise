import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FLR_ERROR_CODES } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { DEFAULT_ANALYTICS_STATE, type AnalyticsState } from '../lib/history-model';

const q = (over: Record<string, unknown> = {}) =>
  ({
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
    items: [],
    refetch: () => undefined,
    ...over,
  }) as never;

const state = vi.hoisted(() => ({
  groups: {} as unknown,
  rows: {} as unknown,
  history: {} as unknown,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: () => true,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/flow-runtime/analytics',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('../api/flow-runtime', async (orig) => ({
  ...(await orig<typeof import('../api/flow-runtime')>()),
  useErrorGroups: () => state.groups,
  useFailedRows: () => state.rows,
  useHistory: () => state.history,
}));

import { ErrorsTab } from './errors-tab';
import { HistoryTab } from './history-tab';
import { useErrorText } from './parts';

const en = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'flow-runtime-engine.json'), 'utf8'),
) as Record<string, unknown>;
const html = (el: ReactElement) =>
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
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const go = () => undefined;
const errors = (s: AnalyticsState = { ...DEFAULT_ANALYTICS_STATE, tab: 'errors' }) =>
  html(<ErrorsTab state={s} go={go} />);
const history = (s: Partial<AnalyticsState> = {}) =>
  html(<HistoryTab state={{ ...DEFAULT_ANALYTICS_STATE, tab: 'history', ...s }} go={go} />);

/** Renders what useErrorText says for an error, the text every mutation toast on these screens uses. */
function Probe({ error }: { error: unknown }) {
  const text = useErrorText();
  return <p>{text(error)}</p>;
}

describe('flow runtime states', () => {
  beforeEach(() => {
    state.groups = q({ data: { totals: {}, groups: [] } });
    state.rows = q();
    state.history = q({ counts: undefined });
  });

  it('shows an error state with a retry when the error groups fail to load', () => {
    state.groups = q({ isError: true, error: new Error('boom') });
    const out = errors();
    expect(out).toContain('Could not load the error logs.');
    expect(out).toContain('Try again');
    expect(out).not.toContain('No failures in this period');
    expect(out).not.toContain('boom');
  });

  it('shows an error state with a retry when the execution history fails to load', () => {
    state.history = q({ isError: true, error: new Error('boom') });
    const out = history();
    expect(out).toContain('Could not load the execution history.');
    expect(out).toContain('Try again');
    expect(out).not.toContain('No runs in this period');
  });

  it('shows the empty state when there are no failed runs yet', () => {
    const out = errors();
    expect(out).toContain('No failures in this period');
    expect(out).toContain('No failed runs to list');
    expect(out).not.toContain('Could not load');
  });

  it('shows the empty state for a first use history, not the filtered message', () => {
    const out = history();
    expect(out).toContain('No runs in this period');
    expect(out).not.toContain('No runs match these filters');
    expect(out).not.toContain('Reset filters');
  });

  it('shows no results with a way to clear the filters when the filters match nothing', () => {
    const out = history({ status: 'failed', q: 'zzz' });
    expect(out).toContain('No runs match these filters');
    expect(out).toContain('Reset filters');
    expect(out).not.toContain('No runs in this period');
  });

  it('shows a spinner while loading, not the empty state', () => {
    state.groups = q({ isPending: true });
    state.rows = q({ isPending: true });
    const out = errors();
    expect(out).toContain('Loading');
    expect(out).not.toContain('No failures in this period');
    expect(out).not.toContain('Could not load');
  });

  // The mutation toasts (retry, enroll) fire from a click, which string rendering cannot press;
  // this covers the text they show.
  it('shows the translated sentence when the retry update fails with a known code', () => {
    const e = new ApiError(422, FLR_ERROR_CODES.FLR_FLOW_INACTIVE, 'raw server words');
    const out = html(<Probe error={e} />);
    expect(out).toContain('This flow is paused or switched off.');
    expect(out).not.toContain('raw server words');
  });

  it('shows the server message, or the generic one, when the save fails with an unknown error', () => {
    expect(html(<Probe error={new ApiError(400, 'X', 'Over the 500 cap')} />)).toContain(
      'Over the 500 cap',
    );
    expect(html(<Probe error={new Error('network')} />)).not.toContain('network');
  });
});
