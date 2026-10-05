import type { OnboardingResponse } from '@crm/contracts';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => '/onboarding',
}));

import { renderGuest, makeSession } from '../../guest/render-test-utils';
import { SuspendedView } from '../lock/suspended-view';
import { VerifyEmailRequiredView } from '../lock/verify-email-required-view';
import { OnboardingView } from './onboarding-view';
import { PlanStep } from './plan-step';
import { WorkspaceStep } from './workspace-step';

const plan = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'free',
  name: 'Free',
  subtitle: null,
  kind: 'free',
  price: { amount: '0.00', offerAmount: null, currency: 'INR', period: null },
  lifetime: false,
  monthlyMessages: 250,
  chips: [],
  highlighted: false,
  current: true,
  action: 'continue_free',
  ctaLabel: 'Choose',
  ...over,
});

function onboarding(over: Partial<OnboardingResponse> = {}): OnboardingResponse {
  return {
    step: 'workspace',
    workspace: {
      name: 'Acme Studio',
      industry: null,
      sizeRange: null,
      timezone: null,
      country: null,
      currency: null,
    },
    currencies: { available: ['INR', 'USD'], platform: 'USD' },
    suggestedName: 'Asha Rao Studio',
    needsPhone: false,
    plans: [plan()],
    defaultTimezone: 'Asia/Kolkata',
    billing: { creditsPerMessage: 2, displayCurrency: 'INR', topUpUrl: '/account/wallet' },
    ...over,
  } as OnboardingResponse;
}

const ONBOARDING_KEY = ['auth', 'onboarding'];

function view(data: OnboardingResponse, session = makeSession()) {
  return renderGuest(createElement(OnboardingView, { defaultCountryIso: null }), {
    session,
    seed: [[ONBOARDING_KEY, data]],
  });
}

describe('onboarding step 2: workspace (TW-AUTH-008)', () => {
  it('draws the mono "Step 2 of 3" line, the title with its accent word and the step list', () => {
    const html = view(onboarding());
    expect(html).toContain('Step 2 of 3 / Workspace');
    expect(html).toContain('Create your');
    expect(html).toContain('>workspace</span>.');
    expect(html).toContain('aria-label="Sign-up progress"');
    expect(html).toContain('aria-current="step"');
  });

  it('asks for name, industry, team size, timezone, country and billing currency', () => {
    const html = view(onboarding());
    expect(html).toContain('Workspace name');
    expect(html).toContain('Industry');
    expect(html).toContain('Team size');
    expect(html).toContain('Timezone');
    expect(html).toContain('Country');
    expect(html).toContain('Currency');
    // Nine industries and five team sizes.
    for (const label of ['Ecommerce', 'SaaS', 'Hospitality']) expect(html).toContain(`>${label}<`);
    for (const size of ['1', '2-5', '6-20', '21-100', '100+'])
      expect(html).toContain(`>${size}</option>`);
  });

  it('prefills the name from sign-up, else the suggestion made from the email', () => {
    expect(view(onboarding())).toContain('value="Acme Studio"');
    const blank = onboarding({
      workspace: {
        name: '',
        industry: null,
        sizeRange: null,
        timezone: null,
        country: null,
        currency: null,
      },
    });
    expect(view(blank)).toContain('value="Asha Rao Studio"');
  });

  it('offers only the currencies the platform can bill in', () => {
    const html = view(onboarding());
    expect(html).toContain('>INR - Indian Rupee</option>');
    expect(html).toContain('>USD - US Dollar</option>');
    expect(html).not.toContain('>EUR');
  });

  it('starts the currency at INR for India and USD for any other country', () => {
    const india = view(
      onboarding({ workspace: { ...onboarding().workspace, country: 'IN', currency: null } }),
    );
    expect(india).toMatch(/<option value="INR" selected/);
    const uk = view(
      onboarding({ workspace: { ...onboarding().workspace, country: 'GB', currency: null } }),
    );
    expect(uk).toMatch(/<option value="USD" selected/);
  });

  it('keeps a currency saved earlier, whatever the country says', () => {
    const html = view(
      onboarding({ workspace: { ...onboarding().workspace, country: 'IN', currency: 'USD' } }),
    );
    expect(html).toMatch(/<option value="USD" selected/);
  });

  it('shows the timezone as a bare id with a search prompt, defaulting to the platform timezone', () => {
    const html = view(onboarding());
    expect(html).toContain('value="Asia/Kolkata"');
    expect(html).not.toMatch(/Asia\/Kolkata \(UTC/);
    expect(html).toContain('placeholder="Search timezone..."');
  });

  it('asks for a mobile number only when the account has none', () => {
    expect(view(onboarding({ needsPhone: false }))).not.toContain('Mobile number');
    const html = view(onboarding({ needsPhone: true }));
    expect(html).toContain('Mobile number');
    expect(html).toContain('fi fi-in');
    expect(html).toContain('name="phone"');
  });

  it('tells a member without the right to finish setup to wait for an administrator', () => {
    const html = view(onboarding(), makeSession({ permissions: {} }));
    expect(html).toContain('Setup is not finished');
    expect(html).not.toContain('Workspace name');
  });
});

describe('onboarding step 3: plan (TW-AUTH-009)', () => {
  const planData = (billing?: Partial<OnboardingResponse['billing']>, plans = [plan()]) =>
    onboarding({
      step: 'plan',
      plans: plans as OnboardingResponse['plans'],
      billing: {
        creditsPerMessage: 2,
        displayCurrency: 'INR',
        topUpUrl: '/account/wallet',
        ...billing,
      },
    });

  const step3 = (data: OnboardingResponse) =>
    renderGuest(createElement(PlanStep, { data, onBack: () => undefined }), {
      session: makeSession({ org: { ...makeSession().org, onboardingStep: 'plan' } }),
    });

  it('explains what happens when the monthly allowance runs out, with the credit rate', () => {
    const html = step3(planData({ creditsPerMessage: 3 }));
    expect(html).toContain('wallet credits');
    expect(html).toContain('3 credits per message');
    expect(step3(planData({ creditsPerMessage: 1 }))).toContain('1 credit per message');
  });

  it('links to topping up credits', () => {
    const html = step3(planData({ topUpUrl: '/pay/credits' }));
    expect(html).toContain('href="/pay/credits"');
    expect(html).toContain('Add message credits');
  });

  it('shows up to three chips per card and the most-popular badge', () => {
    const html = step3(
      planData({}, [
        plan({
          id: '22222222-2222-4222-8222-222222222222',
          name: 'Growth',
          kind: 'paid',
          highlighted: true,
          current: false,
          action: 'choose',
          price: {
            amount: '1999.00',
            offerAmount: '1499.00',
            currency: 'INR',
            period: { unit: 'months', count: 1 },
          },
          chips: ['analytics', 'automation', 'ai_assistants'],
        }),
      ] as never),
    );
    expect(html).toContain('Most popular');
    for (const chip of ['Analytics', 'Automation', 'AI assistants'])
      expect(html).toContain(`>${chip}<`);
    expect(html).toContain('data-testid="plan-strike"');
  });

  it('keeps the explanation and an empty-state line when no plan is set up', () => {
    const html = step3(planData({}, []));
    expect(html).toContain('wallet credits');
    expect(html).toContain('No plans are set up yet');
    expect(html).toContain('Start free / skip for now');
  });

  it('the page shows the step 3 title line while the data loads from the session step', () => {
    const html = renderGuest(createElement(OnboardingView, { defaultCountryIso: null }), {
      session: makeSession({ org: { ...makeSession().org, onboardingStep: 'plan' } }),
    });
    expect(html).toContain('Step 3 of 3 / Plan');
    expect(html).toContain('>plan</span>.');
  });
});

describe('workspace step form', () => {
  it('has a Continue button and a billing currency that starts from the country', () => {
    const html = renderGuest(
      createElement(WorkspaceStep, {
        data: onboarding(),
        defaultCountryIso: 'AE',
        onSaved: () => undefined,
      }),
      { session: makeSession() },
    );
    expect(html).toContain('Continue');
    // The platform default country is the UAE: not India, so USD.
    expect(html).toMatch(/<option value="USD" selected/);
  });
});

describe('lock screens (TW-AUTH-016 / 015)', () => {
  const suspended = makeSession({
    landing: 'dashboard',
    flags: {
      suspended: true,
      emailUnverified: false,
      emailBlocked: false,
      mfaEnrolmentRequired: false,
      passwordChangeRequired: false,
    },
  });

  it('the suspended screen is a standalone card that says the person can still sign in', () => {
    const html = renderGuest(createElement(SuspendedView), { session: suspended });
    expect(html).toContain('Your account is');
    expect(html).toContain('>suspended</span>');
    expect(html).toContain('Hi Asha Rao');
    expect(html).toContain('You can still sign in');
    expect(html).toContain('Sign out');
    // No top bar or showcase panel: the person is locked out of everything else.
    expect(html).not.toContain('lg:grid-cols-[1fr_540px]');
    expect(html).not.toContain('<header');
  });

  it('the verify-email screen shows the address, resend and sign out', () => {
    const html = renderGuest(createElement(VerifyEmailRequiredView), {
      session: makeSession({
        landing: 'dashboard',
        flags: {
          suspended: false,
          emailUnverified: true,
          emailBlocked: true,
          mfaEnrolmentRequired: false,
          passwordChangeRequired: false,
        },
      }),
    });
    expect(html).toContain('Please');
    expect(html).toContain('>verify your email</span>');
    expect(html).toContain('asha@acme.test');
    expect(html).toContain('Resend verification email');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('<header');
  });

  it('both render in Arabic without a missing message', () => {
    const a = renderGuest(createElement(SuspendedView), { session: suspended, locale: 'ar' });
    expect(a).not.toContain('[[');
  });
});
