// @vitest-environment jsdom
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { loadMessages } from '@/i18n/messages';
import type { Segment } from '../api/schemas';
import type { SegmentActions } from './segment-actions';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/segments',
  useSearchParams: () => new URLSearchParams(),
}));

import { SegmentsTable } from './segments-screen';

const ASHA = { id: '0f4f5c1e-7a1b-4c52-9d1e-2b8f1c3a4d01', name: 'Asha Rao' };
const RAVI = { id: '5b7e2a90-3c4d-4e8f-8a6b-9c0d1e2f3a02', name: 'Ravi Nair' };

const SEGMENT: Segment = {
  id: '9a2d6e4f-1b3c-4d5e-8f70-a1b2c3d4e5f6',
  name: 'Lapsed buyers',
  description: null,
  color: null,
  visibility: 'private',
  sharedWith: { users: [], teams: [] },
  ownerId: ASHA.id,
  ownerName: 'Asha Rao',
  createdBy: ASHA,
  updatedBy: RAVI,
  rules: {
    type: 'group',
    combinator: 'and',
    children: [{ type: 'condition', field: 'lifecycleStage', operator: 'equals', value: 'new' }],
  },
  rulesVersion: 1,
  memberCount: 42,
  countApproximate: false,
  memberCountAt: '2026-10-02T10:00:00.000Z',
  invalidConditions: [],
  canEdit: false,
  rowVersion: 4,
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T10:30:00.000Z',
} as Segment;

const messages = loadMessages('en') as unknown as Parameters<
  typeof NextIntlClientProvider
>[0]['messages'];

const actions = {
  refreshing: new Set<string>(),
  refresh: async () => undefined,
} as unknown as SegmentActions;

const can = {
  create: false,
  createTags: false,
  edit: () => false,
  remove: () => false,
  export: false,
  members: false,
};

function render(rows: Segment[]) {
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SegmentsTable
        rows={rows}
        actions={actions}
        sentence={() => 'Lapsed buyers'}
        personName={() => undefined}
        can={can}
      />
    </NextIntlClientProvider>,
  );
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
}

describe('SegmentsTable: who created and who last changed each segment', () => {
  it('shows Created by, Created at, Modified by and Updated after the owner column', () => {
    const host = render([SEGMENT]);

    const headers = [...host.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
    const at = headers.indexOf('Owner');
    expect(headers.slice(at, at + 5)).toEqual([
      'Owner',
      'Created by',
      'Created at',
      'Modified by',
      'Updated',
    ]);

    const cells = [...host.querySelectorAll('tbody tr td')].map((td) => td.textContent ?? '');
    expect(cells).toContain('Asha Rao');
    expect(cells).toContain('Ravi Nair');
    expect(cells.some((c) => c.includes('Oct 1, 2026'))).toBe(true);
    expect(cells.some((c) => c.includes('Oct 2, 2026'))).toBe(true);
  });

  it('shows a dash where the creator or the last editor is not known', () => {
    const host = render([{ ...SEGMENT, createdBy: null, updatedBy: null }]);

    const cells = [...host.querySelectorAll('tbody tr td')].map((td) => td.textContent ?? '');
    // Owner name still shows; both new person columns fall back to the dash.
    expect(cells.filter((c) => c === '-').length).toBeGreaterThanOrEqual(2);
    expect(cells).toContain('Asha Rao');
    expect(cells).not.toContain('Ravi Nair');
  });
});
