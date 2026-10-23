// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import { buildCatalog, type Lookups } from '@/features/segments/lib/fields';
import { FilterPanel, type FilterPanelProps } from './filter-panel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The segment the contacts list is filtered to, as `GET /segments/:id` returns it (only what the panel reads).
const state = vi.hoisted(() => ({ segment: undefined as unknown, failed: false }));
vi.mock('@/features/segments/api/segments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/segments/api/segments')>()),
  useSegment: (id: string) => ({ data: id === SEG ? state.segment : undefined }),
}));
vi.mock('@/features/segments/api/lookups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/segments/api/lookups')>()),
  useSegmentCatalog: () => ({
    catalog,
    lookups,
    ready: true,
    failed: state.failed,
    personName: () => undefined,
  }),
}));

const SEG = '4f0a1d6e-6b52-4a55-9d0a-0d8a3b2f1c11';
const lookups: Lookups = {
  stages: [
    { value: 'new', label: 'New' },
    { value: 'qualified', label: 'Qualified' },
  ],
  statuses: [],
  tags: [],
  groups: [],
  users: [],
  properties: [],
};
const catalog = buildCatalog(lookups);

const segmentWith = (combinator: 'and' | 'or', children: unknown[]) => ({
  id: SEG,
  name: 'Hot leads',
  rules: { type: 'group', combinator, children },
});
const QUALIFIED = {
  type: 'condition',
  field: 'lifecycleStage',
  operator: 'equals',
  value: 'qualified',
};

const NONE = {
  group: '',
  imported: false,
  segment: '',
  tag: '',
  owner: '',
  team: '',
  lifecycleStage: '',
  status: '',
  minor: '',
  followUp: '',
  consent: '',
  source: '',
  rules: '',
} as const;

function panel(segment = ''): FilterPanelProps {
  return {
    filters: { ...NONE, segment },
    onChange: () => undefined,
    stats: undefined,
    groups: [],
    segments: [
      { id: SEG, name: 'Hot leads', color: null, memberCount: 3, countApproximate: false },
    ],
    segmentsState: 'ready',
    onRetrySegments: () => undefined,
    canCreateSegment: false,
    tags: [],
    owners: [],
    teams: [],
    meId: 'me',
    stages: lookups.stages,
    statuses: [],
    onAiSummary: () => undefined,
    conditionCount: 0,
  };
}

let host: HTMLElement;
let root: Root;

function mount(ui: ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <NextIntlClientProvider locale="en" messages={loadMessages('en')} timeZone="UTC">
        <QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>
      </NextIntlClientProvider>,
    );
  });
}

function openFilter() {
  const button = [...host.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-haspopup') === 'dialog',
  );
  act(() => button!.click());
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  state.segment = undefined;
  state.failed = false;
});

describe('FilterPanel with a segment applied', () => {
  it('shows the segment conditions under the segment row, as the segment page words them', () => {
    state.segment = segmentWith('and', [QUALIFIED]);
    mount(<FilterPanel {...panel(SEG)} />);
    openFilter();
    const text = host.textContent ?? '';
    expect(text).toContain('Hot leads');
    expect(text).toContain('Contacts match all of these');
    expect(text).toContain('Stage is Qualified');
  });

  it('says match any for an OR segment', () => {
    state.segment = segmentWith('or', [QUALIFIED]);
    mount(<FilterPanel {...panel(SEG)} />);
    openFilter();
    expect(host.textContent).toContain('Contacts match any of these');
  });

  it('draws no conditions when a lookup failed, rather than reading a live value as deleted', () => {
    state.segment = segmentWith('and', [QUALIFIED]);
    state.failed = true;
    mount(<FilterPanel {...panel(SEG)} />);
    openFilter();
    expect(host.textContent).toContain('Hot leads');
    expect(host.textContent).not.toContain('Contacts match');
  });

  it('shows no segment conditions when the list is not filtered to a segment', () => {
    state.segment = segmentWith('and', [QUALIFIED]);
    mount(<FilterPanel {...panel()} />);
    openFilter();
    expect(host.textContent).not.toContain('Contacts match');
    expect(host.textContent).not.toContain('Stage is Qualified');
  });
});
