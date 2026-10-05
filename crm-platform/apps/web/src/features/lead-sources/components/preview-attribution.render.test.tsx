import { describe, expect, it, vi } from 'vitest';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { leadKeys } from '../api';
import { emptyDraft, newRow } from '../lib/draft';
import { previewView } from '../lib/preview-view';
import { ID, attribution, event, preview, touch } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContactAttributionCard } from './contact-attribution-card';
import { MappingFields } from './mapping-fields';
import { MappingPreview, PreviewResult } from './mapping-preview';

/**
 * Static renders of the mapping preview and the contact's attribution card in English and Arabic. They prove each state of the
 * preview (nothing received yet, a pasted lead, an unreadable phone, reasons) and that the card appears only when there is something
 * to say. No browser: nothing here says how they behave when clicked.
 */

const LOCALES = ['en', 'ar'] as const;
const READ = { 'leads.sources.read': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });
const result = (over: Parameters<typeof preview>[0] = {}) => previewView(preview(over));

describe('mapping preview result', () => {
  for (const locale of LOCALES) {
    it(`shows the contact, its phone before and after, custom values and attribution in ${locale}`, () => {
      const html = renderAccount(<PreviewResult view={result()} />, { locale });
      expect(html).toContain('data-testid="preview-result"');
      expect(html).toContain('Asha Rao');
      expect(html).toContain('asha@example.test');
      expect(html).toContain('98765 43210 → +919876543210');
      expect(html).toContain('budget');
      expect(html).toContain('5000');
      expect(html).toContain('Launch');
    });
  }

  it('says no lead was received yet and asks for a pasted sample', () => {
    const none = result({
      basedOn: 'none',
      usable: false,
      reasons: ['no_payload'],
      availablePaths: [],
    });
    const html = renderAccount(<PreviewResult view={none} />);
    expect(html).toContain('data-testid="preview-none"');
    expect(html).toContain('No lead received yet: paste a sample.');
    expect(html).not.toContain('data-testid="preview-result"');
  });

  it('says whether the lead would be processed and why not, with every reason in words', () => {
    const ok = renderAccount(<PreviewResult view={result()} />);
    expect(ok).toContain('This lead would be processed');
    const bad = renderAccount(
      <PreviewResult
        view={result({
          usable: false,
          reasons: ['no_contact_point', 'email_invalid', 'something_new'],
          contact: {
            name: 'A',
            firstName: null,
            lastName: null,
            email: null,
            phoneRaw: null,
            phone: null,
          },
        })}
      />,
    );
    expect(bad).toContain('This lead would need review');
    expect(bad).toContain('No email and no phone were found.');
    expect(bad).toContain('The email is not a valid address and is ignored.');
    // an unknown reason is shown as the server wrote it
    expect(bad).toContain('something_new');
  });

  it('flags a phone that could not be read as a number', () => {
    const html = renderAccount(
      <PreviewResult
        view={result({
          usable: false,
          reasons: ['invalid_phone'],
          contact: {
            name: 'A',
            firstName: null,
            lastName: null,
            email: null,
            phoneRaw: 'call me',
            phone: null,
          },
        })}
      />,
    );
    expect(html).toContain('call me');
    expect(html).toContain('Could not be read as a number');
  });

  it('offers the paths of the payload as chips that fill the focused input', () => {
    const html = renderAccount(
      <PreviewResult view={result()} onPick={() => undefined} focusedLabel="Phone" />,
    );
    expect(html).toContain('Click one to fill: Phone');
    for (const p of ['lead.full_name', 'lead.mobile', 'lead.budget']) {
      expect(html).toMatch(new RegExp(`<button[^>]*>${p.replace('.', '\\.')}</button>`));
    }
    const unfocused = renderAccount(<PreviewResult view={result()} onPick={() => undefined} />);
    expect(unfocused).toContain('Click a mapping box first');
  });
});

describe('mapping preview panel', () => {
  const draft = emptyDraft();

  for (const locale of LOCALES) {
    it(`asks for a sample or an explicit choice before reading anything in ${locale}`, () => {
      const html = renderAccount(
        <MappingPreview
          sourceId={ID(1)}
          draft={draft}
          onPick={() => undefined}
          focusedLabel={null}
        />,
        { locale, ...as(READ) },
      );
      expect(html).toContain('id="ls-preview-paste"');
      expect(html).toContain('aria-busy="false"');
    });
  }

  it('reading a stored lead is an explicit button, and the audit log is mentioned beside it', () => {
    const html = renderAccount(
      <MappingPreview
        sourceId={ID(1)}
        draft={draft}
        onPick={() => undefined}
        focusedLabel={null}
      />,
    );
    expect(html).toContain('Use the last lead we received');
    expect(html).toContain('recorded in the audit log');
    expect(html).toContain('Paste a sample or use the last lead we received to see the result.');
    // nothing is previewed until a choice is made
    expect(html).not.toContain('data-testid="preview-result"');
    expect(html).not.toContain('data-testid="preview-none"');
  });

  it('does not preview a draft whose mapping is wrong, and says what to do', () => {
    const bad = emptyDraft();
    bad.mapping.customFields = [newRow('Bad Key', 'x')];
    const html = renderAccount(
      <MappingPreview sourceId={ID(1)} draft={bad} onPick={() => undefined} focusedLabel={null} />,
    );
    expect(html).toContain('Fix the highlighted mapping fields to see a preview.');
  });

  it('offers the stored leads that still hold a payload to map against, and only those', () => {
    const list = {
      data: [
        event({ id: ID(61), externalId: 'lead-61', status: 'created', hasPayload: true }),
        event({ id: ID(62), externalId: 'lead-62-purged', status: 'failed', hasPayload: false }),
      ],
      page: { nextCursor: null, hasMore: false, limit: 10 },
    };
    const html = renderAccount(
      <MappingPreview
        sourceId={ID(1)}
        draft={draft}
        onPick={() => undefined}
        focusedLabel={null}
      />,
      { ...as(READ), seed: [[leadKeys.events(ID(1), 'preview-picker', 'all'), list]] },
    );
    expect(html).toContain('id="ls-preview-stored"');
    expect(html).toContain('lead-61 (created)');
    expect(html).not.toContain('lead-62-purged');
    // with no stored lead there is no picker
    const none = renderAccount(
      <MappingPreview
        sourceId={ID(1)}
        draft={draft}
        onPick={() => undefined}
        focusedLabel={null}
      />,
      { ...as(READ) },
    );
    expect(none).not.toContain('id="ls-preview-stored"');
  });
});

describe('mapping fields', () => {
  it('shows every contact field, the custom property rows and the attribution fields, with the properties picker', () => {
    const d = emptyDraft();
    d.mapping.customFields = [newRow('budget', 'lead.budget')];
    const html = renderAccount(
      <MappingFields
        draft={d}
        set={() => undefined}
        problems={{}}
        server={{}}
        onFocusTarget={() => undefined}
      />,
      {
        ...as(READ),
        seed: [[leadKeys.properties, [{ key: 'budget', label: 'Budget' }]]],
      },
    );
    for (const f of ['name', 'firstName', 'lastName', 'email', 'phone']) {
      expect(html).toContain(`id="ls-map-${f}"`);
    }
    for (const f of ['platform', 'campaign', 'adset', 'ad', 'form']) {
      expect(html).toContain(`id="ls-attr-${f}"`);
    }
    expect(html).toContain('data-testid="custom-field-row"');
    expect(html).toContain('Budget (budget)');
    expect(html).toContain('list="ls-available-paths"');
    expect(html).toContain('Add a custom property');
  });

  it('a server error on a custom property shows under that row', () => {
    const d = emptyDraft();
    d.mapping.customFields = [newRow('budget', 'lead.budget')];
    const html = renderAccount(
      <MappingFields
        draft={d}
        set={() => undefined}
        problems={{}}
        server={{
          'mapping.customFields.budget': {
            path: 'mapping.customFields.budget',
            key: 'details.not_mappable',
          },
        }}
        onFocusTarget={() => undefined}
      />,
      { ...as(READ), seed: [[leadKeys.properties, [{ key: 'budget', label: 'Budget' }]]] },
    );
    expect(html).toContain('calculated or points at another record');
  });

  it('read-only inputs have no add or remove controls', () => {
    const d = emptyDraft();
    d.mapping.customFields = [newRow('budget', 'lead.budget')];
    const html = renderAccount(
      <MappingFields
        draft={d}
        set={() => undefined}
        problems={{}}
        server={{}}
        disabled
        onFocusTarget={() => undefined}
      />,
      { ...as(READ), seed: [[leadKeys.properties, [{ key: 'budget', label: 'Budget' }]]] },
    );
    expect(html).not.toContain('Add a custom property');
    expect(html).not.toContain('Remove custom property');
  });
});

describe('contact attribution card', () => {
  const card = (opts: Parameters<typeof renderAccount>[1]) =>
    renderAccount(<ContactAttributionCard contactId={ID(500)} />, opts);
  const seeded = (data: unknown) => [[leadKeys.attribution(ID(500)), data]] as const;

  it('renders nothing while loading and nothing for a contact that never came through a lead source', () => {
    expect(card({ ...as(READ) })).toBe('');
    expect(
      card({
        ...as(READ),
        seed: seeded({ first: null, latest: null, touches: [], total: 0 }),
      }),
    ).toBe('');
  });

  for (const locale of LOCALES) {
    it(`shows the first and the latest touch with their details in ${locale}`, () => {
      const first = touch({
        id: ID(1),
        campaign: 'Launch',
        capturedAt: '2026-10-01T10:00:00.000Z',
      });
      const latest = touch({
        id: ID(2),
        platform: 'google',
        sourceLabel: 'google',
        campaign: 'Retarget',
        adset: null,
        ad: null,
        form: null,
        capturedAt: '2026-10-02T10:00:00.000Z',
      });
      const html = card({
        locale,
        ...as(READ),
        seed: seeded(attribution({ first, latest, touches: [latest, first], total: 2 })),
      });
      expect(html).toContain('data-testid="lead-attribution"');
      expect(html.match(/data-testid="attribution-touch"/g)).toHaveLength(2);
      expect(html).toContain('Launch');
      expect(html).toContain('Retarget');
      expect(html).toContain('AS-1');
      if (locale === 'en') {
        expect(html).toContain('Lead attribution');
        expect(html).toContain('First touch');
        expect(html).toContain('Latest touch');
        expect(html).toContain('2 touches in total');
      }
    });
  }

  it('says "first and latest touch" for a single touch, and no total', () => {
    const html = card({ ...as(READ), seed: seeded(attribution()) });
    expect(html.match(/data-testid="attribution-touch"/g)).toHaveLength(1);
    expect(html).toContain('First and latest touch');
    expect(html).not.toContain('touches in total');
    expect(html).toContain('facebook');
    expect(html).toContain('Launch');
    expect(html).toContain('Ad-1');
  });

  it('links to the lead source only for a person who may read lead sources, and only while it exists', () => {
    const withLink = card({ ...as(READ), seed: seeded(attribution()) });
    expect(withLink).toContain(`href="/lead-sources/${ID(1)}"`);
    const noPermission = card({ ...as({}), seed: seeded(attribution()) });
    expect(noPermission).toContain('data-testid="lead-attribution"');
    expect(noPermission).not.toContain('/lead-sources/');
    const t = touch({ leadSourceId: null });
    const deleted = card({
      ...as(READ),
      seed: seeded(attribution({ first: t, latest: t, touches: [t] })),
    });
    expect(deleted).not.toContain('/lead-sources/');
  });
});
