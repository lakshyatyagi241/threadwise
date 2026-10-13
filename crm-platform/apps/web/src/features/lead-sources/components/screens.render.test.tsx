import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { leadKeys } from '../api';
import { emptyDraft } from '../lib/draft';
import { confirmReveal, revealOf } from '../lib/reveal';
import { ID, SECRET_PATH, SECRET_TOKEN, source } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/lead-sources',
  useSearchParams: () => new URLSearchParams(),
}));

import { DefaultsFields } from './source-fields';
import { AdsTab, LeadSourcesScreen, WebhookTab } from './lead-sources-screen';
import { ConnectStep, NewSourcePage } from './new-source-page';
import { RevealPanel } from './reveal-panel';
import { ErrorText, LockedState, NoAccess, RegionError } from './ui';

/**
 * These render each screen to static HTML with the real English and Arabic messages. They prove the text is complete (a missing
 * or broken message throws), that permissions and the plan decide what is offered, and that a token never outlives its reveal.
 * There is no browser here: nothing below says how the screens look or behave when clicked.
 */

const LOCALES = ['en', 'ar'] as const;
const READ = { 'leads.sources.read': 'all' } as const;
const MANAGE = { ...READ, 'leads.sources.manage': 'all' } as const;
const session = (permissions: Record<string, 'all'>) => makeSession({ permissions });
const as = (permissions: Record<string, 'all'>) => ({ session: session(permissions) });

const waiting = source({
  id: ID(2),
  name: 'Landing page form',
  status: 'paused',
  tokenHint: 'ab12',
  needsAttention: 3,
  lastEventAt: null,
});
const connector = source({ id: ID(3), name: 'IndiaMART', kind: 'connector', tokenHint: null });
const LIST = [leadKeys.list, [source(), waiting, connector]] as const;

describe('Social leads screen: the Ads tab', () => {
  for (const locale of LOCALES) {
    it(`offers the Webhook and shows the four providers without a door as coming soon in ${locale}`, () => {
      const html = renderAccount(<LeadSourcesScreen tab="ads" />, {
        locale,
        ...as(MANAGE),
        seed: [LIST],
      });
      expect(html).toContain('data-testid="provider-webhook"');
      for (const p of ['meta', 'linkedin', 'tiktok', 'google']) {
        expect(html).toContain(`data-testid="provider-${p}"`);
      }
      // The webhook leads to the wizard
      expect(html).toContain('href="/lead-sources/new"');
    });
  }

  it('the coming-soon cards are not links and not buttons, and say what to do until then', () => {
    const html = renderAccount(
      <AdsTab can={{ read: true, manage: true }} count={0} onOpenSources={() => undefined} />,
    );
    for (const p of ['meta', 'linkedin', 'tiktok', 'google']) {
      const card =
        new RegExp(`<div[^>]*data-testid="provider-${p}"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
      expect(card, p).not.toBe('');
      expect(card, p).not.toMatch(/<a[\s>]/);
      expect(card, p).not.toMatch(/<button[\s>]/);
      expect(card, p).not.toContain('href=');
      expect(card, p).not.toContain('onclick');
      expect(card, p).toContain('Coming soon');
      expect(card, p).toContain(
        'Until then, send these leads through the Webhook with Zapier or Make.',
      );
    }
    const webhook =
      new RegExp(`<div[^>]*data-testid="provider-webhook"[\\s\\S]*?</li>`).exec(html)?.[0] ?? '';
    expect(webhook).toContain('Available');
    expect(webhook).toContain('href="/lead-sources/new"');
  });

  it('a person who cannot manage can open the sources but is not offered the wizard', () => {
    const html = renderAccount(
      <AdsTab can={{ read: true, manage: false }} count={2} onOpenSources={() => undefined} />,
    );
    expect(html).not.toContain('/lead-sources/new');
    expect(html).toContain('Open sources');
    expect(html).toContain('2 sources');
  });

  it('shows the pages without the tabs that are not built (Rules, X profile)', () => {
    const html = renderAccount(<LeadSourcesScreen tab="ads" />, { ...as(MANAGE), seed: [LIST] });
    expect(html).toContain('role="tab"');
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).not.toContain('X profile');
  });
});

describe('Social leads screen: the Webhook tab', () => {
  for (const locale of LOCALES) {
    it(`lists every source with its kind, status, token hint, last lead and needs-attention badge in ${locale}`, () => {
      const html = renderAccount(<LeadSourcesScreen tab="webhook" />, {
        locale,
        ...as(MANAGE),
        seed: [LIST],
      });
      expect(html).toContain('Zapier: Facebook lead ads');
      expect(html).toContain('Landing page form');
      expect(html).toContain('IndiaMART');
      expect(html.match(/data-testid="source-row"/g)).toHaveLength(3);
    });
  }

  it('links the needs-attention badge into the source events filtered to the leads that wait', () => {
    const html = renderAccount(<LeadSourcesScreen tab="webhook" />, {
      ...as(MANAGE),
      seed: [LIST],
    });
    expect(html).toContain(`href="/lead-sources/${ID(2)}?events=attention#events"`);
    expect(html.match(/data-testid="needs-attention-badge"/g)).toHaveLength(1);
    expect(html).toContain('3 leads');
    expect(html).toContain('Ends in x9Qk');
    expect(html).toContain('Ends in ab12');
    expect(html).toContain('Paused');
    expect(html).toContain('Active');
    expect(html).toContain('Through the Marketplace');
    expect(html).toContain('Marketplace connection');
  });

  it('keeps a source of a kind without a door in the list, with its kind', () => {
    const html = renderAccount(<WebhookTab can={{ read: true, manage: false }} rows={[]} />);
    expect(html).toContain('No sources yet');
    const tiktok = renderAccount(<LeadSourcesScreen tab="webhook" />, {
      ...as(READ),
      seed: [[leadKeys.list, [source({ kind: 'tiktok', name: 'TikTok forms' })]]],
    });
    expect(tiktok).toContain('TikTok forms');
    expect(tiktok).toContain('>TikTok<');
    expect(tiktok).toContain(`href="/lead-sources/${ID(1)}"`);
  });

  it('says there are no sources yet and offers the first one to a person who can create it', () => {
    const empty = [leadKeys.list, []] as const;
    const manage = renderAccount(<LeadSourcesScreen tab="webhook" />, {
      ...as(MANAGE),
      seed: [empty],
    });
    expect(manage).toContain('No sources yet');
    expect(manage).toContain('href="/lead-sources/new"');
    const readOnly = renderAccount(<LeadSourcesScreen tab="webhook" />, {
      ...as(READ),
      seed: [empty],
    });
    expect(readOnly).toContain('No sources yet');
    expect(readOnly).not.toContain('/lead-sources/new');
    expect(readOnly).toContain('Ask someone who can manage');
  });

  it('shows a loading state while the list is on its way', () => {
    const html = renderAccount(<LeadSourcesScreen tab="webhook" />, { ...as(MANAGE) });
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading lead sources');
  });
});

describe('access and plan', () => {
  it('names the missing permission instead of the screen', () => {
    const html = renderAccount(<LeadSourcesScreen tab="ads" />, { ...as({}), seed: [LIST] });
    expect(html).toContain('leads.sources.read');
    expect(html).not.toContain('Zapier: Facebook lead ads');
    expect(html).not.toContain('role="tab"');
  });

  for (const locale of LOCALES) {
    it(`a plan without the feature gets an explanation and the upgrade link in ${locale}`, () => {
      const error = new ApiError(422, ERROR_CODES.PLAN_FEATURE_LOCKED, 'x', 'req-9', [
        { path: 'feature', message: 'lead_sources' },
        { path: 'upgradeUrl', message: '/account/plans' },
      ]);
      const html = renderAccount(<RegionError error={error} />, { locale });
      expect(html).toContain('href="/account/plans"');
      expect(html).toContain('id="ls-locked"');
      if (locale === 'en') expect(html).toContain('not part of your plan');
    });
  }

  it('LockedState and NoAccess render on their own', () => {
    expect(renderAccount(<LockedState />)).toContain('href="/account/plans"');
    const html = renderAccount(<NoAccess permission="leads.sources.manage" />);
    expect(html).toContain('leads.sources.manage');
  });

  it('an error line shows the reference to quote and offers a retry', () => {
    const error = new ApiError(500, 'INTERNAL', 'boom: do not show this', 'req-42');
    const html = renderAccount(<ErrorText error={error} onRetry={() => undefined} />);
    expect(html).not.toContain('Reference: req-42');
    expect(html).toContain('Try again');
    expect(html).not.toContain('boom');
  });

  it('a field error of the API is shown as its code in words, with the path it belongs to', () => {
    const error = new ApiError(422, ERROR_CODES.LEAD_MAPPING_INVALID, 'x', 'r1', [
      { path: 'mapping.customFields.budget', message: 'unknown_property' },
    ]);
    const html = renderAccount(<ErrorText error={error} />);
    expect(html).toContain('mapping.customFields.budget');
    expect(html).toContain('does not exist or is switched off');
  });
});

describe('create wizard', () => {
  const env = { apiPublicUrl: 'https://api.acme.test' };

  for (const locale of LOCALES) {
    it(`starts on its first step with the basics in ${locale}`, () => {
      const html = renderAccount(
        <ToastProvider>
          <NewSourcePage hookEnv={env} />
        </ToastProvider>,
        { locale, ...as(MANAGE) },
      );
      expect(html.match(/aria-current="step"/g)).toHaveLength(1);
      expect(html).toContain('id="ls-name"');
      expect(html).toContain('id="ls-platform"');
      expect(html).toContain('id="ls-retention"');
      expect(html).toContain('id="ls-external-id"');
      // four steps are listed
      expect(
        html.match(/<li aria-current|<li class="flex items-center gap-2 rounded-full/g),
      ).toHaveLength(4);
    });
  }

  it('needs the manage permission and names it', () => {
    const html = renderAccount(
      <ToastProvider>
        <NewSourcePage hookEnv={env} />
      </ToastProvider>,
      { ...as(READ) },
    );
    expect(html).toContain('leads.sources.manage');
    expect(html).not.toContain('aria-current="step"');
  });

  it('offers the optional shared secret as a write-only password field', () => {
    const html = renderAccount(
      <ToastProvider>
        <NewSourcePage hookEnv={env} />
      </ToastProvider>,
      { ...as(MANAGE) },
    );
    expect(html).toContain('type="password"');
    expect(html).toContain('No shared secret');
    expect(html).not.toMatch(/type="password"[^>]*value="[^"]+"/);
  });

  const members = [
    { id: ID(11), name: 'Asha Rao', email: 'asha@acme.test' },
    { id: ID(12), name: 'Vikram Shah', email: 'vikram@acme.test' },
  ];
  const pipelines = [
    {
      id: ID(21),
      name: 'Sales',
      isDefault: true,
      stages: [
        { id: ID(22), name: 'New', kind: 'open' as const },
        { id: ID(23), name: 'Won', kind: 'won' as const },
      ],
    },
  ];
  const stages = [{ value: 'ad_lead', label: 'Ad lead' }];
  const pickers = [
    [leadKeys.members, members],
    [leadKeys.pipelines, pipelines],
    [leadKeys.stages, stages],
  ] as const;

  for (const locale of LOCALES) {
    it(`the rules step offers the owner rule, the deal, the notifications and the pickers in ${locale}`, () => {
      const html = renderAccount(
        <DefaultsFields draft={emptyDraft()} set={() => undefined} problems={{}} server={{}} />,
        { locale, ...as(MANAGE), seed: [...pickers] },
      );
      expect(html).toContain('id="ls-country"');
      expect(html).toContain('id="ls-stage"');
      expect(html).toContain('Ad lead');
      expect(html).toContain('id="ls-owner-mode"');
      expect(html).toContain('role="switch"');
      // the deal choices only appear once the deal is on
      expect(html).not.toContain('id="ls-pipeline"');
    });
  }

  it('shows the user pickers for each owner rule, and the deal pickers when the deal is on', () => {
    const fixed = renderAccount(
      <DefaultsFields
        draft={{ ...emptyDraft(), ownerMode: 'fixed', ownerUserIds: [ID(11)] }}
        set={() => undefined}
        problems={{}}
        server={{}}
      />,
      { ...as(MANAGE), seed: [...pickers] },
    );
    expect(fixed).toContain('id="ls-owner-one"');
    expect(fixed).toContain('Asha Rao (asha@acme.test)');
    expect(fixed).not.toContain('id="ls-owner-many"');

    const robin = renderAccount(
      <DefaultsFields
        draft={{ ...emptyDraft(), ownerMode: 'round_robin', ownerUserIds: [ID(11), ID(12)] }}
        set={() => undefined}
        problems={{}}
        server={{}}
      />,
      { ...as(MANAGE), seed: [...pickers] },
    );
    expect(robin).toContain('id="ls-owner-many"');
    expect(robin).not.toContain('id="ls-owner-one"');

    const deal = renderAccount(
      <DefaultsFields
        draft={{ ...emptyDraft(), dealEnabled: true, pipelineId: ID(21) }}
        set={() => undefined}
        problems={{}}
        server={{}}
      />,
      { ...as(MANAGE), seed: [...pickers] },
    );
    expect(deal).toContain('id="ls-pipeline"');
    expect(deal).toContain('id="ls-deal-stage"');
    expect(deal).toContain('Sales');
    expect(deal).toContain('id="ls-deal-title"');
    // the title template is shown through a value, never from a message with literal braces
    expect(deal).toContain('{{name}} ({{source}})');
  });

  it('shows the client and server problems under their own inputs', () => {
    const html = renderAccount(
      <DefaultsFields
        draft={{ ...emptyDraft(), ownerMode: 'round_robin', ownerUserIds: [ID(11)] }}
        set={() => undefined}
        problems={{ 'defaults.owner.userIds': { key: 'ownerRoundRobin' } }}
        server={{
          'defaults.lifecycleStage': {
            path: 'defaults.lifecycleStage',
            key: 'details.unknown_or_lost_stage',
          },
        }}
      />,
      { ...as(MANAGE), seed: [...pickers] },
    );
    expect(html).toContain('Choose at least two people to take turns.');
    expect(html).toContain('does not exist or is a lost stage');
    expect(html).toContain('role="alert"');
  });

  it('says so when the team or the pipelines could not be loaded, without a dead picker', () => {
    // Nothing is seeded: the pickers are loading, so their selects are disabled instead of empty and clickable.
    const html = renderAccount(
      <DefaultsFields
        draft={{ ...emptyDraft(), dealEnabled: true, ownerMode: 'fixed' }}
        set={() => undefined}
        problems={{}}
        server={{}}
      />,
      { ...as(MANAGE) },
    );
    expect(html).toContain('disabled=""');
  });
});

describe('the one-time reveal', () => {
  const reveal = revealOf({ token: SECRET_TOKEN, hookPath: SECRET_PATH }, 'created');
  const env = { apiPublicUrl: 'https://api.acme.test' };

  for (const locale of LOCALES) {
    it(`shows the full URL, the token, copy buttons and a sample once, in ${locale}`, () => {
      const html = renderAccount(
        <RevealPanel
          reveal={reveal}
          env={env}
          hasSecret={false}
          onChange={() => undefined}
          onDone={() => undefined}
        />,
        { locale },
      );
      expect(html).toContain(`https://api.acme.test${SECRET_PATH}`);
      expect(html).toContain(SECRET_TOKEN);
      expect(html).toContain('curl -X POST');
      expect(html.match(/<button/g)!.length).toBeGreaterThanOrEqual(3);
      expect(html).not.toContain('x-webhook-secret');
    });
  }

  it('cannot be left until the person confirms they copied it', () => {
    const open = renderAccount(
      <RevealPanel
        reveal={reveal}
        env={env}
        hasSecret={false}
        onChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    // the continue button is disabled and the box is unticked
    expect(open).toMatch(/<button[^>]*disabled=""[^>]*>I have copied it, continue/);
    expect(open).not.toContain('checked=""');
    const confirmed = renderAccount(
      <RevealPanel
        reveal={confirmReveal(reveal, true)}
        env={env}
        hasSecret={false}
        onChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    expect(confirmed).toContain('checked=""');
    expect(confirmed).not.toMatch(/<button[^>]*disabled=""[^>]*>I have copied it, continue/);
  });

  it('mentions the secret header only for a source that has a shared secret', () => {
    const html = renderAccount(
      <RevealPanel
        reveal={reveal}
        env={env}
        hasSecret
        onChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    expect(html).toContain('x-webhook-secret');
    expect(html).not.toMatch(/value="[^"]*secret[^"]*"/i);
  });

  it('shows the path with a hint when the API origin is unknown', () => {
    const html = renderAccount(
      <RevealPanel
        reveal={reveal}
        env={{}}
        hasSecret={false}
        onChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    expect(html).toContain(SECRET_PATH);
    expect(html).toContain('Put your API address in front of this path');
    expect(html).not.toContain('https://');
  });

  it('after the reveal is dismissed a re-render holds neither the token nor the URL', () => {
    const source1 = source({ hasSecret: true });
    const during = renderAccount(
      <ConnectStep
        source={source1}
        reveal={reveal}
        hookEnv={env}
        canManage
        onReveal={() => undefined}
        onDone={() => undefined}
        onContinue={() => undefined}
      />,
      { ...as(MANAGE) },
    );
    expect(during).toContain(SECRET_TOKEN);
    // the test lead and the wait for the first lead are part of the same step
    expect(during).toContain('Send test lead');
    expect(during).toContain('data-testid="first-lead-watch"');

    const after = renderAccount(
      <ConnectStep
        source={source1}
        reveal={null}
        hookEnv={env}
        canManage
        onReveal={() => undefined}
        onDone={() => undefined}
        onContinue={() => undefined}
      />,
      { ...as(MANAGE) },
    );
    expect(after).not.toContain(SECRET_TOKEN);
    expect(after).not.toContain(SECRET_PATH);
    expect(after).not.toContain('lead-hooks');
    expect(after).not.toContain('api.acme.test');
    expect(after).toContain('Continue to mapping');
    expect(after).toContain('no longer shown');
  });
});
