'use client';

import type { PasswordPolicyHint, RegistrationConfigResponse } from '@crm/contracts';
import { SignupStartForm } from './signup-start-form';

/**
 * Sign-up (TW-AUTH-005/006): a thin router over the three-step email-verification flow. This component only
 * ever renders step 1 (collect name/email/phone); the verify-email and password steps live on their own
 * routes (`/signup/verify-email`, `/signup/password`), each a page wrapping its own step component, the same
 * way `/login` and `/verify-otp` are split.
 */
export interface SignupFormProps {
  config: RegistrationConfigResponse;
  /** The code to prefill: `?ref=` from the address, else the 30-day cookie, resolved on the server. */
  referral: string;
  /** The live password rules, for the hint. Null when they could not be read. Unused by step 1. */
  passwordPolicy: PasswordPolicyHint | null;
  /** Coming back from a later step: refill the non-secret answers kept in this tab. Unused by step 1. */
  restore?: boolean;
  /** The workspace address was taken while the code was being checked. Unused by step 1 (no address field). */
  slugConflict?: boolean;
}

export function SignupForm(props: SignupFormProps) {
  return <SignupStartForm config={props.config} />;
}
