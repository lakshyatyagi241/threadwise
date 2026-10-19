// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormSubmissionDetail } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { makeSession } from '@/features/auth-registration-security/account/render-test-utils';
import { SessionProvider } from '@/features/auth-registration-security/shared/session-context';

/**
 * A notification (and the notification email) links to `/forms/<id>/submissions?submission=<id>`. The screen must open that submission
 * even when it is not in the first page of the list, which a server render cannot show: this runs the effect in a DOM.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FORM_ID = '11111111-1111-4111-8111-111111111111';
const SUB_ID = '00000000-0000-4000-8000-000000000042';

const state = {
  params: new URLSearchParams(),
  detail: undefined as FormSubmissionDetail | undefined,
};
const asked: Array<string | null> = [];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => `/forms/${FORM_ID}/submissions`,
  useSearchParams: () => state.params,
}));

vi.mock('../api/forms', async (orig) => ({
  ...(await orig<typeof import('../api/forms')>()),
  useForm: () => ({ data: { name: 'Contact us' } }),
  // the list is empty: the linked submission is NOT on the first page
  useSubmissions: () => ({
    isPending: false,
    isError: false,
    isSuccess: true,
    error: null,
    hasNextPage: false,
    data: { pages: [{ data: [], page: { nextCursor: null, hasMore: false, limit: 25 } }] },
    fetchNextPage: () => undefined,
    refetch: () => undefined,
    isFetchingNextPage: false,
  }),
  useSubmission: (_form: string, id: string | null) => {
    asked.push(id);
    return {
      isPending: false,
      isError: id === null || !state.detail,
      data: id ? state.detail : undefined,
      refetch: () => undefined,
    };
  },
}));

import { SubmissionsScreen } from './submissions-screen';

const detail = (): FormSubmissionDetail =>
  ({
    id: SUB_ID,
    formId: FORM_ID,
    status: 'created',
    reason: null,
    preview: { name: 'Grace Hopper', email: 'grace@navy.test', phone: null },
    contact: null,
    company: null,
    formVersion: 1,
    consentGiven: true,
    answersRemoved: false,
    createdAt: '2026-10-11T10:00:00.000Z',
    answers: [],
    ageGate: null,
    guardian: null,
    attribution: { utm: {}, referrer: null, pageUrl: null, userAgent: null },
    consent: null,
    error: null,
    spamScore: 0,
    payments: [],
    duplicatePayment: false,
    updatedAt: '2026-10-11T10:00:00.000Z',
  }) as FormSubmissionDetail;

let root: Root | null = null;
let host: HTMLElement | null = null;

async function mount() {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root!.render(
      createElement(NextIntlClientProvider, {
        locale: 'en',
        messages: loadMessages('en'),
        timeZone: 'UTC',
        children: createElement(QueryClientProvider, {
          client,
          children: createElement(SessionProvider, {
            session: makeSession({ permissions: { 'record.form-submissions.read': 'all' } }),
            children: createElement(ToastProvider, {
              children: createElement(SubmissionsScreen, { formId: FORM_ID }),
            }),
          }),
        }),
      }),
    );
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  asked.length = 0;
  state.detail = undefined;
  state.params = new URLSearchParams();
});

describe('opening a submission from a notification link', () => {
  it('opens the linked submission even though it is not in the listed rows', async () => {
    state.params = new URLSearchParams({ submission: SUB_ID });
    state.detail = detail();
    await mount();
    const drawer = document.querySelector('[data-testid="submission-drawer"]');
    expect(drawer).not.toBeNull();
    expect(drawer!.textContent).toContain('Grace Hopper');
    expect(asked).toContain(SUB_ID);
  });

  it('ignores a value that is not a submission id and opens nothing', async () => {
    state.params = new URLSearchParams({ submission: '../../etc/passwd' });
    await mount();
    expect(document.querySelector('[data-testid="submission-drawer"]')).toBeNull();
  });

  it('opens nothing without the parameter', async () => {
    await mount();
    expect(document.querySelector('[data-testid="submission-drawer"]')).toBeNull();
  });
});
