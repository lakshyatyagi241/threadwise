import { describe, expect, it } from 'vitest';
import { formDefinitionSchema, formLiveSettingsSchema } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import type { Definition, FormDetail, FormLiveSettings } from '../lib/types';
import type { BuilderTabProps } from './builder-types';
import { formUserKeys } from './forms-users';
import { SettingsTab } from './settings-tab';

const A = '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d11';
const B = '9d1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e22';
const USERS = [
  { id: A, name: 'Asha Rao', email: 'asha@acme.test' },
  { id: B, name: 'Ben Cole', email: 'ben@acme.test' },
];

const baseDraft = formDefinitionSchema.parse({
  title: 'Contact us',
  steps: [{ id: 's1', blocks: [] }],
});

function detail(published: boolean): FormDetail {
  return {
    id: A,
    name: 'Contact us',
    status: published ? 'published' : 'draft',
    publicKey: 'AbCdEfGhIjKlMnOpQrStUv',
    publishedVersion: published ? 1 : null,
    publishedAt: null,
    hasUnpublishedChanges: false,
    views: 0,
    submissions: 0,
    needsReview: 0,
    lastSubmissionAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    rowVersion: 1,
    draft: baseDraft,
    settings: formLiveSettingsSchema.parse({}),
    share: { hostedUrl: '', embedScriptUrl: '', scriptSnippet: '', iframeSnippet: '' },
  };
}

interface Over {
  draft?: (d: Definition) => Definition;
  live?: Partial<FormLiveSettings>;
  published?: boolean;
  canEdit?: boolean;
}

function render(over: Over = {}, locale: 'en' | 'ar' = 'en'): string {
  const draft = over.draft ? over.draft(baseDraft) : baseDraft;
  const props: BuilderTabProps = {
    form: detail(over.published ?? false),
    draft,
    setDraft: () => undefined,
    // not parsed: the tests feed rules the contract refuses, to see the screen explain them
    live: { ...formLiveSettingsSchema.parse({}), ...over.live },
    patchLive: () => undefined,
    name: 'Contact us',
    setName: () => undefined,
    canEdit: over.canEdit ?? true,
    properties: [],
    onFormChange: () => undefined,
    busy: false,
  };
  return renderAccount(
    <ToastProvider>
      <SettingsTab {...props} />
    </ToastProvider>,
    { locale, seed: [[formUserKeys.members, USERS]] },
  );
}

describe('Settings tab: structure', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`renders every section with real messages in ${locale}`, () => {
      const html = render({}, locale);
      const headings = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1]);
      expect(headings).toHaveLength(6);
      expect(html).toContain(locale === 'en' ? 'After submit' : 'بعد الإرسال');
      expect(html).toContain(locale === 'en' ? 'Advanced: rate limits' : 'متقدم: حدود المعدل');
    });
  }

  it('ties every control to a visible label and uses logical classes only', () => {
    const html = render({ draft: (d) => ({ ...d, consent: { ...d.consent, enabled: true } }) });
    for (const m of html.matchAll(
      /<(?:input|select|textarea|button)\b[^>]*\bid="([^"]+)"[^>]*>/g,
    )) {
      if (m[0].includes('aria-label=')) continue;
      expect(html, m[1]).toContain(`for="${m[1]}"`);
    }
    const classes = [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1]!.split(/\s+/));
    expect(
      classes.filter((c) => /^(-?(ml|mr|pl|pr|left|right)-|text-(left|right))/.test(c)),
    ).toEqual([]);
  });

  it('is read only without the right to edit', () => {
    const html = render({ canEdit: false });
    expect(html).toContain('You can view these settings but not change them.');
    const controls = [...html.matchAll(/<(?:input|select|textarea)\b[^>]*>/g)].map((m) => m[0]);
    expect(controls.length).toBeGreaterThan(5);
    for (const c of controls) expect(c, c).toContain('disabled=""');
    expect(html).toMatch(/role="switch"[^>]*disabled=""|disabled=""[^>]*role="switch"/);
  });
});

describe('Settings tab: after submit', () => {
  it('asks for an https address in redirect mode and refuses other schemes', () => {
    const redirect = (url?: string) =>
      render({
        draft: (d) => ({
          ...d,
          settings: { ...d.settings, successMode: 'redirect', redirectUrl: url },
        }),
      });
    expect(redirect()).toContain('Enter the address to send visitors to.');
    expect(redirect('http://example.com')).toContain('Use an address that starts with https://.');
    expect(redirect('https://example.com/thanks')).not.toContain('role="alert"');
    expect(render()).toContain('simple tags are allowed: b, i, u, br, ul, ol, li and a');
  });

  it('keeps the language and direction pair together', () => {
    const html = render({
      draft: (d) => ({ ...d, settings: { ...d.settings, locale: 'ar', dir: 'rtl' } }),
    });
    expect(html).toMatch(/<option value="ar" selected/);
  });
});

describe('Settings tab: consent', () => {
  const withConsent = (c: Partial<Definition['consent']>) => (d: Definition) => ({
    ...d,
    consent: { ...d.consent, ...c },
  });

  it('shows the consent fields only when consent is on', () => {
    expect(render()).not.toContain('Consent text');
    const on = render({ draft: withConsent({ enabled: true }) });
    expect(on).toContain('Consent text');
    expect(on).toContain('Wording version 1');
    expect(on).toContain('An unticked box never subscribes anyone.');
  });

  it('shows the bumped version after the wording of a published form changed', () => {
    const html = render({
      published: true,
      draft: withConsent({ enabled: true, text: 'New wording', version: 2 }),
    });
    expect(html).toContain('Wording version 2');
    expect(html).toContain('starts a new version automatically');
  });

  it('asks for text, and an https privacy link', () => {
    expect(render({ draft: withConsent({ enabled: true, text: ' ' }) })).toContain(
      'Write the consent text, or switch consent off.',
    );
    expect(
      render({ draft: withConsent({ enabled: true, privacyUrl: 'http://a.co/p' }) }),
    ).toContain('Use an address that starts with https://.');
  });

  it('reflects the required and marketing switches', () => {
    const html = render({
      draft: withConsent({ enabled: true, required: false, marketing: true }),
    });
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="Marketing opt-in"/);
    expect(html).toMatch(/aria-checked="false"[^>]*aria-label="Must be ticked to submit"/);
  });
});

describe('Settings tab: in the CRM', () => {
  it('offers the company rules, the stages and the tags already set', () => {
    const html = render({
      draft: (d) => ({
        ...d,
        mapping: { company: { match: 'email_domain' } },
        after: { tags: ['webinar', 'oct'], lifecycleStage: 'qualified' },
      }),
    });
    expect(html).toContain('Links the contact to the company that owns the domain');
    expect(html).toContain('<option value="qualified" selected');
    expect(html.match(/<option value="(new|contacted|lost|enrolled)"/g)).toHaveLength(4);
    expect(html).toContain('aria-label="Remove tag webinar"');
    expect(html).toContain('2 of 10');
  });

  it('checks the owner rule the way the contract does', () => {
    const owner = (mode: FormLiveSettings['ownerRule']['mode'], userIds: string[]) =>
      render({ live: { ownerRule: { mode, userIds } } });
    expect(owner('fixed', [])).toContain('Pick exactly one person.');
    expect(owner('fixed', [A, B])).toContain('Pick exactly one person.');
    expect(owner('fixed', [A])).not.toContain('Pick exactly one person.');
    expect(owner('round_robin', [A])).toContain('Round robin needs at least two people.');
    expect(owner('round_robin', [A, B])).not.toContain('Round robin needs at least two people.');
    expect(owner('unassigned', [A])).toContain('An unassigned rule cannot have people.');
    expect(owner('unassigned', [])).not.toContain('role="alert"');
  });

  it('lists the workspace members for the picker', () => {
    const html = render({ live: { ownerRule: { mode: 'fixed', userIds: [A] } } });
    expect(html).toContain('Asha Rao (asha@acme.test)');
    expect(html).toContain('Ben Cole (ben@acme.test)');
  });
});

describe('Settings tab: notifications and protection', () => {
  it('shows the extra emails and flags a stored address that is not valid', () => {
    const ok = render({
      live: { notify: { owner: true, userIds: [], emails: ['ops@acme.test'] } },
    });
    expect(ok).toContain('aria-label="Remove ops@acme.test"');
    expect(ok).toContain('1 of 5');
    const bad = render({ live: { notify: { owner: true, userIds: [], emails: ['nope'] } } });
    expect(bad).toContain('That is not a valid email address.');
  });

  it('keeps the retention number or switches to keep until deleted', () => {
    const days = render({ live: { retentionDays: 90 } });
    expect(days).toMatch(/<input[^>]*value="90"/);
    expect(days).toContain('GDPR');
    const forever = render({ live: { retentionDays: null } });
    expect(forever).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(forever).toMatch(/<input(?![^>]*type="checkbox")[^>]*disabled=""[^>]*value=""/);
  });

  it('explains the CAPTCHA modes and keeps the rate limits in a collapsed disclosure', () => {
    expect(render()).toContain('Uses whatever your workspace has set for public forms.');
    expect(render({ live: { captchaMode: 'off' } })).toContain(
      'No check. Rely on the hidden trap field',
    );
    const html = render();
    expect(html).toMatch(/<details(?![^>]*\bopen)/);
    expect(html).toContain('value="20"');
    expect(html).toContain('value="120"');
    expect(html).toContain('value="5"');
  });
});
