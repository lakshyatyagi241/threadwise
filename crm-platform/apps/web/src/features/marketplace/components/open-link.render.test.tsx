import { describe, expect, it, vi } from 'vitest';
import { INSTALL, MANAGE, READ, renderMarket } from '../render-test-utils';
import { ID, card, detail, installation } from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/marketplace/app/lead-scoring',
}));

import { AppDetail } from './app-detail-page';
import { DoneStep } from './install-page';
import { ManageScreen } from './manage-page';

/**
 * The Open link of an app that has a screen of its own, and the locked state of one the workspace does not have. Static renders with the
 * real English and Arabic messages: they prove what is offered where, not how it looks.
 */
const installed = (status: 'active' | 'disabled' | 'killed' = 'active') => ({
  installationId: ID(50),
  status,
  health: 'healthy' as const,
  needsReconsent: false,
});
const app = (slug: string, over = {}) =>
  detail({ slug, name: 'AI lead scoring', kind: 'mini_app', ...over });
const opts = { permissions: [READ, INSTALL, MANAGE] };

describe('Open on the app page', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`an installed app with a screen shows Open beside Manage (${locale})`, () => {
      const html = renderMarket(<AppDetail app={app('lead-scoring', { install: installed() })} />, {
        ...opts,
        locale,
      });
      expect(html).toContain('data-testid="app-open"');
      expect(html).toContain('href="/lead-scoring"');
      expect(html).toContain(locale === 'en' ? '>Open<' : 'فتح');
      expect(html).toContain(`/marketplace/installed/${ID(50)}`);
    });
  }

  it('opens each app that has a screen at that screen', () => {
    for (const [slug, href] of [
      ['forms', '/forms'],
      ['appointments', '/appointments'],
      ['ai-crm-copilot', '/ai-crm'],
      ['sms', '/sms'],
      ['whatsapp-devices', '/devices'],
    ] as const) {
      const html = renderMarket(<AppDetail app={app(slug, { install: installed() })} />, opts);
      expect(html, slug).toContain(`href="${href}"`);
    }
  });

  it('shows only Manage for an app that has no screen of its own', () => {
    const html = renderMarket(<AppDetail app={app('indiamart', { install: installed() })} />, opts);
    expect(html).not.toContain('data-testid="app-open"');
    expect(html).toContain(`/marketplace/installed/${ID(50)}`);
  });

  it('offers no Open while the app is paused or stopped by the platform', () => {
    for (const status of ['disabled', 'killed'] as const) {
      const html = renderMarket(
        <AppDetail app={app('lead-scoring', { install: installed(status) })} />,
        opts,
      );
      expect(html, status).not.toContain('data-testid="app-open"');
    }
  });

  it('a workspace that has not installed it sees the lock and the way to the plan, and no Open', () => {
    const html = renderMarket(
      <AppDetail
        app={app('lead-scoring', {
          install: null,
          locked: { reason: 'plan_feature', key: 'lead_scoring', upgradeUrl: '/account/plans' },
        })}
      />,
      opts,
    );
    expect(html).not.toContain('data-testid="app-open"');
    expect(html).toContain('href="/account/plans"');
  });

  it('a paid app that is not bought shows Subscribe and no Open', () => {
    const html = renderMarket(
      <AppDetail
        app={app('lead-scoring', {
          install: null,
          pricing: {
            ...card().pricing,
            model: 'paid_monthly',
            amount: '999.00',
            currency: 'INR',
            access: 'subscription_required',
            availability: 'open',
          },
        })}
      />,
      opts,
    );
    expect(html).not.toContain('data-testid="app-open"');
    expect(html).not.toContain('href="/lead-scoring"');
  });
});

describe('Open on the manage page and after the install', () => {
  it('the manage page of a running app has Open; a paused app does not', () => {
    const run = (status: 'active' | 'disabled') =>
      renderMarket(
        <ManageScreen
          installation={installation({
            status,
            app: {
              ...installation().app,
              slug: 'lead-scoring',
              name: 'AI lead scoring',
              kind: 'mini_app',
            },
          })}
          app={undefined}
          reload={() => undefined}
        />,
        opts,
      );
    expect(run('active')).toContain('data-testid="manage-open"');
    expect(run('active')).toContain('href="/lead-scoring"');
    expect(run('disabled')).not.toContain('data-testid="manage-open"');
  });

  it('the last step of the install offers Open first', () => {
    const html = renderMarket(
      <DoneStep
        app={app('lead-scoring')}
        done={{ installationId: ID(50), version: '1.0.0' }}
        reveal={{ phase: 'none' }}
        onReveal={() => undefined}
      />,
      opts,
    );
    expect(html).toContain('data-testid="done-open"');
    expect(html).toContain('href="/lead-scoring"');
  });
});
