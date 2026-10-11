import {
  loginResponseSchema,
  passwordLoginResponseSchema,
  type LoginRequest,
  type MfaLoginRequest,
  type SelectWorkspaceRequest,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind sign-in, in one place. Request shapes come from `@crm/contracts`, so a field the API renames breaks this
 * app's typecheck in the same commit. The public doors send no bearer token (`auth: false`).
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
