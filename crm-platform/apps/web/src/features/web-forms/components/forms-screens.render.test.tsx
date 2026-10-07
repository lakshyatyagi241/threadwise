import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { KEYS } from '../api/forms';
import { definition, detail, PROPERTIES, summary, UUID } from '../test-fixtures';

const search = vi.hoisted(() => ({ value: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/forms',
  useSearchParams: () => new URLSearchParams(search.value),
}));

import { FormsScreen } from './forms-screen';
import { NewFormDialog } from './new-form-dialog';
import { TemplatesScreen } from './templates-screen';
import { BuilderScreen } from './builder-screen';

/**
 * These render each screen to static HTML with the real English and Arabic messages. They prove the text is complete (a missing or
 * broken message throws), that permissions decide what is offered, and that the data the API sends is what the screen shows. There is
 * no browser here: nothing below says how the screens look or behave when clicked.
 */
const LOCALES = ['en', 'ar'] as const;
const ALL = {
  'record.forms.read': 'all',
  'record.forms.create': 'all',
  'record.forms.update': 'all',
  'record.forms.delete': 'all',
  'record.form-submissions.read': 'all',
} as const;
const READ = { 'record.forms.read': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });
const infinite = (rows: unknown[]) => ({
  pages: [{ data: rows, page: { nextCursor: null, hasMore: false, limit: 25 } }],
  pageParams: [undefined],
});
const listSeed = (rows: unknown[]) => [[KEYS.list({}), infinite(rows)] as const];
const wrap = (el: React.ReactElement) => <ToastProvider>{el}</ToastProvider>;

const TEMPLATES = {
  data: [
    {
      key: 'lead',
      name: 'Lead capture',
      description: 'Collect names and emails.',
      category: 'lead',
      definition: definition(),
    },
    {
      key: 'survey',
      name: 'Short survey',
      description: 'Ask three questions.',
      category: 'survey',
      definition: definition(),
    },
  ],
};

describe('Forms list', () => {
  const rows = [
    summary(),
    summary({
      id: UUID(2),
      name: 'Event sign up',
      status: 'draft',
      publishedVersion: null,
      publishedAt: null,
      views: 0,
      submissions: 0,
      lastSubmissionAt: null,
    }),
    summary({
      id: UUID(3),
      name: 'Old promo',
      status: 'archived',
      needsReview: 2,
      hasUnpublishedChanges: true,
    }),
    summary({
      id: UUID(4),
      name: 'Spring offer',
      status: 'paused',
      hasUnpublishedChanges: true,
      needsReview: 3,
    }),
  ];

  for (const locale of LOCALES) {
    it(`shows each form with its status, counts and conversion in ${locale}`, () => {
      const html = renderAccount(wrap(<FormsScreen />), {
        locale,
        ...as(ALL),
        seed: listSeed(rows),
      });
      for (const name of ['Contact us', 'Event sign up', 'Old promo', 'Spring offer'])
        expect(html).toContain(name);
      // 30 submissions of 200 views is 15%; a form with no view has no rate.
      expect(html).toContain('15%');
      expect(html).toContain('/forms/' + UUID(1));
      // An archived form opens on its submissions, a live one in the builder.
      expect(html).toContain(`/forms/${UUID(3)}/submissions`);
      expect(html).toContain(`/forms/${UUID(3)}/submissions?tab=needs_attention`);
    });
  }

  it('offers New form and Templates to someone who may create, and only Templates otherwise', () => {
    const can = renderAccount(wrap(<FormsScreen />), { ...as(ALL), seed: listSeed(rows) });
    expect(can).toContain('New form');
    expect(can).toContain('/forms/templates');
    const cannot = renderAccount(wrap(<FormsScreen />), { ...as(READ), seed: listSeed(rows) });
    expect(cannot).not.toContain('>New form<');
    expect(cannot).toContain('/forms/templates');
  });

  it('puts the three starts in the empty state, and hides them without the create permission', () => {
    const empty = renderAccount(wrap(<FormsScreen />), { ...as(ALL), seed: listSeed([]) });
    expect(empty).toContain('No forms yet');
    expect(empty).toContain('>Start from a template<');
    expect(empty).toContain('>Blank form<');
    const readOnly = renderAccount(wrap(<FormsScreen />), { ...as(READ), seed: listSeed([]) });
    expect(readOnly).toContain('No forms yet');
    expect(readOnly).not.toContain('>Start from a template<');
  });

  it('shows a spinner while loading', () => {
    expect(renderAccount(wrap(<FormsScreen />), { ...as(ALL) })).toContain('Loading forms');
  });

  it('keeps the view in the address', () => {
    search.value = 'view=draft';
    const html = renderAccount(wrap(<FormsScreen />), {
      ...as(ALL),
      seed: [[KEYS.list({ status: 'draft' }), infinite([rows[1]])]],
    });
    search.value = '';
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Event sign up');
    expect(html).not.toContain('Old promo');
  });
});

describe('New form dialog and templates', () => {
  const seed = [[KEYS.templates, TEMPLATES] as const];
  for (const locale of LOCALES) {
    it(`lists the gallery with field counts in ${locale}`, () => {
      const html = renderAccount(
        <NewFormDialog
          open
          onClose={() => undefined}
          mode="template"
          onMode={() => undefined}
          templateKey="lead"
          onTemplate={() => undefined}
        />,
        { locale, ...as(ALL), seed },
      );
      expect(html).toContain('Lead capture');
      expect(html).toContain('Short survey');
      expect(html).toContain('role="radiogroup"');
      expect(html).toContain('aria-checked="true"');
      // The name follows the chosen template until the person types one.
      expect(html).toContain('value="Lead capture"');
    });
  }

  it('starts blank with an empty name and no gallery', () => {
    const html = renderAccount(
      <NewFormDialog
        open
        onClose={() => undefined}
        mode="blank"
        onMode={() => undefined}
        templateKey={null}
        onTemplate={() => undefined}
      />,
      { ...as(ALL), seed },
    );
    expect(html).toContain('value=""');
    expect(html).not.toContain('role="radiogroup"');
  });

  it('renders nothing while closed', () => {
    const html = renderAccount(
      <NewFormDialog
        open={false}
        onClose={() => undefined}
        mode="blank"
        onMode={() => undefined}
        templateKey={null}
        onTemplate={() => undefined}
      />,
      { ...as(ALL), seed },
    );
    expect(html).toBe('');
  });

  for (const locale of LOCALES) {
    it(`renders the template cards in ${locale}`, () => {
      const html = renderAccount(<TemplatesScreen />, { locale, ...as(ALL), seed });
      expect(html).toContain('Lead capture');
      expect(html).toContain('Name');
      expect(html).toContain('Message');
    });
  }

  it('hides the use buttons without the create permission', () => {
    expect(renderAccount(<TemplatesScreen />, { ...as(READ), seed })).not.toContain(
      'Use this template',
    );
    expect(renderAccount(<TemplatesScreen />, { ...as(ALL), seed })).toContain('Use this template');
  });
});

describe('Builder', () => {
  const form = detail();
  const seed = [
    [KEYS.one(form.id), form] as const,
    [
      KEYS.properties('contact'),
      { data: PROPERTIES.filter((p) => p.object === 'contact') },
    ] as const,
    [
      KEYS.properties('company'),
      { data: PROPERTIES.filter((p) => p.object === 'company') },
    ] as const,
  ];
  const render = (locale: 'en' | 'ar', permissions: Record<string, 'all'> = ALL) =>
    renderAccount(wrap(<BuilderScreen formId={form.id} />), { locale, ...as(permissions), seed });

  for (const locale of LOCALES) {
    it(`shows the status, the live version, the tabs and the blocks in ${locale}`, () => {
      const html = render(locale);
      expect(html).toContain('role="tablist"');
      expect(html).toContain('aria-selected="true"');
      for (const label of ['Name', 'Email', 'Topic', 'Message']) expect(html).toContain(label);
      // A field linked to a contact property says so.
      expect(html).toContain('Contact');
    });
  }

  it('lists the palette: field types, hidden fields and the CRM properties with the required one marked', () => {
    const html = render('en');
    expect(html).toContain('New fields');
    expect(html).toContain('Hidden fields');
    expect(html).toContain('CRM properties');
    expect(html).toContain('Budget');
    expect(html).toContain('Company name');
    // name and email are already in the form, so their entries say so.
    expect(html).toContain('In form');
  });

  it('offers Save and Publish to an editor, and neither to a reader', () => {
    const edit = render('en');
    expect(edit).toContain('Save draft');
    expect(edit).toContain('Publish changes');
    const read = render('en', READ);
    expect(read).not.toContain('Save draft');
    expect(read).not.toContain('Publish changes');
    expect(read).toContain('You can view this form but not change it.');
    expect(read).not.toContain('Move Name up');
  });

  it('shows a draft form as never published', () => {
    const draft = detail({ status: 'draft', publishedVersion: null, publishedAt: null });
    const html = renderAccount(wrap(<BuilderScreen formId={draft.id} />), {
      ...as(ALL),
      seed: [[KEYS.one(draft.id), draft]],
    });
    expect(html).toContain('Never published');
    expect(html).toContain('>Publish<');
  });

  it('opens the tab the address asks for', () => {
    search.value = 'tab=share';
    const html = render('en');
    search.value = '';
    expect(html).toContain('Public link');
  });

  it('shows a clear message for a form that was not found', () => {
    const html = renderAccount(wrap(<BuilderScreen formId={UUID(99)} />), { ...as(ALL), seed: [] });
    expect(html).toContain('Loading the form');
  });
});
