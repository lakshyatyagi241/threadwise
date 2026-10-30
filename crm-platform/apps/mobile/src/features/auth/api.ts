import {
  authenticatedSchema,
  loginResponseSchema,
  neutralAckSchema,
  passwordLoginResponseSchema,
  passwordPolicyHintSchema,
  phoneLoginChallengeSchema,
  phoneLoginResendResponseSchema,
  registrationConfigResponseSchema,
  signupResendOtpResponseSchema,
  signupResponseSchema,
  type FindWorkspacesRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type MfaLoginRequest,
  type PhoneLoginResendRequest,
  type PhoneLoginStartRequest,
  type PhoneLoginVerifyRequest,
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

/**
 * Sign-in with a mobile number: asks for a code, which goes to the number only when it belongs to an account. The answer is the same
 * either way, so nothing here says whether a number is known.
 */
export const startPhoneSignIn = (body: PhoneLoginStartRequest) =>
  apiFetch('/v2/auth/login/phone', {
    method: 'POST',
    body,
    schema: phoneLoginChallengeSchema,
    auth: false,
  });

export const resendPhoneSignIn = (body: PhoneLoginResendRequest) =>
  apiFetch('/v2/auth/login/phone/resend', {
    method: 'POST',
    body,
    schema: phoneLoginResendResponseSchema,
    auth: false,
  });

/** The code: answers like a password sign-in (a session, a second-factor challenge, or the workspaces to pick from). */
export const verifyPhoneSignIn = (body: PhoneLoginVerifyRequest) =>
  apiFetch('/v2/auth/login/phone/verify', {
    method: 'POST',
    body,
    schema: passwordLoginResponseSchema,
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

/**
 * Emails a password reset link (TW-AUTH-013). The answer is the same whether or not the address belongs to an account, so nothing here
 * says which. The link in the mail opens the web's reset page, where the new password is chosen.
 */
export const requestPasswordReset = (body: ForgotPasswordRequest) =>
  apiFetch('/v2/auth/forgot-password', {
    method: 'POST',
    body,
    schema: neutralAckSchema,
    auth: false,
  });

/** Emails the workspace addresses an email can sign in to, for a person who forgot theirs. Answers the same either way. */
export const requestWorkspaceList = (body: FindWorkspacesRequest) =>
  apiFetch('/v2/auth/find-workspaces', {
    method: 'POST',
    body,
    schema: neutralAckSchema,
    auth: false,
  });
