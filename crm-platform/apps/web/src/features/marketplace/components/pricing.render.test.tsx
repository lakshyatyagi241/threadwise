import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { mktKeys } from '../api';
import { mktError } from '../lib/errors';
import { INSTALL, MANAGE, READ, renderMarket } from '../render-test-utils';
import {
  ID,
  PACK_PATH,
  card,
  detail,
  installation,
  paidPricing,
  pricing,
  subscription,
} from '../test-fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/marketplace/app/webhook',
}));

import { AppCard } from './app-card';
import { AppDetail } from './app-detail-page';
import { FailureView, InstallFlow } from './install-page';
import { InstalledPage } from './installed-page';
import { ManagePage } from './manage-page';

/**
 * Static renders of the paid and free app screens with the real English and Arabic messages: they prove the text is complete (a
 * missing or broken message throws), that the price and the state of the subscription decide what each screen offers, and that a
 * missing permission is named instead of leaving a dead button. There is no browser here: nothing below says how the screens look or
 * what a click does.
 */
const LOCALES = ['en', 'ar'] as const;
const WID = ID(50);
const RECORDS = [
  'record.contacts.read',
  'record.contacts.create',
  'record.contacts.update',
  'inbox.conversation.reply',
];

const ended = (over: object = {}) =>
  subscription({
    status: 'ended',
    lapsedAt: '2026-11-01T00:00:00.000Z',
    actions: { canCancel: false, canResume: false, canRenew: true },
    ...over,
  });
const canceling = () =>
  subscription({
    status: 'canceling',
    canceledAt: '2026-10-10T00:00:00.000Z',
    actions: { canCancel: false, canResume: true, canRenew: false },
  });
const trial = () =>
  subscription({
    status: 'trialing',
    source: 'trial',
    amount: null,
    currency: null,
    trialEndsAt: '2026-10-14T00:00:00.000Z',
    currentPeriodEnd: '2026-10-14T00:00:00.000Z',
  });
const comp = () =>
  subscription({
    status: 'comped',
    source: 'comp',
    amount: null,
    currency: null,
    currentPeriodEnd: null,
    actions: { canCancel: false, canResume: false, canRenew: false },
  });

const entitled = (over: object = {}) =>
  paidPricing({ access: 'entitled', trialAvailable: false, ...over });
const notForSale = () => paidPricing({ access: 'not_for_sale', trialAvailable: false });

const buttonWith = (html: string, label: string) =>
  new RegExp(`<button[^>]*>(?:<[^>]*>)*${label}`).test(html);
const disabledButtonWith = (html: string, label: string) =>
  new RegExp(`<button[^>]*\\sdisabled=""[^>]*>(?:<[^>]*>)*${label}`).test(html);

// --- cards -----------------------------------------------------------------------------------------------------------------------

describe('cards show the real price', () => {
  for (const locale of LOCALES) {
    it(`a paid app: the monthly price, the trial chip and Subscribe in ${locale}`, () => {
      const html = renderMarket(<AppCard card={card({ pricing: paidPricing() })} />, { locale });
      expect(html).toContain('data-testid="price-line"');
      expect(html).toContain('data-access="subscription_required"');
      expect(html).toContain('data-testid="trial-chip"');
      expect(html).toContain('href="/marketplace/app/webhook/install"');
      expect(html).toContain(locale === 'en' ? '$9 / month' : 'شهريًا');
      expect(html).toContain(locale === 'en' ? '14-day free trial' : 'تجربة مجانية');
      expect(html).toContain(locale === 'en' ? '>Subscribe<' : '>اشتراك<');
      expect(html).toContain('href="/marketplace/app/webhook/install"');
    });
  }

  for (const locale of LOCALES) {
    it(`an add-on on offer: Add-on chip, price, Subscribe, a disabled Install and the reason in ${locale}`, () => {
      const html = renderMarket(<AppCard card={card({ pricing: paidPricing() })} />, { locale });
      expect(html).toContain('data-testid="addon-chip"');
      expect(html).toContain('data-availability="visible"');
      expect(html).toContain(locale === 'en' ? '>Add-on<' : '>إضافة<');
      expect(html).toContain('data-testid="needs-purchase"');
      expect(
        html.includes(
          locale === 'en'
            ? 'Included in your plan&#x27;s catalogue, buy it to use it.'
            : 'مشمول في كتالوج باقتك، اشتره لاستخدامه.',
        ),
      ).toBe(true);
      expect(disabledButtonWith(html, locale === 'en' ? 'Install' : 'تثبيت')).toBe(true);
      expect(html).toContain('aria-describedby="mkt-needs-webhook"');
    });
  }

  it('a purchased add-on is the ordinary card: Subscribed, no Add-on chip, Install, no reason', () => {
    const html = renderMarket(
      <AppCard
        card={card({
          pricing: paidPricing({
            access: 'entitled',
            availability: 'purchased',
            trialAvailable: false,
          }),
        })}
      />,
    );
    expect(html).toContain('>Subscribed<');
    expect(html).not.toContain('addon-chip');
    expect(html).not.toContain('needs-purchase');
    expect(html).toContain('>Install<');
  });

  it('free and included cards never carry the add-on chip or the reason', () => {
    for (const p of [
      pricing(),
      paidPricing({ access: 'included', availability: 'open', includedBy: 'min_plan' }),
    ]) {
      const html = renderMarket(<AppCard card={card({ pricing: p })} />);
      expect(html).not.toContain('addon-chip');
      expect(html).not.toContain('needs-purchase');
    }
  });

  it('a free app says Free and keeps Install', () => {
    const html = renderMarket(<AppCard card={card()} />);
    expect(html).toContain('>Free<');
    expect(html).toContain('>Install<');
    expect(html).not.toContain('trial-chip');
    expect(html).not.toContain('/ month');
  });

  it('draws no trial chip once the trial is used, and keeps the price', () => {
    const html = renderMarket(
      <AppCard card={card({ pricing: paidPricing({ trialAvailable: false }) })} />,
    );
    expect(html).toContain('$9 / month');
    expect(html).not.toContain('trial-chip');
    expect(html).toContain('>Subscribe<');
  });

  it('an app the plan includes says so and keeps Install', () => {
    const html = renderMarket(
      <AppCard
        card={card({
          pricing: paidPricing({
            access: 'included',
            includedBy: 'min_plan',
            trialAvailable: false,
          }),
        })}
      />,
    );
    expect(html).toContain('Included in your plan');
    expect(html).toContain('>Install<');
    expect(html).not.toContain('$9');
  });

  it('an app the workspace subscribes to says Subscribed and keeps Install', () => {
    const html = renderMarket(<AppCard card={card({ pricing: entitled() })} />);
    expect(html).toContain('>Subscribed<');
    expect(html).toContain('>Install<');
  });

  for (const locale of LOCALES) {
    it(`an app that is not for sale says so and offers details only in ${locale}`, () => {
      const html = renderMarket(<AppCard card={card({ pricing: notForSale() })} />, { locale });
      expect(html).toContain(locale === 'en' ? 'Not for sale' : 'غير متاح للبيع');
      expect(html).toContain('href="/marketplace/app/webhook"');
      expect(html).not.toContain('/install"');
      expect(html).not.toContain('>Subscribe<');
    });
  }

  it('offers details only to someone who may not subscribe', () => {
    const html = renderMarket(<AppCard card={card({ pricing: paidPricing() })} />, {
      permissions: [READ],
    });
    expect(html).toContain('View details');
    expect(html).not.toContain('/install"');
  });

  it('an installed paid app goes to its manage page, whatever its price', () => {
    const install = {
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
    };
    const html = renderMarket(<AppCard card={card({ pricing: entitled(), install })} />);
    expect(html).toContain(`href="/marketplace/installed/${ID(50)}"`);
    expect(html).not.toContain('>Subscribe<');
  });

  it('prints a price as text, never as markup', () => {
    const html = renderMarket(
      <AppCard card={card({ pricing: paidPricing({ currency: 'XX<' }) })} />,
    );
    expect(html).not.toContain('XX<');
  });
});

// --- the app page ----------------------------------------------------------------------------------------------------------------

describe('app page: a paid app with no subscription', () => {
  for (const locale of LOCALES) {
    it(`offers Subscribe and the free trial where Install was, with the pricing block, in ${locale}`, () => {
      const html = renderMarket(<AppDetail app={detail({ pricing: paidPricing() })} />, {
        locale,
      });
      expect(html).toContain('data-testid="subscribe-actions"');
      expect(html).toContain('data-testid="pricing-block"');
      expect(html).toContain('data-testid="trial-offer"');
      expect(buttonWith(html, locale === 'en' ? 'Subscribe' : 'اشتراك')).toBe(true);
      expect(
        buttonWith(html, locale === 'en' ? 'Start 14-day free trial' : 'ابدأ تجربة مجانية'),
      ).toBe(true);
      expect(html).not.toContain('/install"');
      expect(html).toContain('data-testid="needs-purchase"');
      expect(disabledButtonWith(html, locale === 'en' ? 'Install' : 'تثبيت')).toBe(true);
    });
  }

  it('words the billing honestly: a prepaid month, paid again, never "renews automatically"', () => {
    const html = renderMarket(<AppDetail app={detail({ pricing: paidPricing() })} />);
    expect(html).toContain('$9 / month');
    expect(html).toContain('not charged automatically');
    expect(html).toContain('pay again before the date shown');
    expect(html).toContain('Nothing is charged until you choose to subscribe.');
    expect(html.toLowerCase()).not.toContain('renews automatically');
    expect(html).toContain('$9 per month, paid at checkout.');
  });

  it('offers no trial once it was used', () => {
    const html = renderMarket(
      <AppDetail app={detail({ pricing: paidPricing({ trialAvailable: false }) })} />,
    );
    expect(buttonWith(html, 'Subscribe')).toBe(true);
    expect(html).not.toContain('Start 14-day free trial');
    expect(html).not.toContain('trial-offer');
  });

  it('shows no enabled Subscribe to someone without market.apps.install, and names the key', () => {
    const html = renderMarket(<AppDetail app={detail({ pricing: paidPricing() })} />, {
      permissions: [READ],
    });
    expect(html).not.toContain('subscribe-actions');
    expect(html).toContain('market.apps.install');
    expect(disabledButtonWith(html, 'Install')).toBe(true);
  });

  it('keeps the permission step out of the page: the consent comes later, on the install page', () => {
    const html = renderMarket(<AppDetail app={detail({ pricing: paidPricing() })} />);
    expect(html).not.toContain('id="mkt-consent"');
  });
});

describe('app page: the other price states', () => {
  it('an app that is not for sale shows a note and nothing to press', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(<AppDetail app={detail({ pricing: notForSale() })} />, { locale });
      expect(html).toContain('data-testid="not-for-sale"');
      expect(html).not.toContain('subscribe-actions');
      expect(html).not.toContain('/install"');
    }
    const en = renderMarket(<AppDetail app={detail({ pricing: notForSale() })} />);
    expect(en).toContain('This app is not being sold to new subscribers right now.');
    expect(en).toContain('Not for sale');
  });

  for (const locale of LOCALES) {
    it(`an app the plan includes says nothing is to pay and keeps Install in ${locale}`, () => {
      const html = renderMarket(
        <AppDetail
          app={detail({
            pricing: paidPricing({
              access: 'included',
              includedBy: 'plan_feature',
              trialAvailable: false,
            }),
          })}
        />,
        { locale },
      );
      expect(html).toContain(
        locale === 'en'
          ? 'Your plan includes this app, so there is nothing to pay.'
          : 'باقتك تشمل هذا التطبيق، فلا يوجد ما تدفعه.',
      );
      expect(html).toContain('href="/marketplace/app/webhook/install"');
      expect(html).not.toContain('subscribe-actions');
    });
  }

  it('says which rule includes it: the plan feature or the minimum plan', () => {
    const by = (includedBy: 'plan_feature' | 'min_plan') =>
      renderMarket(
        <AppDetail
          app={detail({
            pricing: paidPricing({ access: 'included', includedBy, trialAvailable: false }),
          })}
        />,
      );
    expect(by('min_plan')).toContain('Your plan, or a higher plan, includes this app');
    expect(by('plan_feature')).toContain(
      'Your plan includes this app, so there is nothing to pay.',
    );
  });

  it('a free app has a plain pricing block and the ordinary Install', () => {
    const html = renderMarket(<AppDetail app={detail()} />);
    expect(html).toContain('No charge to install or use.');
    expect(html).toContain('href="/marketplace/app/webhook/install"');
    expect(html).not.toContain('subscription-panel');
    expect(html).not.toContain('not charged automatically');
  });
});

describe('app page: the subscription panel', () => {
  const entitledApp = (sub = subscription(), over: object = {}) =>
    detail({ pricing: entitled(), subscription: sub, ...over });

  for (const locale of LOCALES) {
    it(`shows an active subscription: state, paid until, last payment, Cancel; Install stays in ${locale}`, () => {
      const html = renderMarket(<AppDetail app={entitledApp()} />, { locale });
      expect(html).toContain('data-testid="subscription-panel"');
      expect(html).toContain('data-status="active"');
      expect(html).toContain(locale === 'en' ? 'Paid until Oct 31, 2026' : 'مدفوع حتى');
      expect(html).toContain(locale === 'en' ? 'Last payment: $9 per month' : 'آخر دفعة');
      expect(buttonWith(html, locale === 'en' ? 'Cancel subscription' : 'إلغاء الاشتراك')).toBe(
        true,
      );
      expect(html).toContain('href="/marketplace/app/webhook/install"');
      expect(html).not.toContain('subscribe-actions');
    });
  }

  it('asks before cancelling and says what happens: active until the date, then paused, data kept', () => {
    const html = renderMarket(<AppDetail app={entitledApp()} />);
    expect(html).toContain('Cancel the subscription to Webhook?');
    expect(html).toContain(
      'Webhook stays active until Oct 31, 2026, then it is paused. Your data and settings are kept.',
    );
    expect(html).toContain('Nothing more will be charged');
    expect(html).toContain('Keep subscription');
  });

  it('a subscription that is not renewing says until when, and offers Resume instead of Cancel', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(<AppDetail app={entitledApp(canceling())} />, { locale });
      expect(html).toContain('data-status="canceling"');
      expect(html).toContain(
        locale === 'en' ? 'Not renewing. Active until Oct 31, 2026' : 'لن يتجدد. يظل نشطًا حتى',
      );
      expect(buttonWith(html, locale === 'en' ? 'Resume subscription' : 'استئناف الاشتراك')).toBe(
        true,
      );
    }
    const en = renderMarket(<AppDetail app={entitledApp(canceling())} />);
    expect(en).not.toContain('Cancel the subscription to');
    expect(buttonWith(en, 'Cancel subscription')).toBe(false);
  });

  it('near its end it offers Renew now', () => {
    const near = subscription({ actions: { canCancel: true, canResume: false, canRenew: true } });
    const html = renderMarket(<AppDetail app={entitledApp(near)} />);
    expect(buttonWith(html, 'Renew now')).toBe(true);
    expect(html).toContain('A paid month is not renewed automatically.');
  });

  it('an ended subscription says so and offers Resubscribe; the app can be subscribed to again', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(
        <AppDetail
          app={detail({
            pricing: paidPricing({ trialAvailable: false }),
            subscription: ended(),
          })}
        />,
        { locale },
      );
      expect(html).toContain('data-status="ended"');
      expect(html).toContain(
        locale === 'en' ? 'Subscription ended Nov 1, 2026' : 'انتهى الاشتراك في',
      );
      expect(buttonWith(html, locale === 'en' ? 'Resubscribe' : 'إعادة الاشتراك')).toBe(true);
    }
  });

  it('an ended subscription of an app that is no longer sold offers no way to pay', () => {
    const html = renderMarket(
      <AppDetail
        app={detail({
          pricing: notForSale(),
          subscription: ended({ actions: { canCancel: false, canResume: false, canRenew: false } }),
        })}
      />,
    );
    expect(buttonWith(html, 'Resubscribe')).toBe(false);
    expect(html).toContain('data-testid="not-for-sale"');
  });

  it('a free trial says when it ends and has no payment to show', () => {
    const html = renderMarket(<AppDetail app={entitledApp(trial())} />);
    expect(html).toContain('data-status="trialing"');
    expect(html).toContain('Free trial ends Oct 14, 2026');
    expect(html).not.toContain('Last payment');
  });

  it('a comp cannot be cancelled here and says who gave it', () => {
    const html = renderMarket(<AppDetail app={entitledApp(comp())} />);
    expect(html).toContain('data-status="comped"');
    expect(html).toContain('Complimentary access, no end date');
    expect(html).toContain('The platform team gave you this access. It cannot be cancelled here.');
    expect(buttonWith(html, 'Cancel subscription')).toBe(false);
  });

  it('tells the person when the price changed: what the next payment will be', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(
        <AppDetail app={entitledApp(subscription({ nextAmount: '12.00', nextCurrency: 'USD' }))} />,
        { locale },
      );
      expect(html).toContain('data-testid="price-change"');
    }
    const en = renderMarket(
      <AppDetail app={entitledApp(subscription({ nextAmount: '12.00', nextCurrency: 'USD' }))} />,
    );
    expect(en).toContain('Your next payment will be $12 per month.');
    const same = renderMarket(<AppDetail app={entitledApp()} />);
    expect(same).not.toContain('price-change');
  });

  it('names the permission instead of showing buttons to someone who may only read', () => {
    const html = renderMarket(<AppDetail app={entitledApp()} />, { permissions: [READ] });
    expect(html).toContain('data-testid="subscription-panel"');
    expect(html).not.toContain('subscription-actions');
    expect(html).not.toContain('Cancel the subscription to');
    expect(html).toContain('market.apps.install');
  });

  it('an installed app shows Manage, and the panel with it', () => {
    const install = {
      installationId: ID(50),
      status: 'active' as const,
      health: 'healthy' as const,
      needsReconsent: false,
    };
    const html = renderMarket(<AppDetail app={entitledApp(subscription(), { install })} />);
    expect(html).toContain(`href="/marketplace/installed/${ID(50)}"`);
    expect(html).toContain('subscription-panel');
    expect(html).not.toContain('/install"');
  });
});

// --- the install page ------------------------------------------------------------------------------------------------------------

describe('install page for a paid app', () => {
  const perms = [READ, INSTALL, ...RECORDS];

  for (const locale of LOCALES) {
    it(`opens on Subscribe, with the price and the trial, instead of the permission step in ${locale}`, () => {
      const html = renderMarket(<InstallFlow app={detail({ pricing: paidPricing() })} />, {
        locale,
        permissions: perms,
      });
      expect(html).toContain('data-testid="install-subscribe"');
      expect(html).toContain('data-testid="subscribe-panel"');
      expect(html).toContain(locale === 'en' ? 'Webhook is a paid app' : 'تطبيق مدفوع');
      expect(html).not.toContain('id="mkt-consent"');
      expect(html).not.toContain('data-testid="install-flow"');
    });
  }

  it('shows the price and both buttons', () => {
    const html = renderMarket(<InstallFlow app={detail({ pricing: paidPricing() })} />, {
      permissions: perms,
    });
    expect(html).toContain('$9 / month');
    expect(buttonWith(html, 'Subscribe')).toBe(true);
    expect(buttonWith(html, 'Start 14-day free trial')).toBe(true);
    expect(html).toContain('before anything is installed');
  });

  it('goes back to the unchanged consent step once the workspace holds a subscription', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(
        <InstallFlow app={detail({ pricing: entitled(), subscription: subscription() })} />,
        { locale, permissions: perms },
      );
      expect(html).toContain('data-testid="install-flow"');
      expect(html).toContain('id="mkt-consent"');
      expect(html).not.toContain('install-subscribe');
    }
  });

  it('keeps the unchanged consent step for a free app and for one the plan includes', () => {
    for (const pricing of [
      detail().pricing,
      paidPricing({ access: 'included', includedBy: 'min_plan', trialAvailable: false }),
    ]) {
      const html = renderMarket(<InstallFlow app={detail({ pricing })} />, { permissions: perms });
      expect(html).toContain('id="mkt-consent"');
    }
  });

  it('says an app that is not for sale cannot be installed or subscribed to', () => {
    const html = renderMarket(<InstallFlow app={detail({ pricing: notForSale() })} />, {
      permissions: perms,
    });
    expect(html).toContain('Webhook is not for sale');
    expect(html).toContain('data-testid="not-for-sale"');
    expect(html).not.toContain('id="mkt-consent"');
    expect(html).not.toContain('subscribe-actions');
  });

  it('names the permission for someone who may not install or subscribe', () => {
    const html = renderMarket(<InstallFlow app={detail({ pricing: paidPricing() })} />, {
      permissions: [READ],
    });
    expect(html).toContain('market.apps.install');
    expect(html).not.toContain('subscribe-actions');
  });

  it('answers an install that was refused for want of a subscription with the way to checkout', () => {
    const e = new ApiError(422, 'MKT_SUBSCRIPTION_REQUIRED', 'x', 'req-5', [
      { path: 'reason', message: 'subscription_required' },
      { path: 'checkoutPath', message: PACK_PATH },
    ]);
    for (const locale of LOCALES) {
      const html = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />, {
        locale,
      });
      expect(html).toContain(`href="${PACK_PATH}"`);
      expect(html).toContain('req-5');
    }
    const en = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />);
    expect(en).toContain('This is a paid app. Subscribe to install it.');
    expect(en).toContain('Go to checkout');
  });

  it('never links to a checkout address that is not the add-on checkout page', () => {
    const e = new ApiError(422, 'MKT_SUBSCRIPTION_REQUIRED', 'x', 'req-6', [
      { path: 'checkoutPath', message: 'https://evil.test/pay' },
    ]);
    const html = renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />);
    expect(html).not.toContain('evil.test');
    expect(html).not.toContain('Go to checkout');
  });

  it('words the refused sale, trial and subscription state', () => {
    const say = (code: string, status = 409) => {
      const e = new ApiError(status, code, 'x', 'req-7');
      return renderMarket(<FailureView failed={mktError(e)} error={e} alreadyId={null} />);
    };
    expect(say('MKT_NOT_FOR_SALE')).toContain('not being sold to new subscribers');
    expect(say('MKT_TRIAL_UNAVAILABLE', 422)).toContain('free trial is not available');
    expect(say('MKT_SUBSCRIPTION_NOT_FOUND', 404)).toContain('no subscription to this app');
    expect(say('MKT_SUBSCRIPTION_STATE')).toContain('current state of the subscription');
  });
});

// --- the manage page -------------------------------------------------------------------------------------------------------------

const seed = (inst = installation(), withApp = true) =>
  [
    [mktKeys.installation(WID), inst],
    ...(withApp ? [[mktKeys.app('webhook'), detail()] as const] : []),
  ] as const;

describe('manage page: subscription', () => {
  for (const locale of LOCALES) {
    it(`shows the panel of an active subscription with Pause and Uninstall as before in ${locale}`, () => {
      const html = renderMarket(<ManagePage id={WID} />, {
        locale,
        seed: seed(installation({ pricing: entitled(), subscription: subscription() })),
      });
      expect(html).toContain('data-testid="subscription-panel"');
      expect(html).toContain('data-status="active"');
      expect(html).toContain('data-testid="manage-page"');
      expect(html).toContain(locale === 'en' ? '>Subscribed<' : '>مشترك<');
    });
  }

  const active = () => installation({ pricing: entitled(), subscription: subscription() });

  it('says paid until, offers Cancel behind a confirmation, and keeps the ordinary controls', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed(active()) });
    expect(html).toContain('Paid until Oct 31, 2026');
    expect(html).toContain('Last payment: $9 per month');
    expect(html).toContain('Cancel the subscription to Webhook?');
    expect(html).toContain(
      'Webhook stays active until Oct 31, 2026, then it is paused. Your data and settings are kept.',
    );
    expect(html).toContain('>Pause<');
    expect(html).not.toContain('subscription-ended-banner');
  });

  it('warns in the uninstall dialog that uninstalling stops renewal, and says what stays paid', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(<ManagePage id={WID} />, { locale, seed: seed(active()) });
      expect(html).toContain('data-testid="uninstall-renewal"');
    }
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed(active()) });
    expect(html).toContain('This app has a paid subscription');
    expect(html).toContain('Uninstalling stops it from renewing, so nothing more is charged.');
    expect(html).toContain('stays yours until Oct 31, 2026');
  });

  it('does not warn about renewal for a free app, a trial, a comp or a subscription already not renewing', () => {
    const none = (inst: ReturnType<typeof installation>) =>
      renderMarket(<ManagePage id={WID} />, { seed: seed(inst) });
    expect(none(installation())).not.toContain('uninstall-renewal');
    expect(none(installation({ pricing: entitled(), subscription: trial() }))).not.toContain(
      'uninstall-renewal',
    );
    expect(none(installation({ pricing: entitled(), subscription: comp() }))).not.toContain(
      'uninstall-renewal',
    );
    expect(none(installation({ pricing: entitled(), subscription: canceling() }))).not.toContain(
      'uninstall-renewal',
    );
  });

  it('a subscription that is not renewing offers Resume and no second Cancel', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ pricing: entitled(), subscription: canceling() })),
    });
    expect(html).toContain('Not renewing. Active until Oct 31, 2026');
    expect(buttonWith(html, 'Resume subscription')).toBe(true);
    expect(html).not.toContain('Cancel the subscription to');
    expect(html).toContain('Not renewing');
  });

  it('near the end it offers Renew now, which pays again at checkout', () => {
    const near = subscription({ actions: { canCancel: true, canResume: false, canRenew: true } });
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ pricing: entitled(), subscription: near })),
    });
    expect(buttonWith(html, 'Renew now')).toBe(true);
  });

  it('tells the person the price changed, with the next payment', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(
        installation({
          pricing: entitled(),
          subscription: subscription({ nextAmount: '12.00', nextCurrency: 'USD' }),
        }),
      ),
    });
    expect(html).toContain('Your next payment will be $12 per month.');
  });

  it('shows what is true of a plan-included paid app: nothing to pay, no panel', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(
        installation({
          pricing: paidPricing({
            access: 'included',
            includedBy: 'min_plan',
            trialAvailable: false,
          }),
        }),
      ),
    });
    expect(html).toContain('data-testid="included-note"');
    expect(html).not.toContain('subscription-panel');
  });

  it('offers to subscribe when an installed app became paid and the workspace has no subscription', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(<ManagePage id={WID} />, {
        locale,
        seed: seed(installation({ pricing: paidPricing() })),
      });
      expect(html).toContain('data-testid="subscribe-panel"');
    }
    const en = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ pricing: paidPricing() })),
    });
    expect(en).toContain('Subscribe to keep using Webhook');
    expect(buttonWith(en, 'Subscribe')).toBe(true);
    const readOnly = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ pricing: paidPricing() })),
      permissions: [READ, MANAGE],
    });
    expect(readOnly).not.toContain('subscribe-actions');
    expect(readOnly).toContain('market.apps.install');
  });

  it('says a paid app that is no longer sold is not for sale, and shows nothing for a free app', () => {
    const notSold = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ pricing: notForSale() })),
    });
    expect(notSold).toContain('data-testid="not-for-sale"');
    const free = renderMarket(<ManagePage id={WID} />, { seed: seed() });
    expect(free).not.toContain('subscription-panel');
    expect(free).not.toContain('not-for-sale');
    expect(free).not.toContain('included-note');
  });

  it('leaves a killed installation with the platform stop and uninstall only', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(
        installation({
          status: 'killed',
          killReason: 'Security issue',
          pricing: entitled(),
          subscription: subscription(),
        }),
      ),
    });
    expect(html).toContain('killed-banner');
    expect(html).not.toContain('subscription-panel');
  });
});

describe('manage page: the subscription ended and paused the app', () => {
  const pausedByEnd = (over: object = {}) =>
    installation({
      status: 'disabled',
      pauseReason: 'subscription_ended',
      pricing: paidPricing({ trialAvailable: false }),
      subscription: ended(),
      ...over,
    });

  for (const locale of LOCALES) {
    it(`shows a prominent banner with Resubscribe, and no Resume, in ${locale}`, () => {
      const html = renderMarket(<ManagePage id={WID} />, { locale, seed: seed(pausedByEnd()) });
      expect(html).toContain('data-testid="subscription-ended-banner"');
      expect(html).toContain('data-pause="resubscribe"');
      expect(html).toContain(locale === 'en' ? 'Subscription ended' : 'انتهى الاشتراك');
      expect(buttonWith(html, locale === 'en' ? 'Resubscribe' : 'إعادة الاشتراك')).toBe(true);
      expect(html).not.toContain(locale === 'en' ? '>Resume<' : '>استئناف<');
      expect(html).not.toContain('data-testid="paused-banner"');
    });
  }

  it('says the data and settings are kept, marks the chips, and hides Pause and Resume', () => {
    const html = renderMarket(<ManagePage id={WID} />, { seed: seed(pausedByEnd()) });
    expect(html).toContain('Your data and settings are kept.');
    expect(html).toContain('Subscribe again to switch it back on.');
    expect(html).toContain('>Paused<');
    expect(html).toContain('>Subscription ended<');
    expect(html).not.toContain('>Pause<');
    expect(html).not.toContain('>Resume<');
    // The credentials, connection and uninstall stay where they were.
    expect(html).toContain('Credentials and settings');
    expect(html).toContain('Uninstall');
  });

  it('names market.apps.install for someone who may manage but not install, and shows no Resubscribe', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(pausedByEnd()),
      permissions: [READ, MANAGE],
    });
    expect(html).toContain('data-testid="subscription-ended-banner"');
    expect(html).toContain('market.apps.install');
    expect(buttonWith(html, 'Resubscribe')).toBe(false);
  });

  it('an app that is no longer sold stays paused, and says why', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(
        pausedByEnd({
          pricing: notForSale(),
          subscription: ended({ actions: { canCancel: false, canResume: false, canRenew: false } }),
        }),
      ),
    });
    expect(html).toContain('data-pause="notForSale"');
    expect(html).toContain('it is no longer sold, so it cannot be switched back on');
    expect(buttonWith(html, 'Resubscribe')).toBe(false);
    expect(html).not.toContain('>Resume<');
  });

  it('offers the ordinary Resume once the plan includes the app again', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(
        pausedByEnd({
          pricing: paidPricing({
            access: 'included',
            includedBy: 'min_plan',
            trialAvailable: false,
          }),
        }),
      ),
    });
    expect(html).toContain('data-pause="resumable"');
    expect(html).toContain('your workspace has access to it again');
    expect(html).toContain('>Resume<');
  });

  it('an app the admin paused by hand keeps the plain paused banner and Resume', () => {
    const html = renderMarket(<ManagePage id={WID} />, {
      seed: seed(installation({ status: 'disabled' })),
    });
    expect(html).toContain('data-testid="paused-banner"');
    expect(html).toContain('>Resume<');
    expect(html).not.toContain('subscription-ended-banner');
  });
});

// --- the installed list ----------------------------------------------------------------------------------------------------------

describe('installed list: paid apps', () => {
  const usage = { installed: 3, limit: 10 };
  const listSeed = (
    data: ReturnType<typeof installation>[],
    subs?: Array<ReturnType<typeof subscription> & { app: object; installationId: string | null }>,
  ) =>
    [
      [mktKeys.installations('all', 'all'), { data, usage }],
      ...(subs ? [[mktKeys.subscriptions, { data: subs }] as const] : []),
    ] as const;
  const workspaceSub = (over: object = {}, installationId: string | null = ID(50)) => ({
    ...subscription(),
    app: { id: ID(1), slug: 'webhook', name: 'Webhook', kind: 'integration' as const, logo: null },
    installationId,
    ...over,
  });

  for (const locale of LOCALES) {
    it(`badges a subscribed row and says paid until in ${locale}`, () => {
      const html = renderMarket(<InstalledPage />, {
        locale,
        seed: listSeed([installation({ pricing: entitled(), subscription: subscription() })]),
      });
      expect(html).toContain('data-testid="installation-webhook"');
      expect(html).toContain(locale === 'en' ? '>Subscribed<' : '>مشترك<');
      expect(html).toContain(locale === 'en' ? 'Paid until Oct 31, 2026' : 'مدفوع حتى');
    });
  }

  it('badges the other states: free trial, not renewing, complimentary and ended (next to Paused)', () => {
    const row = (subscriptionValue: ReturnType<typeof subscription>, over: object = {}) =>
      renderMarket(<InstalledPage />, {
        seed: listSeed([
          installation({ pricing: entitled(), subscription: subscriptionValue, ...over }),
        ]),
      });
    expect(row(trial())).toContain('>Free trial<');
    expect(row(canceling())).toContain('>Not renewing<');
    expect(row(comp())).toContain('>Complimentary<');
    const endedRow = row(ended(), { status: 'disabled', pauseReason: 'subscription_ended' });
    expect(endedRow).toContain('>Paused<');
    expect(endedRow).toContain('>Subscription ended<');
    expect(endedRow).toContain('Subscription ended Nov 1, 2026');
  });

  it('draws no subscription badge for a free app', () => {
    const html = renderMarket(<InstalledPage />, { seed: listSeed([installation()]) });
    expect(html).not.toContain('>Subscribed<');
    expect(html).not.toContain('subscription-date');
  });

  it('lists the workspace subscriptions, an uninstalled app linking to its page', () => {
    for (const locale of LOCALES) {
      const html = renderMarket(<InstalledPage />, {
        locale,
        seed: listSeed(
          [installation()],
          [
            workspaceSub(),
            workspaceSub(
              {
                id: ID(91),
                status: 'canceling',
                app: {
                  id: ID(2),
                  slug: 'crm-sync',
                  name: 'CRM Sync',
                  kind: 'integration',
                  logo: null,
                },
                actions: { canCancel: false, canResume: true, canRenew: false },
              },
              null,
            ),
          ],
        ),
      });
      expect(html).toContain('data-testid="subscriptions"');
      expect(html).toContain('data-testid="subscription-crm-sync"');
      expect(html).toContain('href="/marketplace/app/crm-sync"');
      expect(html).toContain(`href="/marketplace/installed/${ID(50)}"`);
    }
    const en = renderMarket(<InstalledPage />, {
      seed: listSeed([installation()], [workspaceSub()]),
    });
    expect(en).toContain('Subscriptions');
    expect(en).toContain('Last payment: $9 per month');
  });

  it('draws no subscriptions section when there are none or while it loads', () => {
    expect(renderMarket(<InstalledPage />, { seed: listSeed([installation()], []) })).not.toContain(
      'data-testid="subscriptions"',
    );
    expect(renderMarket(<InstalledPage />, { seed: listSeed([installation()]) })).not.toContain(
      'data-testid="subscriptions"',
    );
  });
});
