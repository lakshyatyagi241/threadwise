import { describe, expect, it } from 'vitest';
import { ToastProvider } from '@crm/ui';
import type { WaForm, WaFormList } from '@crm/contracts';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { WA_FORM_KEYS } from '../api/wa-forms-hooks';
import { WaFormsListScreen } from './wa-forms-list-screen';

const form = (over: Partial<WaForm> = {}): WaForm => ({
  id: '33333333-3333-4333-8333-333333333333',
  title: 'Lead capture',
  purpose: null,
  slug: 'lead-capture',
  audienceType: 'lead_capture',
  submissionCap: 0,
  capReachedNote: null,
  sendButtonLabel: 'Send',
  thankYouNote: null,
  definition: {
    screens: [
      { id: 'A', fields: [{ id: 'name', kind: 'short_text', label: 'Name', required: true }] },
    ],
  },
  status: 'published',
  isLive: true,
  publishedAt: '2026-10-08T00:00:00.000Z',
  publishError: null,
  fieldsCount: 1,
  submissionCount: 3,
  createdAt: '2026-10-08T00:00:00.000Z',
  rowVersion: 1,
  ...over,
});

const list = (items: WaForm[]): WaFormList => ({
  items,
  stats: {
    all: items.length,
    published: items.filter((f) => f.status === 'published').length,
    draft: items.filter((f) => f.status === 'draft').length,
    submissions: items.reduce((n, f) => n + f.submissionCount, 0),
  },
  page: { nextCursor: null, hasMore: false, limit: 20 },
});

const ALL = {
  'wfl.forms.read': 'all',
  'wfl.forms.create': 'all',
  'wfl.forms.manage': 'all',
  'wfl.forms.delete': 'all',
} as const;

function render(forms: WaForm[], opts: { locale?: 'en' | 'ar' } = {}) {
  const seed: Seed = [[WA_FORM_KEYS.list(), list(forms)]];
  return renderAccount(
    <ToastProvider dismissLabel="x">
      <WaFormsListScreen />
    </ToastProvider>,
    { locale: opts.locale, session: makeSession({ permissions: ALL as never }), seed },
  );
}

describe('the WhatsApp Forms list screen', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`draws the KPI tiles and the forms table in ${locale}`, () => {
      const html = render(
        [form(), form({ id: '4444', title: 'Survey', status: 'draft', isLive: false })],
        {
          locale,
        },
      );
      expect(html).toContain('Lead capture');
      expect(html).toContain('Survey');
    });
  }

  it('shows the empty state with no forms', () => {
    const html = render([]);
    expect(html).toContain('No forms yet');
  });
});
