import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMessages } from '@/features/auth-registration-security/platform/render-test-utils';
import { OptionList, WorkspaceTable } from './workspaces-views';
import { WORKSPACES_QUERY_KEY, WorkspacesPanel } from './workspaces-panel';
import { toOptions, toRows } from './lib/workspaces';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/admin/node-bridge',
  useSearchParams: () => new URLSearchParams(),
}));

const acme = {
  orgUuid: '0b7f6d1e-6a0e-4c52-9a4b-1c2d3e4f5a6b',
  name: 'Acme Trading',
  slug: 'acme',
  planSlug: 'pro',
  enabledAt: '2026-10-06T08:00:00.000Z',
  enabledBy: { name: 'Sam Ops' },
  note: 'pilot client',
  deviceCount: 3,
  activeDeviceCount: 2,
};

const seedList = (data: unknown[], hasMore = false) =>
  [
    [
      WORKSPACES_QUERY_KEY,
      {
        pages: [{ data, page: { nextCursor: hasMore ? 'c1' : null, hasMore, limit: 25 } }],
        pageParams: [undefined],
      },
    ],
  ] as const;

const panel = (
  locale: 'en' | 'ar',
  o: { platformOn: boolean; count: number; canEdit?: boolean; data?: unknown[]; more?: boolean },
) =>
  renderWithMessages(
    createElement(WorkspacesPanel, {
      platformOn: o.platformOn,
      workspaceCount: o.count,
      canEdit: o.canEdit ?? true,
    }),
    { locale, seed: seedList(o.data ?? [], o.more ?? false) },
  );

const W = {
  en: {
    title: 'Workspaces with unofficial WhatsApp',
    desc: 'Off for everyone by default.',
    none: 'No workspaces allowed',
    one: '1 workspace allowed',
    empty: 'No workspaces allowed yet',
    banner: 'The engine is off, so these workspaces cannot use it yet.',
    readOnly: 'Only a super admin can add or remove workspaces.',
    active: '2 active of 3',
    loadMore: 'Load more',
    search: 'Add a workspace',
  },
  ar: {
    title: 'مساحات العمل التي لديها واتساب غير الرسمي',
    desc: 'معطّل للجميع افتراضيًا.',
    none: 'لا مساحات عمل مسموح بها',
    one: 'مساحة عمل واحدة مسموح بها',
    empty: 'لا توجد مساحات عمل مسموح بها بعد',
    banner: 'المحرك متوقف، لذا لا تستطيع مساحات العمل هذه استخدامه بعد.',
    readOnly: 'يمكن للمشرف الأعلى فقط إضافة مساحات العمل أو إزالتها.',
    active: '2 نشط من 3',
    loadMore: 'عرض المزيد',
    search: 'إضافة مساحة عمل',
  },
} as const;

describe.each(['en', 'ar'] as const)('Workspaces with unofficial WhatsApp panel (%s)', (locale) => {
  const w = W[locale];

  it('empty: explains the default, shows a zero count, the search and the empty state', () => {
    const html = panel(locale, { platformOn: true, count: 0 });
    expect(html).toContain('data-testid="workspaces-panel"');
    expect(html).toContain(w.title);
    expect(html).toContain(w.desc);
    expect(html).toContain(w.none);
    expect(html).toContain(w.search);
    expect(html).toContain(w.empty);
    expect(html).not.toContain('workspaces-engine-off');
  });

  it('loaded: one row with plan, devices, who enabled it and the note, and a Remove button', () => {
    const html = panel(locale, { platformOn: true, count: 1, data: [acme] });
    expect(html).toContain(w.one);
    expect(html).toContain('data-testid="workspace-row-acme"');
    expect(html).toContain('Acme Trading');
    expect(html).toContain('pro');
    expect(html).toContain(w.active);
    expect(html).toContain('Sam Ops');
    expect(html).toContain('pilot client');
    expect(html).toContain('data-testid="workspace-remove-acme"');
    expect(html).not.toContain(w.empty);
    expect(html).not.toContain('workspaces-engine-off');
  });

  it('warning banner: the engine is off and the list is not empty, with a way to the switch', () => {
    const html = panel(locale, { platformOn: false, count: 1, data: [acme] });
    expect(html).toContain('data-testid="workspaces-engine-off"');
    expect(html).toContain(w.banner);
  });

  it('no banner while the engine is off and the list is empty', () => {
    const html = panel(locale, { platformOn: false, count: 0 });
    expect(html).not.toContain('workspaces-engine-off');
  });

  it('load more shows only when the API has another page', () => {
    const more = panel(locale, { platformOn: true, count: 30, data: [acme], more: true });
    expect(more).toContain('data-testid="workspaces-load-more"');
    expect(more).toContain(w.loadMore);
    expect(panel(locale, { platformOn: true, count: 1, data: [acme] })).not.toContain(
      'workspaces-load-more',
    );
  });

  it('read-only role: the list without search, Remove or the banner action', () => {
    const html = panel(locale, { platformOn: false, count: 1, data: [acme], canEdit: false });
    expect(html).toContain('data-testid="workspaces-read-only"');
    expect(html).toContain(w.readOnly);
    expect(html).toContain('data-testid="workspace-row-acme"');
    expect(html).not.toContain('data-testid="workspaces-search"');
    expect(html).not.toContain('workspace-remove-');
    expect(html).toContain('workspaces-engine-off');
  });

  it('loading: shown before the list has arrived', () => {
    const html = renderWithMessages(
      createElement(WorkspacesPanel, { platformOn: true, workspaceCount: 0, canEdit: true }),
      { locale },
    );
    expect(html).toContain('role="status"');
    expect(html).not.toContain(w.empty);
  });

  it('search results: name, slug, plan, owner e-mail, Add; an allowed one says so', () => {
    const html = renderWithMessages(
      createElement(OptionList, {
        busy: false,
        onAdd: () => undefined,
        options: toOptions([
          {
            orgUuid: 'a',
            name: 'Beta Ltd',
            slug: 'beta',
            planSlug: null,
            ownerEmail: 'owner@beta.io',
            alreadyEnabled: false,
          },
          {
            orgUuid: 'b',
            name: 'Acme Trading',
            slug: 'acme',
            planSlug: 'pro',
            ownerEmail: null,
            alreadyEnabled: true,
          },
        ]),
      }),
      { locale },
    );
    expect(html).toContain('Beta Ltd');
    expect(html).toContain('owner@beta.io');
    expect(html).toContain('data-testid="workspace-add-beta"');
    expect(html).not.toContain('workspace-add-acme');
  });

  it('table without onRemove has no actions column', () => {
    const html = renderWithMessages(
      createElement(WorkspaceTable, { rows: toRows([acme]), busy: false }),
      { locale },
    );
    expect(html).not.toContain('workspace-remove-');
  });
});
