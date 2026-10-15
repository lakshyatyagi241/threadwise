import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { mktKeys } from '../api';
import { scopeChanges } from '../lib/consent';
import { mktError } from '../lib/errors';
import { startReveal, setSaved, dismiss } from '../lib/secret-reveal';
import { INSTALL, MANAGE, READ, renderMarket } from '../render-test-utils';
import { HOOK_URL, ID, SECRET, URL_KEY, detail, scopes } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/marketplace/app/webhook',
}));

import { AppDetail, AppDetailPage } from './app-detail-page';
import { ChangedNotice, DoneStep, FailureView, GapsNotice, InstallFlow } from './install-page';
import { SecretReveal } from './secret-reveal';

/**
 * Static renders with the real English and Arabic messages. They prove the text is complete (a missing or broken message throws),
 * that permissions and plan locks decide what is offered, and that the one-time secret is on the page only while it is shown.
 * There is no browser here: nothing below says how the screens look or behave when clicked.
 */
const LOCALES = ['en', 'ar'] as const;
const ALL_RECORDS = [
  'record.contacts.read',
  'record.contacts.create',
  'record.contacts.update',
  'inbox.conversation.reply',
];

describe('app detail', () => {
  for (const locale of LOCALES) {
    it(`renders the listing, permissions with risk, pricing, support and the install button in ${locale}`, () => {
      const html = renderMarket(<AppDetail app={detail()} />, { locale });
      expect(html).toContain('data-testid="app-detail"');
      expect(html).toContain('Receive leads from any tool');
      expect(html).toContain('First paragraph of the long text.');
      expect(html).toContain('Second paragraph after a blank line.');
      expect(html).toContain('Works with any sender');
      expect(html).toContain('data-testid="scope-messages.send"');
      expect(html).toContain('data-testid="risk-callout"');
      expect(html).toContain('href="/marketplace/app/webhook/install"');
      expect(html).toContain('Acme Labs');
      expect(html).toContain('Portal key');
      expect(html).toContain('Stores the lead fields you send.');
      expect(html).toContain('India');
    });
  }

  it('lists the permissions riskiest first, each with a risk chip, and leads with the overall risk', () => {
    const html = renderMarket(<AppDetail app={detail()} />);
    const high = html.indexOf('Send messages');
    const medium = html.indexOf('Add leads');
    const low = html.indexOf('Read contacts');
    expect(high).toBeGreaterThan(-1);
    expect(high).toBeLessThan(medium);
    expect(medium).toBeLessThan(low);
    expect(html).toContain('High risk');
    expect(html).toContain('Medium risk');
    expect(html).toContain('Low risk');
    expect(html).toContain('High risk overall');
    expect(html).toContain('1 high, 1 medium, 1 low');
  });

  it('says an app with no permissions asks for none, and draws no risk callout', () => {
    const html = renderMarket(<AppDetail app={detail({ scopes: [] })} />);
    expect(html).toContain('This app asks for no permissions.');
    expect(html).not.toContain('risk-callout');
  });

  it('shows screenshots only for https images, with captions, lazy loading and alt text', () => {
    const html = renderMarket(<AppDetail app={detail()} />);
    expect(html).toContain('src="https://img.example.test/one.png"');
    expect(html).toContain('alt="The setup screen"');
    expect(html).toContain('loading="lazy"');
    expect(html).not.toContain('insecure.example.test');
    const none = renderMarket(
      <AppDetail app={detail({ listing: { ...detail().listing, screenshots: [] } })} />,
    );
    expect(none).not.toContain('Screenshots');
  });

  it('opens other sites in a new tab without a referrer, and only if they are https', () => {
    const html = renderMarket(
      <AppDetail
        app={detail({
          support: {
            website: 'https://example.test/webhook',
            privacy: 'javascript:alert(1)' as never,
          },
        })}
      />,
    );
    expect(html).toMatch(
      /href="https:\/\/example.test\/webhook"[^>]*target="_blank"[^>]*rel="noopener noreferrer"|rel="noopener noreferrer"[^>]*target="_blank"[^>]*href="https:\/\/example.test\/webhook"|target="_blank"[^>]*rel="noopener noreferrer"[^>]*href="https:\/\/example.test\/webhook"|href="https:\/\/example.test\/webhook"[^>]*rel="noopener noreferrer"[^>]*target="_blank"/,
    );
    expect(html).not.toContain('javascript:');
  });

  it('prints listing text as text, never as markup', () => {
    const html = renderMarket(
      <AppDetail
        app={detail({
          description: '<script>alert(1)</script>',
          listing: {
            ...detail().listing,
            longDescription: '<img src=x onerror=alert(1)>\n\n<b>bold</b>',
          },
        })}
      />,
    );
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold');
    expect(html).toContain('&lt;script&gt;');
  });

  it('draws the changelog (five at most) and the setup notes of an integration', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      version: `1.0.${i}`,
      notes: `Notes ${i}`,
      publishedAt: '2026-10-01T00:00:00.000Z',
    }));
    const html = renderMarket(<AppDetail app={detail({ changelog: many })} />);
    expect(html).toContain('Version 1.0.4');
    expect(html).not.toContain('Version 1.0.5');
    expect(html).toContain('Copy the key');
    expect(html).toContain('send a sample lead');
  });

  it('offers the install only to someone who holds market.apps.install, and names the key otherwise', () => {
    const can = renderMarket(<AppDetail app={detail()} />, { permissions: [READ, INSTALL] });
    expect(can).toContain('/marketplace/app/webhook/install');
    const cannot = renderMarket(<AppDetail app={detail()} />, { permissions: [READ] });
    expect(cannot).not.toContain('/install"');
    expect(cannot).toContain('market.apps.install');
    expect(cannot).toMatch(/<button[^>]*\sdisabled=""/);
  });

  it('shows a locked app with the lock, an upgrade link and no install link', () => {
    const html = renderMarket(
      <AppDetail
        app={detail({
          locked: { reason: 'plan_feature', key: 'analytics', upgradeUrl: '/account/plans' },
        })}
      />,
    );
    expect(html).toContain('Not in your plan');
    expect(html).toContain('href="/account/plans"');
    expect(html).not.toContain('/install"');
  });

  it('shows manage for an installed app and the platform stop for a killed one', () => {
    const install = {
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
    };
    const active = renderMarket(<AppDetail app={detail({ install })} />);
    expect(active).toContain(`href="/marketplace/installed/${ID(50)}"`);
    expect(active).not.toContain('/install"');
    const killed = renderMarket(
      <AppDetail app={detail({ install: { ...install, status: 'killed' } })} />,
    );
    expect(killed).toContain('The platform stopped this app.');
  });

  it('shows a loading state while the app loads, and the page once it is cached', () => {
    expect(renderMarket(<AppDetailPage slug="webhook" />)).toContain('aria-label="Loading"');
    const html = renderMarket(<AppDetailPage slug="webhook" />, {
      seed: [[mktKeys.app('webhook'), detail()]],
    });
    expect(html).toContain('data-testid="app-detail"');
  });
});

describe('install flow, step 1: permissions and consent', () => {
  for (const locale of LOCALES) {
    it(`shows the permissions to be granted, with risk, and an unchecked consent in ${locale}`, () => {
      const html = renderMarket(<InstallFlow app={detail()} />, {
        locale,
        permissions: [READ, INSTALL, ...ALL_RECORDS],
      });
      expect(html).toContain('data-testid="install-flow"');
      expect(html).toContain('data-testid="scope-leads.write"');
      expect(html).toContain('data-testid="scope-messages.send"');
      expect(html).toContain('id="mkt-consent"');
      expect(html).not.toMatch(/id="mkt-consent"[^>]*checked/);
      expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:<[^>]*>)*[^<]*(?:Continue|متابعة)/);
    });
  }

  it('words the single consent and shows the three steps for an integration with a setup form', () => {
    const html = renderMarket(<InstallFlow app={detail()} />, {
      permissions: [READ, INSTALL, ...ALL_RECORDS],
    });
    expect(html).toContain(
      'I understand and allow this app to use these permissions in my workspace.',
    );
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Set up');
    expect(html).toContain('Continue');
  });

  it('installs straight from the permissions step when there is nothing to set up', () => {
    const html = renderMarket(<InstallFlow app={detail({ setup: null })} />, {
      permissions: [READ, INSTALL, ...ALL_RECORDS],
    });
    expect(html).not.toContain('Continue');
    expect(html).toMatch(/>(?:<[^>]*>)*Install<\/button>/);
    expect(html).not.toContain('>Set up<');
  });

  it('warns, without blocking, about permission keys the person does not hold', () => {
    const lacking = renderMarket(<InstallFlow app={detail()} />, { permissions: [READ, INSTALL] });
    expect(lacking).toContain('data-testid="installer-gaps"');
    expect(lacking).toContain('inbox.conversation.reply');
    const holding = renderMarket(<InstallFlow app={detail()} />, {
      permissions: [READ, INSTALL, ...ALL_RECORDS],
    });
    expect(holding).not.toContain('installer-gaps');
  });

  it('refuses the flow for someone without market.apps.install, an installed app, and a locked one', () => {
    const noPerm = renderMarket(<InstallFlow app={detail()} />, { permissions: [READ] });
    expect(noPerm).toContain('market.apps.install');
    expect(noPerm).not.toContain('id="mkt-consent"');
    const install = {
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
    };
    const installed = renderMarket(<InstallFlow app={detail({ install })} />);
    expect(installed).toContain('already installed');
    expect(installed).toContain(`/marketplace/installed/${ID(50)}`);
    const locked = renderMarket(
      <InstallFlow
        app={detail({ locked: { reason: 'limit_reached', key: null, upgradeUrl: null } })}
      />,
    );
    expect(locked).toContain('Plan limit reached');
    expect(locked).not.toContain('id="mkt-consent"');
  });

  it('highlights what changed when the permissions moved under the person', () => {
    const before = scopes('contacts.read');
    const after = scopes('contacts.read', 'messages.send');
    const diff = scopeChanges(before, after);
    const html = renderMarket(<ChangedNotice changes={{ diff, removed: [] }} />);
    expect(html).toContain('data-testid="consent-changed"');
    expect(html).toContain('The permissions changed while you were looking');
    expect(html).toContain('Nothing was installed.');
    expect(html).toContain('Send messages');
    const removed = renderMarket(
      <ChangedNotice
        changes={{ diff: scopeChanges(after, before), removed: scopes('messages.send') }}
      />,
    );
    expect(removed).toContain('No longer asks for:');
    for (const locale of LOCALES) {
      renderMarket(<ChangedNotice changes={{ diff, removed: [] }} />, { locale });
    }
  });

  it('names the permission keys that cannot be granted', () => {
    const e = new ApiError(403, 'MKT_SCOPE_EXCEEDS_INSTALLER', 'x', 'req-9', [
      { path: 'permission', message: 'inbox.conversation.reply' },
    ]);
    const html = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />);
    expect(html).toContain('inbox.conversation.reply');
    expect(html).not.toContain('req-9');
    expect(renderMarket(<GapsNotice keys={['a.b']} />)).toContain('a.b');
  });

  it('answers an install that hit a cap by saying nothing was installed and pointing at the upgrade', () => {
    const e = new ApiError(422, 'PLAN_LIMIT_REACHED', 'x', 'req-3', [
      { path: 'limit', message: 'lead_sources' },
      { path: 'upgradeUrl', message: '/account/plans' },
    ]);
    for (const locale of LOCALES) {
      const html = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />, {
        locale,
      });
      expect(html).toContain('href="/account/plans"');
    }
    expect(renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />)).toContain(
      'nothing was installed',
    );
  });

  it('links an already-installed answer to the existing installation', () => {
    const e = new ApiError(409, 'MKT_ALREADY_INSTALLED', 'x', 'r');
    const html = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={ID(50)} />);
    expect(html).toContain(`/marketplace/installed/${ID(50)}`);
  });

  it('marks fields from a credential problem and a lead-pipeline outage as retryable text', () => {
    const e = new ApiError(503, 'MKT_LEAD_PIPELINE_UNAVAILABLE', 'x', 'r');
    const html = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />);
    expect(html).toContain('Nothing was saved');
  });
});

describe('install flow, the one-time secret', () => {
  const payload = {
    secret: SECRET,
    url: HOOK_URL,
    tokenHeader: 'X-Marketplace-Token',
    signatureHeader: 'X-Marketplace-Signature',
    auth: 'either' as const,
  };
  const done = { installationId: ID(50), version: '1.0.0' };
  const app = detail();

  for (const locale of LOCALES) {
    it(`shows the secret and the address once, with copy buttons and a warning, in ${locale}`, () => {
      const html = renderMarket(
        <DoneStep app={app} done={done} reveal={startReveal(payload)} onReveal={() => undefined} />,
        { locale },
      );
      expect(html).toContain('data-testid="secret-reveal"');
      expect(html).toContain(SECRET);
      expect(html).toContain(URL_KEY);
      expect(html).toContain('X-Marketplace-Token');
      expect(html).toContain('X-Marketplace-Signature');
      expect(html.match(/Copy|نسخ/g)?.length).toBeGreaterThanOrEqual(2);
    });
  }

  it('says in words that the secret will not be shown again, and gates the Done button on the confirmation', () => {
    const html = renderMarket(
      <DoneStep app={app} done={done} reveal={startReveal(payload)} onReveal={() => undefined} />,
    );
    expect(html).toContain('You will not see this secret again.');
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>(?:<[^>]*>)*I have saved it, continue/);
    expect(html).not.toMatch(/id="[^"]*-saved"[^>]*checked/);
    // The links away from the page wait for the confirmation.
    expect(html).not.toContain(`/marketplace/installed/${ID(50)}`);
    const saved = renderMarket(
      <DoneStep
        app={app}
        done={done}
        reveal={setSaved(startReveal(payload), true)}
        onReveal={() => undefined}
      />,
    );
    expect(saved).toMatch(/id="[^"]*-saved"[^>]*checked/);
    expect(saved).not.toMatch(
      /<button[^>]*\sdisabled=""[^>]*>(?:<[^>]*>)*I have saved it, continue/,
    );
  });

  it('after the confirmation the page holds neither the secret nor the address nor its key', () => {
    const dismissed = dismiss(setSaved(startReveal(payload), true));
    const html = renderMarket(
      <DoneStep app={app} done={done} reveal={dismissed} onReveal={() => undefined} />,
    );
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain(URL_KEY);
    expect(html).not.toContain('X-Marketplace-Token');
    expect(html).not.toContain('secret-reveal');
    expect(html).toContain(`/marketplace/installed/${ID(50)}`);
    expect(html).toContain('Webhook is installed');
  });

  it('has no reveal at all when the answer carried no secret', () => {
    const html = renderMarket(
      <DoneStep app={app} done={done} reveal={startReveal(null)} onReveal={() => undefined} />,
    );
    expect(html).not.toContain('secret-reveal');
    expect(html).toContain('Webhook is installed');
    expect(html).toContain(`/marketplace/installed/${ID(50)}`);
  });

  it('draws the reveal only while shown', () => {
    const noop = () => undefined;
    expect(
      renderMarket(<SecretReveal state={{ phase: 'none' }} onState={noop} doneLabel="Done" />),
    ).not.toContain('secret-reveal');
    expect(
      renderMarket(<SecretReveal state={{ phase: 'dismissed' }} onState={noop} doneLabel="Done" />),
    ).not.toContain('secret-reveal');
    expect(
      renderMarket(<SecretReveal state={startReveal(payload)} onState={noop} doneLabel="Done" />),
    ).toContain(SECRET);
  });

  it('keeps the secret out of the rest of the install page: the permissions step never holds it', () => {
    const html = renderMarket(<InstallFlow app={detail()} />, {
      permissions: [READ, INSTALL, MANAGE, ...ALL_RECORDS],
    });
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain(URL_KEY);
  });
});
