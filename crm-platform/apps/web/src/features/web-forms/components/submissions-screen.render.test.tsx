import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FORM_SUBMISSION_REASONS,
  FORM_SUBMISSION_STATUSES,
  type FormSubmissionDetail,
  type FormSubmissionSummary,
} from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';

const FORM_ID = '11111111-1111-4111-8111-111111111111';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const state = {
  list: {
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    hasNextPage: false,
  } as Record<string, unknown>,
  rows: [] as FormSubmissionSummary[],
  detail: { isPending: false, isError: false, data: undefined } as Record<string, unknown>,
  params: new URLSearchParams(),
};
const exportSubmissions = vi.fn();
const retrySubmission = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => `/forms/${FORM_ID}/submissions`,
  useSearchParams: () => state.params,
}));

vi.mock('../api/forms', async (orig) => ({
  ...(await orig<typeof import('../api/forms')>()),
  useForm: () => ({ data: { name: 'Contact us' } }),
  useSubmissions: () => ({
    ...state.list,
    data: { pages: [{ data: state.rows, page: { nextCursor: null, hasMore: false, limit: 25 } }] },
    fetchNextPage: () => undefined,
    refetch: () => undefined,
    isFetchingNextPage: false,
  }),
  useSubmission: () => ({ ...state.detail, refetch: () => undefined }),
  exportSubmissions: (...a: unknown[]) => exportSubmissions(...a),
  retrySubmission: (...a: unknown[]) => retrySubmission(...a),
}));

import { SubmissionDrawer, SubmissionsScreen } from './submissions-screen';

const LOCALES = ['en', 'ar'] as const;
const ALL = {
  'record.form-submissions.read': 'all',
  'record.form-submissions.update': 'all',
  'record.form-submissions.delete': 'all',
  'record.form-submissions.export': 'all',
} as const;
const READ_ONLY = { 'record.form-submissions.read': 'all' } as const;

function summary(over: Partial<FormSubmissionSummary> = {}): FormSubmissionSummary {
  return {
    id: uuid(1),
    formId: FORM_ID,
    status: 'created',
    reason: null,
    preview: { name: 'Asha Rao', email: 'asha@acme.test', phone: '+919800000001' },
    contact: { id: uuid(50), name: 'Asha Rao' },
    company: { id: uuid(60), name: 'Acme Co' },
    formVersion: 3,
    consentGiven: true,
    answersRemoved: false,
    createdAt: '2026-05-06T10:00:00.000Z',
    ...over,
  };
}

function detail(over: Partial<FormSubmissionDetail> = {}): FormSubmissionDetail {
  return {
    ...summary(),
    answers: [
      { fieldId: 'a', label: 'Full name', kind: 'text', value: 'Asha Rao' },
      {
        fieldId: 'b',
        label: 'Message',
        kind: 'textarea',
        value: '<script>alert(1)</script>\nline two',
      },
      { fieldId: 'c', label: 'Interests', kind: 'checkbox_group', value: ['Sales', 'Support'] },
      { fieldId: 'd', label: 'Newsletter', kind: 'checkbox', value: true },
    ] as FormSubmissionDetail['answers'],
    attribution: {
      utm: { utm_source: 'newsletter' },
      referrer: 'https://news.test/post',
      pageUrl: 'https://acme.test/contact',
      userAgent: 'Mozilla/5.0 Test',
    },
    consent: {
      given: true,
      text: 'I agree to be contacted.',
      version: 2,
      at: '2026-05-06T10:00:00.000Z',
    },
    error: null,
    spamScore: 0,
    updatedAt: '2026-05-06T10:00:00.000Z',
    ...over,
  };
}

const screen =
  (perms: Record<string, 'all'> = ALL) =>
  (locale: 'en' | 'ar') =>
    renderAccount(
      createElement(ToastProvider, null, createElement(SubmissionsScreen, { formId: FORM_ID })),
      {
        locale,
        session: makeSession({ permissions: perms }),
      },
    );

const drawer = (
  s: FormSubmissionSummary,
  locale: 'en' | 'ar',
  perms: Record<string, 'all'> = ALL,
) =>
  renderAccount(
    createElement(
      ToastProvider,
      null,
      createElement(SubmissionDrawer, {
        formId: FORM_ID,
        summary: s,
        onClose: () => undefined,
        onChanged: () => undefined,
      }),
    ),
    { locale, session: makeSession({ permissions: perms }) },
  );

beforeEach(() => {
  state.list = {
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    hasNextPage: false,
  };
  state.rows = [];
  state.detail = { isPending: false, isError: false, data: detail() };
  state.params = new URLSearchParams();
  exportSubmissions.mockReset();
  retrySubmission.mockReset();
});

describe('Submissions screen: list', () => {
  for (const locale of LOCALES) {
    it(`renders a row per status with a visible status word in ${locale}`, () => {
      state.rows = FORM_SUBMISSION_STATUSES.map((status, i) =>
        summary({ id: uuid(i + 1), status, reason: status === 'spam' ? 'spam_score' : null }),
      );
      const html = screen()(locale);
      expect(html).toContain('data-testid="submissions-table"');
      expect(html).toContain('<th scope="col"');
      for (const s of FORM_SUBMISSION_STATUSES) {
        expect(html).toContain(`data-status="${s}"`);
      }
      expect(html).toContain(`href="/contacts/${uuid(50)}"`);
      expect(html).toContain(`href="/companies/${uuid(60)}"`);
      expect(html).toContain(`href="/forms/${FORM_ID}"`);
      expect(html).toContain('dir="ltr"');
    });
  }

  it('prints a sentence for every reason code and an unknown one', () => {
    state.rows = [
      ...FORM_SUBMISSION_REASONS.map((reason, i) =>
        summary({ id: uuid(i + 1), status: 'needs_review', reason }),
      ),
      summary({ id: uuid(99), status: 'failed', reason: 'something_new' }),
    ];
    for (const locale of LOCALES) {
      const html = screen()(locale);
      expect(html.match(/data-testid="reason"/g)?.length).toBe(
        FORM_SUBMISSION_REASONS.length * 2 + 2,
      );
    }
  });

  it('shows the loading state', () => {
    state.list = { isPending: true, isError: false, isSuccess: false, error: null };
    const html = screen()('en');
    expect(html).toContain('data-testid="loading"');
    expect(html).not.toContain('submissions-table');
  });

  it('shows the empty state with a link to share the form', () => {
    for (const locale of LOCALES) {
      const html = screen()(locale);
      expect(html).toContain(`href="/forms/${FORM_ID}?tab=share"`);
    }
  });

  it('asks to clear filters when the filters empty the list', () => {
    state.params = new URLSearchParams('status=paid');
    const html = screen()('en');
    expect(html).toContain('No submissions match');
    expect(html).not.toContain('?tab=share');
  });

  it('shows an error with a retry, and the plan lock as an empty state', () => {
    state.list = { isPending: false, isError: true, isSuccess: false, error: new Error('x') };
    expect(screen()('en')).toContain('Submissions could not be loaded.');
    state.list = {
      isPending: false,
      isError: true,
      isSuccess: false,
      error: new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'),
    };
    const html = screen()('en');
    expect(html).toContain('Forms is not part of your plan');
    expect(html).not.toContain('data-testid="export-csv"');
  });

  it('shows the plan notice only when a submission was held by the cap', () => {
    state.rows = [summary()];
    expect(screen()('en')).not.toContain('data-testid="cap-notice"');
    state.rows = [summary({ status: 'needs_review', reason: 'submissions_cap' })];
    for (const locale of LOCALES) {
      const html = screen()(locale);
      expect(html).toContain('data-testid="cap-notice"');
      expect(html).toContain('href="/account/plans"');
    }
  });

  it('offers the export only with the export permission', () => {
    state.rows = [summary()];
    expect(screen()('en')).toContain('data-testid="export-csv"');
    expect(screen(READ_ONLY)('en')).not.toContain('data-testid="export-csv"');
    expect(exportSubmissions).not.toHaveBeenCalled();
  });

  it('disables the export on the needs-attention group, which has no single status', () => {
    state.rows = [summary()];
    state.params = new URLSearchParams('tab=needs_attention');
    expect(screen()('en')).toMatch(
      /data-testid="export-csv"[^>]*disabled|disabled=""[^>]*data-testid="export-csv"/,
    );
  });
});

describe('Submissions screen: drawer', () => {
  for (const locale of LOCALES) {
    it(`shows answers as text, attribution and consent in ${locale}`, () => {
      const html = drawer(summary(), locale);
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby=');
      expect(html).toContain('data-testid="answers"');
      // The markup the visitor typed is escaped, not interpreted.
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('whitespace-pre-wrap');
      expect(html).toContain('Sales, Support');
      expect(html).toContain('data-testid="attribution"');
      expect(html).toContain('newsletter');
      expect(html).toContain('https://acme.test/contact');
      expect(html).toContain('data-testid="consent"');
      expect(html).toContain('I agree to be contacted.');
    });
  }

  it('offers Retry only for needs_review, failed and spam (the "not spam" action)', () => {
    for (const status of FORM_SUBMISSION_STATUSES) {
      const html = drawer(summary({ status }), 'en');
      const expected = status === 'needs_review' || status === 'failed' || status === 'spam';
      expect(html.includes('data-testid="retry"'), status).toBe(expected);
    }
  });

  it('hides Retry and Delete without the permissions', () => {
    const html = drawer(summary({ status: 'failed' }), 'en', READ_ONLY);
    expect(html).not.toContain('data-testid="retry"');
    expect(html).not.toContain('data-testid="delete"');
    expect(drawer(summary(), 'en')).toContain('data-testid="delete"');
  });

  it('shows the answers-removed state instead of answers, and no Delete', () => {
    state.detail = {
      isPending: false,
      isError: false,
      data: detail({ answersRemoved: true, answers: [] }),
    };
    const html = drawer(summary({ answersRemoved: true }), 'en');
    expect(html).toContain('data-testid="answers-removed"');
    expect(html).toContain('Answers were removed');
    expect(html).not.toContain('data-testid="answers"');
    expect(html).not.toContain('data-testid="delete"');
  });

  it('says that opening answers is audited, and loads without answers while pending', () => {
    state.detail = { isPending: true, isError: false, data: undefined };
    const html = drawer(summary(), 'en');
    expect(html).toContain('recorded in the audit log');
    expect(html).toContain('Opening submission');
    expect(html).not.toContain('data-testid="answers"');
  });

  it('shows the reason and what to do for a failed submission', () => {
    const html = drawer(summary({ status: 'failed', reason: 'internal_error' }), 'en');
    expect(html).toContain('Something went wrong on our side');
    expect(html).toContain('What to do');
  });
});
