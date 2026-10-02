/**
 * Where the plan step of onboarding gets its credits explainer and its "Top up" link (TW-AUTH-009, TW-CPN-014). The billing
 * domains know the real values (the flat message price, the platform currency, the first credit package), the auth domain does not
 * and must not import them, so it asks through this port; whichever module provides the token answers. Without a provider the
 * defaults below apply, and the `onboarding.billing` platform setting still overrides either.
 */
export interface OnboardingBillingHints {
  creditsPerMessage?: number;
  defaultCurrency?: string;
  /** A same-site path. */
  topUpUrl?: string;
}

export interface OnboardingBillingSource {
  hints(): Promise<OnboardingBillingHints>;
}

export const ONBOARDING_BILLING_SOURCE = Symbol('ONBOARDING_BILLING_SOURCE');
