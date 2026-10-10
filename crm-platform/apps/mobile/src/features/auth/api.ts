import {
  authenticatedSchema,
  loginResponseSchema,
  passwordLoginResponseSchema,
  passwordPolicyHintSchema,
  registrationConfigResponseSchema,
  signupResendOtpResponseSchema,
  signupResponseSchema,
  type LoginRequest,
  type MfaLoginRequest,
  type SelectWorkspaceRequest,
  type SignupRequest,
  type SignupResendOtpRequest,
  type SignupVerifyOtpRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind sign-in and sign-up, in one place. Request shapes come from `@crm/contracts`, so a field the API renames breaks
 * this app's typecheck in the same commit. The public doors send no bearer token (`auth: false`).
 */

export const signInWithPassword = (body: LoginRequest) =>
  apiFetch('/v2/auth/login', {
    method: 'POST',
    body,
    schema: passwordLoginResponseSchema,
    auth: false,
  });

export const signInWithMfa = (body: MfaLoginRequest) =>
  apiFetch('/v2/auth/login/mfa', {
    method: 'POST',
    body,
    schema: loginResponseSchema,
    auth: false,
  });

export const signInToWorkspace = (body: SelectWorkspaceRequest) =>
  apiFetch('/v2/auth/login/workspace', {
    method: 'POST',
    body,
    schema: passwordLoginResponseSchema,
    auth: false,
  });

/** The public settings that shape the guest screens: is sign-up open, is a WhatsApp code asked for, the legal links, the brand name. */
export const fetchRegistrationConfig = (signal?: AbortSignal) =>
  apiFetch('/v2/auth/registration-config', {
    schema: registrationConfigResponseSchema,
    auth: false,
    signal,
  });

/** The password rules in force right now (minimum length, mixed case, number, symbol). */
export const fetchPasswordPolicy = (signal?: AbortSignal) =>
  apiFetch('/v2/auth/password-policy', { schema: passwordPolicyHintSchema, auth: false, signal });

/** Creates the workspace and its first user. Answers with a session, or with `otp_required` when a WhatsApp code must be confirmed first. */
export const signUp = (body: SignupRequest) =>
  apiFetch('/v2/auth/signup', {
    method: 'POST',
    body,
    schema: signupResponseSchema,
    auth: false,
  });

export const verifySignUpOtp = (body: SignupVerifyOtpRequest) =>
  apiFetch('/v2/auth/signup/verify-otp', {
    method: 'POST',
    body,
    schema: authenticatedSchema,
    auth: false,
  });

export const resendSignUpOtp = (body: SignupResendOtpRequest) =>
  apiFetch('/v2/auth/signup/resend-otp', {
    method: 'POST',
    body,
    schema: signupResendOtpResponseSchema,
    auth: false,
  });
