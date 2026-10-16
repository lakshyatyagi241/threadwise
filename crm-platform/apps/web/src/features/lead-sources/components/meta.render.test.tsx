import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, type MetaLeadPage } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  makeSession,
  renderAccount,
  type Seed,
} from '@/features/auth-registration-security/account/render-test-utils';
import { leadKeys } from '../api';
import { ID, metaForm, metaHealth, metaOverview, metaPage, source } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/lead-sources',
  useSearchParams: () => new URLSearchParams(),
}));

import { AdsTab, LeadSourcesScreen } from './lead-sources-screen';
import { MetaFailure } from './meta-failure';
import { MetaFormPicker } from './meta-form-picker';
import { MetaHealthCard } from './meta-health-card';
import { MetaMappingDialog } from './meta-mapping-dialog';
import { MetaPanel } from './meta-panel';
import { MetaRulesDialog } from './meta-rules-dialog';
import { SourceDetailPage } from './source-detail-page';
import { WebhookTab } from './lead-sources-screen';
import type { MetaLogin } from './use-meta-login';
import { sourceRows } from '../lib/source-view';

/**
 * Static renders of the Meta lead forms card, panel, form picker, dialogs and health card with the real English messages. They
 * prove every state of a Page says what it is and offers only what can work, that the picker lists each form with the right
 * actions, that the dialogs start from the stored source, and that permissions decide what exists. There is no browser: nothing
 * here says how it looks or behaves when clicked (the request each click sends is tested in lib/ and meta-api.test.ts).
 */

const READ = { 'leads.sources.read': 'all' } as const;
const MANAGE = { ...READ, 'leads.sources.manage': 'all' } as const;
const MANAGE_FB = { ...MANAGE, 'fb.pages.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });
const env = { apiPublicUrl: 'https://api.acme.test' };

const login: MetaLogin = {
  run: () => undefined,
  pending: false,
  error: null,
  reset: () => undefined,
};
const panel = (opts: Parameters<typeof renderAccount>[1]) =>
  renderAccount(
    <ToastProvider>
      <MetaPanel />
    </ToastProvider>,
    opts,
  );
const withPages = (...pages: MetaLeadPage[]) => [[leadKeys.meta, metaOverview({ pages })]] as const;

/** The block of the page card for one Page, so a test reads one Page at a time. */
const card = (html: string, pageId: string): string =>
  new RegExp(
    `<div[^>]*data-page="${pageId}"[\\s\\S]*?(?=<div[^>]*data-testid="meta-page"|</section>)`,
  ).exec(html)?.[0] ?? '';

describe('Ads tab: the Meta card', () => {
  const ads = (seed: Parameters<typeof renderAccount>[1] = {}) =>
    renderAccount(
      <ToastProvider>
        <AdsTab can={{ read: true, manage: true }} count={1} onOpenSources={() => undefined} />
      </ToastProvider>,
      { ...as(MANAGE_FB), ...seed },
    );

  it('is a real provider card with an Available badge and a button that opens the panel', () => {
    const html = ads();
    const meta = /<div[^>]*data-testid="provider-meta"[\s\S]*?<\/li>/.exec(html)?.[0] ?? '';
    expect(meta).toContain('Meta lead forms');
    expect(meta).toContain('Available');
    expect(meta).not.toContain('Coming soon');
    expect(meta).not.toContain('data-coming-soon');
    expect(meta).toMatch(
      /<button[^>]*aria-expanded="false"[^>]*data-testid="meta-card-toggle"|<button[^>]*data-testid="meta-card-toggle"[^>]*aria-expanded="false"/,
    );
    expect(meta).toContain('Open Meta lead forms');
    // the panel is not mounted until it is opened
    expect(html).not.toContain('data-testid="meta-panel"');
  });

  it('keeps LinkedIn, TikTok and Google Ads as plain coming-soon cards', () => {
    const html = ads();
    expect(html.match(/data-coming-soon="true"/g)).toHaveLength(3);
    for (const p of ['linkedin', 'tiktok', 'google']) {
      const c =
        new RegExp(`<div[^>]*data-testid="provider-${p}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
      expect(c, p).toContain('Coming soon');
      expect(c, p).not.toMatch(/<button[\s>]|<a[\s>]/);
    }
  });

  it('says what it knows: checking, not set up, no Page, or the counts', () => {
    expect(ads()).toContain('Checking the connection');
    expect(
      ads({ seed: [[leadKeys.meta, metaOverview({ configured: false, pages: [] })]] }),
    ).toContain('Not set up on this install yet');
    expect(ads({ seed: [[leadKeys.meta, metaOverview({ pages: [] })]] })).toContain(
      'No Facebook Page connected yet',
    );
    expect(ads({ seed: [...withPages(metaPage())] })).toContain('1 Page connected, 1 form picked');
    const two = ads({
      seed: [
        ...withPages(
          metaPage({ id: ID(1) }),
          metaPage({ id: ID(2), sync: { state: 'needs_reconnect', formsConnected: 2 } }),
        ),
      ],
    });
    expect(two).toContain('2 Pages connected, 3 forms picked');
    expect(two).toContain('data-testid="meta-card-attention"');
    expect(two).toContain('1 Page needs attention');
  });

  it('is on the Ads tab of the whole screen too', () => {
    const html = renderAccount(<LeadSourcesScreen tab="ads" />, {
      ...as(MANAGE_FB),
      seed: [[leadKeys.list, [source()]]],
    });
    expect(html).toContain('data-testid="provider-meta"');
    expect(html).toContain('data-testid="provider-webhook"');
  });
});

describe('the Meta panel', () => {
  it('says it is loading while the overview is on its way', () => {
    const html = panel(as(MANAGE_FB));
    expect(html).toContain('Loading Meta lead forms');
    expect(html).not.toContain('data-testid="meta-page"');
  });

  describe('when this install has no Meta app', () => {
    const seed = [[leadKeys.meta, metaOverview({ configured: false, pages: [] })]] as const;

    it('shows a manager the callback address, the verify token state and the three setup steps', () => {
      const html = panel({ ...as(MANAGE_FB), seed: [...seed] });
      expect(html).toContain('data-testid="meta-not-configured"');
      expect(html).toContain('Meta is not set up yet');
      expect(html).toContain('https://api.acme.test/v2/public/facebook/webhook');
      expect(html).toContain('Set on this install');
      expect(html).toContain('>Copy URL<');
      expect(html).toContain('paste the callback URL above');
      expect(html).toContain('Facebook settings, then verify and save');
      expect(html).toContain('Subscribe the Page object to the leadgen field.');
      expect(html).toContain('leads_retrieval, pages_manage_ads, pages_read_engagement');
      expect(html).not.toContain('meta-connect');
    });

    it('warns a manager when the install has no verify token', () => {
      const html = panel({
        ...as(MANAGE_FB),
        seed: [
          [
            leadKeys.meta,
            metaOverview({ configured: false, pages: [], verifyTokenConfigured: false }),
          ],
        ],
      });
      expect(html).toContain('>Not set<');
      expect(html).toContain('Meta cannot confirm the callback address');
    });

    it('says the permissions come from the login configuration when it drives the login', () => {
      const html = panel({
        ...as(MANAGE_FB),
        seed: [
          [
            leadKeys.meta,
            metaOverview({ configured: false, pages: [], usesLoginConfiguration: true }),
          ],
        ],
      });
      expect(html).toContain('come from your Meta login configuration');
      expect(html).not.toContain('Permissions asked at login: ');
    });

    it('tells a person who cannot manage only that an administrator must add the app, with no address', () => {
      const html = panel({ ...as(READ), seed: [...seed] });
      expect(html).toContain('Ask a workspace administrator to add it');
      expect(html).not.toContain('api.acme.test');
      expect(html).not.toContain('data-testid="meta-setup"');
      expect(html).not.toContain('Copy URL');
    });
  });

  describe('when no Facebook Page is connected', () => {
    const seed = [[leadKeys.meta, metaOverview({ pages: [] })]] as const;

    it('offers a manager "Connect a Facebook Page"', () => {
      const html = panel({ ...as(MANAGE_FB), seed: [...seed] });
      expect(html).toContain('No Facebook Page connected');
      expect(html).toMatch(
        /<button[^>]*data-testid="meta-connect"(?![^>]*disabled)[^>]*>[^<]*(<[^>]*>)*Connect a Facebook Page/,
      );
    });

    it('disables it, with the reason, for a manager who lacks the Facebook permission', () => {
      const html = panel({ ...as(MANAGE), seed: [...seed] });
      expect(html).toMatch(
        /<button[^>]*disabled=""[^>]*data-testid="meta-connect"|<button[^>]*data-testid="meta-connect"[^>]*disabled=""/,
      );
      expect(html).toContain('fb.pages.manage');
    });

    it('offers a reader no button, only the message', () => {
      const html = panel({ ...as(READ), seed: [...seed] });
      expect(html).toContain('Ask someone who can manage lead sources to connect one');
      expect(html).not.toContain('data-testid="meta-connect"');
    });
  });

  describe('a connected Page', () => {
    it('shows its name, picture, status, lead access, sync state, times, count and ID', () => {
      const html = panel({
        ...as(MANAGE_FB),
        seed: [...withPages(metaPage({ pictureUrl: 'https://cdn.example.test/p.png' }))],
      });
      const c = card(html, '1100220033');
      expect(c).toContain('Acme Studio');
      expect(c).toContain('src="https://cdn.example.test/p.png"');
      expect(c).toContain('data-page-status="connected"');
      expect(c).toContain('data-lead-access="granted"');
      expect(c).toContain('data-sync="subscribed"');
      expect(c).toContain('Receiving leads');
      expect(c).toContain('1100220033');
      expect(c).toContain('<time');
      expect(c).toContain('data-testid="meta-forms-count">1<');
      expect(c).not.toContain('data-testid="meta-last-error"');
    });

    it('falls back to the first letter of the name when it has no picture', () => {
      const html = panel({ ...as(MANAGE_FB), seed: [...withPages(metaPage())] });
      expect(card(html, '1100220033')).not.toContain('<img');
      expect(card(html, '1100220033')).toContain('>A<');
    });

    it('subscribed: offers to turn lead sync off and to choose forms, and no login', () => {
      const c = card(panel({ ...as(MANAGE_FB), seed: [...withPages(metaPage())] }), '1100220033');
      expect(c).toContain('Turn off lead sync');
      expect(c).not.toContain('data-testid="meta-enable"');
      expect(c).not.toContain('data-testid="meta-grant"');
      expect(c).not.toContain('data-testid="meta-reconnect"');
      expect(c).toMatch(/<button[^>]*data-testid="meta-choose-forms"(?![^>]*disabled)/);
      expect(c).toContain('aria-expanded="false"');
      expect(c).toContain('Lead sync is on.');
    });

    it('off: offers to turn lead sync on and holds back the forms until then, saying so', () => {
      const c = card(
        panel({
          ...as(MANAGE_FB),
          seed: [
            ...withPages(
              metaPage({
                sync: { enabled: false, state: 'off', subscribedAt: null, formsConnected: 0 },
              }),
            ),
          ],
        }),
        '1100220033',
      );
      expect(c).toContain('data-sync="off"');
      expect(c).toContain('Lead sync off');
      expect(c).toMatch(/<button[^>]*data-testid="meta-enable"(?![^>]*disabled)/);
      expect(c).toMatch(
        /<button[^>]*disabled=""[^>]*data-testid="meta-choose-forms"|<button[^>]*data-testid="meta-choose-forms"[^>]*disabled=""/,
      );
      expect(c).toContain('Turn on lead sync to choose forms.');
    });

    it('needs lead access: offers "Grant lead access" and holds back turning on and the forms', () => {
      const c = card(
        panel({
          ...as(MANAGE_FB),
          seed: [
            ...withPages(
              metaPage({
                leadAccess: 'missing',
                missingScopes: ['leads_retrieval'],
                sync: { enabled: false, state: 'off', formsConnected: 0 },
              }),
            ),
          ],
        }),
        '1100220033',
      );
      expect(c).toContain('data-lead-access="missing"');
      expect(c).toContain('Lead access missing');
      expect(c).toMatch(
        /<button[^>]*data-testid="meta-grant"(?![^>]*disabled)[^>]*>(<[^>]*>)*Grant lead access/,
      );
      expect(c).toMatch(
        /<button[^>]*disabled=""[^>]*data-testid="meta-enable"|<button[^>]*data-testid="meta-enable"[^>]*disabled=""/,
      );
      expect(c).toContain('Grant lead access first');
      expect(c).toContain('Grant lead access to choose forms.');
      expect(c).toContain('leads_retrieval');
    });

    it('sync says needs_lead_access: offers "Grant lead access" and explains', () => {
      const c = card(
        panel({
          ...as(MANAGE_FB),
          seed: [...withPages(metaPage({ sync: { state: 'needs_lead_access' } }))],
        }),
        '1100220033',
      );
      expect(c).toContain('data-sync="needs_lead_access"');
      expect(c).toContain('data-testid="meta-grant"');
      expect(c).toContain('connected without the permissions Meta requires');
      // lead sync is on, so it can still be turned off
      expect(c).toContain('Turn off lead sync');
    });

    it('needs reconnect: offers "Reconnect" (not "Grant") and holds back the forms', () => {
      const c = card(
        panel({
          ...as(MANAGE_FB),
          seed: [
            ...withPages(
              metaPage({
                pageStatus: 'expired',
                leadAccess: 'missing',
                sync: { state: 'needs_reconnect' },
              }),
            ),
          ],
        }),
        '1100220033',
      );
      expect(c).toContain('data-sync="needs_reconnect"');
      expect(c).toContain('data-page-status="expired"');
      expect(c).toMatch(/<button[^>]*data-testid="meta-reconnect"[^>]*>(<[^>]*>)*Reconnect/);
      expect(c).not.toContain('data-testid="meta-grant"');
      expect(c).toContain('Reconnect the Page to choose forms.');
    });

    it('error: shows what Meta last refused, and keeps the forms open', () => {
      const c = card(
        panel({
          ...as(MANAGE_FB),
          seed: [
            ...withPages(
              metaPage({ sync: { state: 'error', lastError: 'Meta timed out reading the forms' } }),
            ),
          ],
        }),
        '1100220033',
      );
      expect(c).toContain('data-sync="error"');
      expect(c).toContain('data-testid="meta-last-error"');
      expect(c).toContain('Meta timed out reading the forms');
      expect(c).toMatch(/<button[^>]*data-testid="meta-choose-forms"(?![^>]*disabled)/);
    });

    it('a manager without the Facebook permission sees the login disabled, with the reason', () => {
      const c = card(
        panel({
          ...as(MANAGE),
          seed: [...withPages(metaPage({ sync: { state: 'needs_lead_access' } }))],
        }),
        '1100220033',
      );
      expect(c).toMatch(
        /<button[^>]*disabled=""[^>]*data-testid="meta-grant"|<button[^>]*data-testid="meta-grant"[^>]*disabled=""/,
      );
      expect(c).toContain('also needs the permission fb.pages.manage');
    });

    it('a reader sees the state but no action, and which permission changing needs', () => {
      const c = card(panel({ ...as(READ), seed: [...withPages(metaPage())] }), '1100220033');
      expect(c).toContain('Receiving leads');
      for (const id of [
        'meta-enable',
        'meta-disable',
        'meta-grant',
        'meta-reconnect',
        'meta-choose-forms',
      ]) {
        expect(c, id).not.toContain(`data-testid="${id}"`);
      }
      expect(c).toContain('leads.sources.manage');
    });

    it('asks before turning lead sync off', () => {
      const c = card(panel({ ...as(MANAGE_FB), seed: [...withPages(metaPage())] }), '1100220033');
      expect(c).toContain('Turn off lead sync for Acme Studio?');
      expect(c).toContain('The forms you picked and the leads already stored are kept');
    });

    it('lists several Pages, each with its own card', () => {
      const html = panel({
        ...as(MANAGE_FB),
        seed: [
          ...withPages(
            metaPage({ id: ID(1), pageId: '111111', name: 'First' }),
            metaPage({ id: ID(2), pageId: '222222', name: 'Second' }),
          ),
        ],
      });
      expect(html.match(/data-testid="meta-page"/g)).toHaveLength(2);
      expect(html).toContain('Connect another Page');
      // a configured install keeps the webhook settings as a collapsed reminder
      expect(html).toContain('<details');
    });
  });
});

describe('failures', () => {
  const fail = (code: string, message = 'text that must never be shown as the headline') =>
    renderAccount(
      <MetaFailure
        error={new ApiError(422, code, message, 'req-7')}
        login={login}
        onRetry={() => undefined}
      />,
      as(MANAGE_FB),
    );

  it('lead access missing offers "Grant lead access" and no retry', () => {
    const html = fail(ERROR_CODES.MLA_LEAD_ACCESS_MISSING);
    expect(html).toContain('does not have the permissions Meta requires to read leads');
    expect(html).toContain('>Grant lead access<');
    expect(html).not.toContain('Try again');
  });

  it('a Page that needs reconnecting offers "Reconnect" and no retry', () => {
    const html = fail(ERROR_CODES.MLA_PAGE_RECONNECT);
    expect(html).toContain('no longer accepts');
    expect(html).toContain('>Reconnect<');
    expect(html).not.toContain('Try again');
  });

  it('forms unavailable offers a retry and quotes Meta, labelled as Meta words', () => {
    const html = fail(ERROR_CODES.MLA_FORMS_UNAVAILABLE, 'Meta is busy');
    expect(html).toContain('Meta did not return the lead forms');
    expect(html).toContain('Meta said:');
    expect(html).toContain('Meta is busy');
    expect(html).toContain('Try again');
    expect(html).toContain('req-7');
  });

  it('subscribe failed explains what to check and quotes Meta', () => {
    const html = fail(ERROR_CODES.MLA_SUBSCRIBE_FAILED, 'Permission denied by Meta');
    expect(html).toContain('did not turn on lead delivery');
    expect(html).toContain('Permission denied by Meta');
  });

  it('does not quote the server for a code that carries no Meta words', () => {
    const html = fail(ERROR_CODES.MLA_LEAD_ACCESS_MISSING, 'server wording');
    expect(html).not.toContain('server wording');
    expect(html).not.toContain('Meta said:');
  });

  it('not configured, sync off and form not found each have their own words', () => {
    expect(fail(ERROR_CODES.MLA_NOT_CONFIGURED)).toContain(
      'An administrator has to add the Meta app first',
    );
    expect(fail(ERROR_CODES.MLA_SYNC_OFF)).toContain(
      'Turn on lead sync for this Page before choosing forms',
    );
    expect(fail(ERROR_CODES.MLA_FORM_NOT_FOUND)).toContain('no longer one of this Page');
  });

  it('a plan without the feature is explained with a way to upgrade, not as a generic error', () => {
    const html = fail(ERROR_CODES.PLAN_FEATURE_LOCKED);
    expect(html).toContain('data-kind="locked"');
    expect(html).toContain('Social leads and the extra channels feature');
    expect(html).toContain('Upgrade plan');
  });

  it('the plan limit of lead sources is shown when a pick is refused for it', () => {
    expect(fail(ERROR_CODES.PLAN_LIMIT_REACHED)).toContain('limit on lead sources is reached');
  });

  it('hides the login buttons from a person who may not start the login', () => {
    const html = renderAccount(
      <MetaFailure
        error={new ApiError(422, ERROR_CODES.MLA_LEAD_ACCESS_MISSING, 'x')}
        login={login}
        canLogin={false}
      />,
      as(MANAGE),
    );
    expect(html).not.toContain('>Grant lead access<');
  });

  it('an unknown failure still gets words and a retry', () => {
    const html = renderAccount(
      <MetaFailure error={new Error('boom')} onRetry={() => undefined} />,
      as(MANAGE),
    );
    expect(html).toContain('could not reach the server');
    expect(html).toContain('Try again');
  });
});

describe('the form picker', () => {
  const forms = [
    metaForm({ formId: '10001', name: 'Spring offer', leadsCount: 42 }),
    metaForm({
      formId: '10002',
      name: 'Webinar signup',
      status: 'ARCHIVED',
      leadsCount: null,
      hasConsentCheckbox: true,
      connected: true,
      sourceId: ID(77),
      lastLeadAt: '2026-10-03T09:30:00.000Z',
      lastError: 'Meta rate limit',
    }),
  ];
  const picker = (seed: Seed) =>
    renderAccount(
      <ToastProvider>
        <MetaFormPicker page={metaPage()} login={login} canLogin />
      </ToastProvider>,
      { ...as(MANAGE_FB), seed },
    );
  const seeded = [[leadKeys.metaForms(ID(500)), { page: metaPage(), data: forms }]] as const;

  it('loads, and says so, while Meta is being asked', () => {
    const html = picker([]);
    expect(html).toContain('Loading lead forms from Meta');
    expect(html).not.toContain('data-testid="meta-form-row"');
  });

  it('lists each form with its Meta status, leads, questions, consent, connection, last lead and last error', () => {
    const html = picker([...seeded]);
    expect(html.match(/data-testid="meta-form-row"/g)).toHaveLength(2);
    for (const col of [
      'Form',
      'Meta status',
      'Leads',
      'Questions',
      'Consent checkbox',
      'Connected',
      'Last lead',
      'Last error',
      'Actions',
    ]) {
      expect(html, col).toContain(`>${col}</th>`);
    }
    expect(html).toContain('Spring offer');
    expect(html).toContain('Webinar signup');
    expect(html).toContain('>Active<');
    expect(html).toContain('>Archived<');
    expect(html).toContain('>42<');
    expect(html).toContain('Not reported by Meta');
    expect(html).toContain('Has a consent checkbox');
    expect(html).toContain('Meta rate limit');
    expect(html).toContain('Not picked');
  });

  it('shows the picked form first, then the rest', () => {
    const html = picker([...seeded]);
    expect(html.indexOf('Webinar signup')).toBeLessThan(html.indexOf('Spring offer'));
  });

  it('offers Pick on a form that is not picked, and nothing else for it', () => {
    const html = picker([...seeded]);
    const row = /<tr[^>]*data-form="10001"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? '';
    expect(row).toContain('aria-label="Pick Spring offer"');
    for (const other of ['Map fields', 'Assignment and deal', 'Open source', 'Stop']) {
      expect(row, other).not.toContain(`>${other}<`);
    }
  });

  it('offers Map fields, Assignment and deal, Open source and Stop on a picked form', () => {
    const html = picker([...seeded]);
    const row = /<tr[^>]*data-form="10002"[\s\S]*?<\/tr>/.exec(html)?.[0] ?? '';
    expect(row).toContain('>Map fields<');
    expect(row).toContain('>Assignment and deal<');
    expect(row).toContain('>Open source<');
    expect(row).toContain(`href="/lead-sources/${ID(77)}"`);
    expect(row).toContain('>Stop<');
    expect(row).not.toContain('>Pick<');
    expect(row).toContain('<time');
  });

  it('keeps the table inside a scrolling wrapper so the page does not scroll sideways', () => {
    expect(picker([...seeded])).toContain(
      'class="overflow-x-auto rounded-md border border-border"',
    );
  });

  it('says a Page without lead forms has none yet', () => {
    const html = picker([[leadKeys.metaForms(ID(500)), { page: metaPage(), data: [] }]]);
    expect(html).toContain('No lead forms');
    expect(html).toContain('This Page has no lead forms yet');
    expect(html).not.toContain('<table');
  });

  it('asks before stopping a form and says what goes and what stays', () => {
    const html = picker([...seeded]);
    expect(html).toContain(
      'The lead source for this form and the leads stored under it are deleted',
    );
    expect(html).toContain('Contacts already created from them stay');
  });
});

describe('the Map fields dialog', () => {
  const picked = metaForm({ connected: true, sourceId: ID(77) });
  const stored = source({
    id: ID(77),
    kind: 'meta_lead_ads',
    rowVersion: 5,
    mapping: { name: 'full_name', attribution: { campaign: 'meta_campaign_id' } },
  });
  const dialog = (form: typeof picked | null, seed: Seed) =>
    renderAccount(
      <ToastProvider>
        <MetaMappingDialog form={form} onClose={() => undefined} />
      </ToastProvider>,
      { ...as(MANAGE_FB), seed },
    );
  const props = [[leadKeys.properties, [{ key: 'budget', label: 'Budget' }]]] as const;

  it('mounts nothing (and asks for nothing) while no form is chosen', () => {
    const html = dialog(null, []);
    expect(html).not.toContain('data-testid="meta-mapping-rows"');
    expect(html).not.toContain('Loading the lead source');
  });

  it('says it is loading while the source is on its way', () => {
    expect(dialog(picked, [])).toContain('Loading the lead source');
  });

  it('lists every question with its label, Meta type and key, and a select with fields and properties', () => {
    const html = dialog(picked, [[leadKeys.one(ID(77)), stored], ...props]);
    expect(html).toContain('Map fields: Spring offer');
    expect(html.match(/<li class="grid/g)).toHaveLength(4);
    for (const text of [
      'Full name',
      'FULL_NAME',
      'full_name',
      'What is your budget?',
      'CUSTOM',
      'what_is_your_budget',
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html.match(/Automatic \(not mapped here\)/g)).toHaveLength(4);
    for (const label of ['Full name', 'First name', 'Last name', 'Email', 'Phone']) {
      expect(html, label).toContain(`>${label}</option>`);
    }
    expect(html).toContain('<optgroup label="Contact properties">');
    expect(html).toContain('Budget (budget)');
  });

  it('starts from the stored mapping: the question the mapping points at is selected', () => {
    const html = dialog(picked, [[leadKeys.one(ID(77)), stored], ...props]);
    expect(html).toContain('<option value="name" selected="">Full name</option>');
    expect(html).not.toContain('data-testid="meta-mapping-suggested"');
  });

  it('starts from the suggestion of each question when the source has no mapping for the form yet', () => {
    const fresh = source({ id: ID(77), kind: 'meta_lead_ads', mapping: {} });
    const html = dialog(picked, [[leadKeys.one(ID(77)), fresh], ...props]);
    expect(html).toContain('data-testid="meta-mapping-suggested"');
    expect(html).toContain('<option value="name" selected="">Full name</option>');
    expect(html).toContain('<option value="email" selected="">Email</option>');
    expect(html).toContain('<option value="phone" selected="">Phone</option>');
  });

  it('offers a property that is mapped but no longer in the list, so the choice is not lost', () => {
    const odd = source({
      id: ID(77),
      kind: 'meta_lead_ads',
      mapping: { customFields: { old_property: 'what_is_your_budget' } },
    });
    const html = dialog(picked, [[leadKeys.one(ID(77)), odd], ...props]);
    expect(html).toContain(
      '<option value="property:old_property" selected="">old_property</option>',
    );
  });

  it('has a Save button that waits for a change, and a Cancel', () => {
    const html = dialog(picked, [[leadKeys.one(ID(77)), stored], ...props]);
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""[^>]*>[^<]*Save mapping|<button[^>]*disabled=""[^>]*type="submit"[^>]*>[^<]*Save mapping/,
    );
    expect(html).toContain('>Cancel<');
  });

  it('notes a question the stored mapping used for several fields', () => {
    const twice = source({
      id: ID(77),
      kind: 'meta_lead_ads',
      mapping: { email: 'email', customFields: { contact_email: 'email' } },
    });
    const html = dialog(picked, [[leadKeys.one(ID(77)), twice], ...props]);
    expect(html).toContain('used the same question for more than one field (email)');
  });

  it('says so when the form has no source id', () => {
    expect(dialog(metaForm({ sourceId: null }), [])).toContain('lead source could not be found');
  });
});

describe('the Assignment and deal dialog', () => {
  const picked = metaForm({ connected: true, sourceId: ID(77) });
  const stored = source({ id: ID(77), kind: 'meta_lead_ads', rowVersion: 2 });
  const dialog = (seed: Seed) =>
    renderAccount(
      <ToastProvider>
        <MetaRulesDialog form={picked} onClose={() => undefined} />
      </ToastProvider>,
      { ...as(MANAGE_FB), seed },
    );

  it('shows the owner, deal and notification rules of the form source', () => {
    const html = dialog([
      [leadKeys.one(ID(77)), stored],
      [leadKeys.members, []],
      [leadKeys.pipelines, []],
      [leadKeys.stages, []],
    ]);
    expect(html).toContain('Assignment and deal: Spring offer');
    expect(html).toContain('id="ls-owner-mode"');
    expect(html).toContain('id="ls-deal-on"');
    expect(html).toContain('id="ls-notify-owner"');
    // only the rules: no name, secret or mapping inputs
    expect(html).not.toContain('id="ls-name"');
    expect(html).not.toContain('id="ls-secret"');
    expect(html).not.toContain('id="ls-map-name"');
    expect(html).toMatch(
      /<button[^>]*type="submit"[^>]*disabled=""|<button[^>]*disabled=""[^>]*type="submit"/,
    );
  });

  it('says it is loading while the source is on its way', () => {
    expect(dialog([])).toContain('Loading the lead source');
  });
});

describe('the health card of a form source', () => {
  const health = (data: unknown, opts: Parameters<typeof renderAccount>[1] = as(MANAGE)) =>
    renderAccount(<MetaHealthCard sourceId={ID(77)} enabled />, {
      ...opts,
      seed: data === undefined ? [] : [[leadKeys.metaHealth(ID(77)), data]],
    });

  it('shows the Page, the form, the state, lead access, last lead and a link to the Ads tab', () => {
    const html = health(metaHealth());
    expect(html).toContain('Meta lead form health');
    expect(html).toContain('Acme Studio');
    expect(html).toContain('Spring offer');
    expect(html).toContain('data-sync="subscribed"');
    expect(html).toContain('data-lead-access="granted"');
    expect(html).toContain('<time');
    expect(html).toContain('href="/lead-sources?tab=ads"');
    expect(html).not.toContain('data-testid="meta-health-error"');
    expect(html).not.toContain('To fix this');
  });

  it('shows the last error and what to do when Meta is not delivering', () => {
    const html = health(
      metaHealth({
        state: 'needs_lead_access',
        leadAccess: 'missing',
        lastError: 'The Page lacks a lead permission',
        lastLeadAt: null,
      }),
    );
    expect(html).toContain('data-sync="needs_lead_access"');
    expect(html).toContain('data-testid="meta-health-error"');
    expect(html).toContain('The Page lacks a lead permission');
    expect(html).toContain('No leads yet');
    expect(html).toContain('To fix this, open the Ads tab');
  });

  it('says a source that is no longer a Meta form has nothing to check', () => {
    const html = health(
      metaHealth({
        connected: false,
        pageName: null,
        formName: null,
        state: null,
        leadAccess: null,
      }),
    );
    expect(html).toContain('data-testid="meta-health-disconnected"');
    expect(html).toContain('no longer linked to a Meta lead form');
    expect(html).toContain('href="/lead-sources?tab=ads"');
  });

  it('says it is checking while the answer is on its way', () => {
    expect(health(undefined)).toContain('Checking the form');
  });
});

describe('the page of a Meta form source', () => {
  const meta = source({
    id: ID(77),
    kind: 'meta_lead_ads',
    name: 'Acme Studio - Spring offer',
    tokenHint: null,
    hasSecret: false,
    externalIdPath: null,
    needsAttention: 0,
  });
  const detail = (opts: Parameters<typeof renderAccount>[1]) =>
    renderAccount(
      <ToastProvider>
        <SourceDetailPage id={ID(77)} hookEnv={env} />
      </ToastProvider>,
      opts,
    );
  const seed = [
    [leadKeys.one(ID(77)), meta],
    [
      leadKeys.events(ID(77), 'all', 'all'),
      {
        pages: [{ data: [], page: { nextCursor: null, hasMore: false, limit: 25 } }],
        pageParams: [undefined],
      },
    ],
    [leadKeys.metaHealth(ID(77)), metaHealth()],
  ] as const;

  it('says leads arrive from Meta, shows the health card and offers no URL, token, secret or rotate', () => {
    const html = detail({ ...as(MANAGE), seed: [...seed] });
    expect(html).toContain('Acme Studio - Spring offer');
    expect(html).toContain('data-testid="meta-note"');
    expect(html).toContain('Leads arrive from Meta.');
    expect(html).toContain('data-testid="meta-health-card"');
    expect(html).toContain('>Meta lead forms<');
    expect(html).not.toContain('data-testid="connector-note"');
    expect(html).not.toContain('Connected through the Marketplace');
    expect(html).not.toContain('The URL token ends in');
    expect(html).not.toContain('>Rotate token<');
    expect(html).not.toContain('id="ls-external-id"');
    expect(html).not.toContain('ls-secret-label');
    expect(html).not.toContain('The full URL was shown once');
  });

  it('is ended with Stop on the Ads tab, so it offers no Delete, but still Pause', () => {
    const html = detail({ ...as(MANAGE), seed: [...seed] });
    expect(html).not.toContain('>Delete<');
    expect(html).not.toContain('Delete source');
    expect(html).toContain('>Pause<');
  });

  it('asks the health of the form only when the person can read lead sources', () => {
    const html = renderAccount(<MetaHealthCard sourceId={ID(77)} enabled={false} />, as({}));
    expect(html).toContain('Checking the form');
  });
});

describe('the sources list', () => {
  it('shows a Meta form source with its kind and that its leads come from Meta', () => {
    const meta = source({
      id: ID(77),
      kind: 'meta_lead_ads',
      name: 'Acme Studio - Spring offer',
      tokenHint: null,
    });
    const html = renderAccount(
      <WebhookTab can={{ read: true, manage: true }} rows={sourceRows([meta, source()])} />,
      as(MANAGE),
    );
    expect(html).toContain('Acme Studio - Spring offer');
    expect(html).toContain('>Meta lead forms<');
    expect(html).toContain('From Meta');
    expect(html).toContain('Ends in x9Qk');
    expect(html).not.toContain('Through the Marketplace');
  });
});
