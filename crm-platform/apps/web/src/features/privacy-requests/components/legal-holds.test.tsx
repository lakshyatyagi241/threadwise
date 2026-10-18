// @vitest-environment jsdom
import type { LegalHold } from '@crm/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { button, click, makeRequest, mount, text, type, type Mounted } from '../testing';

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  list: {} as Record<string, unknown>,
  detail: {} as Record<string, unknown>,
  status: {} as Record<string, unknown>,
  place: vi.fn(),
  release: vi.fn(),
  extend: vi.fn(),
  review: vi.fn(),
}));
vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('../api/hooks', () => ({
  KEYS: { all: ['privacy-requests'] },
  useSubjectSearch: () => ({ data: undefined }),
}));
vi.mock('../api/legal-holds', () => ({
  HOLD_KEYS: { all: ['legal-holds'] },
  legalHoldsApi: {
    place: (i: unknown) => state.place(i),
    release: (id: string, i: unknown) => state.release(id, i),
    extend: (id: string, i: unknown) => state.extend(id, i),
    review: (id: string, i: unknown) => state.review(id, i),
  },
  legalHoldsExportUrl: () => '/api/v2/privacy/legal-holds/export',
  useLegalHolds: () => state.list,
  useLegalHold: () => state.detail,
  useSubjectHold: () => state.status,
}));

import { LegalHoldsScreen } from './legal-holds-screen';
import { useContactLegalHold } from './contact-legal-hold';
import { RestrictedSection } from './restricted-section';

const hold = (over: Partial<LegalHold> = {}): LegalHold => ({
  id: '33333333-3333-4333-8333-333333333333',
  scope: 'contact',
  subjectId: '22222222-2222-4222-8222-222222222222',
  subjectLabel: 'R•••• · ••••4821',
  reasonCategory: 'legal_claim',
  caseRef: 'CASE-77',
  note: null,
  reviewAt: '2026-09-01T00:00:00.000Z',
  reviewDue: true,
  expiresAt: null,
  status: 'active',
  placedBy: 'Ada Admin',
  placedAt: '2026-08-01T00:00:00.000Z',
  lastReviewedBy: null,
  lastReviewedAt: null,
  releasedBy: null,
  releasedAt: null,
  releaseNote: null,
  restrictedCases: 1,
  rowVersion: 1,
  ...over,
});

const listOf = (rows: LegalHold[]) => ({
  isError: false,
  isPending: false,
  error: null,
  refetch: vi.fn(),
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
  data: { pages: [{ data: rows, page: { nextCursor: null, hasMore: false, limit: 25 } }] },
});

let m: Mounted | null = null;
beforeEach(() => {
  state.perms = new Set(['privacy.requests.read', 'privacy.requests.manage']);
  state.place.mockReset().mockResolvedValue(hold());
  state.release
    .mockReset()
    .mockResolvedValue({ hold: hold({ status: 'released' }), casesLifted: 1, erasuresResuming: 1 });
  state.extend.mockReset().mockResolvedValue(hold());
  state.review.mockReset().mockResolvedValue(hold());
  state.list = listOf([hold()]);
  state.detail = { isPending: true, isError: false, data: undefined, error: null };
  state.status = { data: { held: false, hold: null, viaWorkspace: false } };
});
afterEach(async () => {
  await m?.unmount();
  m = null;
});

describe.each(['en', 'ar'])('the legal holds register (%s)', (locale) => {
  it('lists the holds with reason, case reference and an overdue review, and offers the actions to a manager', async () => {
    m = await mount(<LegalHoldsScreen />, { locale });
    const h = m.host;
    expect(h.textContent).toContain(text('legalHold.register.title', locale));
    expect(h.textContent).toContain('R•••• · ••••4821');
    expect(h.textContent).toContain('CASE-77');
    expect(h.textContent).toContain(text('legalHold.category.legal_claim', locale));
    expect(h.textContent).toContain(text('legalHold.register.overdue', locale));
    for (const a of ['review', 'extend', 'release']) {
      expect(button(h, text(`legalHold.actions.${a}`, locale))).toBeTruthy();
    }
    expect(h.querySelector('a[href="/api/v2/privacy/legal-holds/export"]')).not.toBeNull();
  });

  it('shows a reader the register but none of the actions, and nothing to a person without the privacy key', async () => {
    state.perms = new Set(['privacy.requests.read']);
    m = await mount(<LegalHoldsScreen />, { locale });
    expect(m.host.textContent).toContain('CASE-77');
    expect(
      [...m.host.querySelectorAll('button')].some(
        (b) => b.textContent === text('legalHold.actions.release', locale),
      ),
    ).toBe(false);
    expect(
      [...m.host.querySelectorAll('button')].some(
        (b) => b.textContent === text('legalHold.register.place', locale),
      ),
    ).toBe(false);
    await m.unmount();
    state.perms = new Set();
    m = await mount(<LegalHoldsScreen />, { locale });
    expect(m.host.textContent).toContain(text('errors.forbidden', locale));
    expect(m.host.textContent).not.toContain('CASE-77');
  });

  it('releases a hold only after the dialog, and says that a confirmed erasure will run', async () => {
    m = await mount(<LegalHoldsScreen />, { locale });
    await click(button(m.host, text('legalHold.actions.release', locale)));
    expect(m.host.textContent).toContain(text('legalHold.release.message', locale));
    expect(state.release).not.toHaveBeenCalled();
    await click(button(m.host, text('legalHold.release.submit', locale)));
    expect(state.release).toHaveBeenCalledWith('33333333-3333-4333-8333-333333333333', {});
  });

  it('places a workspace hold: the button waits for a reason and a case reference', async () => {
    m = await mount(<LegalHoldsScreen />, { locale });
    await click(button(m.host, text('legalHold.register.place', locale)));
    const workspace = [...m.host.querySelectorAll<HTMLInputElement>('input[name="lh-target"]')][1]!;
    await click(workspace);
    const submit = button(m.host, text('legalHold.place.submit', locale));
    expect(submit.disabled).toBe(true);
    const select = m.host.querySelector<HTMLSelectElement>('#lh-category')!;
    select.value = 'regulator_request';
    await import('react').then(({ act }) =>
      act(async () => {
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    );
    await type(m.host.querySelector<HTMLInputElement>('#lh-case-ref')!, 'REG-1');
    expect(button(m.host, text('legalHold.place.submit', locale)).disabled).toBe(false);
    await click(button(m.host, text('legalHold.place.submit', locale)));
    expect(state.place).toHaveBeenCalledWith({
      scope: 'workspace',
      reasonCategory: 'regulator_request',
      caseRef: 'REG-1',
    });
  });
});

function Harness({ id }: { id: string }) {
  const h = useContactLegalHold(id);
  return (
    <div>
      <div data-testid="banner">{h.banner}</div>
      <div data-testid="items">{h.items}</div>
      <div data-testid="dialogs">{h.dialogs}</div>
    </div>
  );
}

describe('the contact page', () => {
  it('shows the banner and Release to people with the privacy keys', async () => {
    state.status = { data: { held: true, hold: hold(), viaWorkspace: false } };
    m = await mount(<Harness id="22222222-2222-4222-8222-222222222222" />);
    const banner = m.host.querySelector('[data-testid="contact-legal-hold-banner"]');
    expect(banner?.textContent).toContain(text('legalHold.contactBanner'));
    expect(banner?.textContent).toContain('CASE-77');
    expect(m.host.querySelector('[data-testid="items"]')?.textContent).toContain(
      text('legalHold.menu.release'),
    );
  });

  it('offers Place when the contact is not held, and Release never for a workspace hold', async () => {
    m = await mount(<Harness id="22222222-2222-4222-8222-222222222222" />);
    expect(m.host.querySelector('[data-testid="items"]')?.textContent).toContain(
      text('legalHold.menu.place'),
    );
    expect(m.host.querySelector('[data-testid="contact-legal-hold-banner"]')).toBeNull();
    await m.unmount();
    state.status = { data: { held: true, hold: hold({ scope: 'workspace' }), viaWorkspace: true } };
    m = await mount(<Harness id="22222222-2222-4222-8222-222222222222" />);
    expect(m.host.textContent).toContain(text('legalHold.workspaceBanner'));
    expect(m.host.querySelector('[data-testid="items"]')?.textContent).toBe('');
  });

  it('shows a reader the banner but no menu item, and shows anyone else nothing at all', async () => {
    state.status = { data: { held: true, hold: hold(), viaWorkspace: false } };
    state.perms = new Set(['privacy.requests.read']);
    m = await mount(<Harness id="22222222-2222-4222-8222-222222222222" />);
    expect(m.host.querySelector('[data-testid="contact-legal-hold-banner"]')).not.toBeNull();
    expect(m.host.querySelector('[data-testid="items"]')?.textContent).toBe('');
    await m.unmount();
    // No privacy key: the hook shows nothing even if the answer were in the cache.
    state.perms = new Set();
    m = await mount(<Harness id="22222222-2222-4222-8222-222222222222" />);
    expect(m.host.querySelector('[data-testid="contact-legal-hold-banner"]')).toBeNull();
    expect(m.host.textContent).toBe('');
  });
});

describe('a restricted rights case', () => {
  it('shows the default answer to the person, or the workspace wording, without the reason', async () => {
    m = await mount(
      <RestrictedSection
        request={makeRequest({ restricted: true, restrictedAt: '2026-10-05T00:00:00.000Z' })}
      />,
    );
    expect(m.host.textContent).toContain(text('legalHold.caseStatus'));
    expect(m.host.textContent).toContain(text('legalHold.requesterResponse'));
    expect(m.host.textContent).not.toMatch(/investigation|claim|regulator/i);
    await m.unmount();
    m = await mount(
      <RestrictedSection
        request={makeRequest({
          restricted: true,
          restrictedAt: '2026-10-05T00:00:00.000Z',
          restrictionNotice: 'Our counsel wording.',
        })}
      />,
    );
    expect(m.host.textContent).toContain('Our counsel wording.');
    expect(m.host.textContent).not.toContain(text('legalHold.requesterResponse'));
  });
});
