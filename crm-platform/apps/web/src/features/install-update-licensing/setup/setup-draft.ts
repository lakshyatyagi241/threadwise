import {
  ERROR_CODES,
  evaluateSetupPassword,
  isValidLocale,
  isValidTimezone,
  orgSlugSchema,
  SETUP_TOKEN_MIN_LENGTH,
  type SetupBootstrapRequest,
  type SetupPasswordRule,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * The setup form's state and rules (WD-INST-002, -007, -008). The same rules run on the server in the one call that
 * writes; checking here only saves a round trip and names the problem next to the field.
 */
export const SETUP_STEPS = ['token', 'operator', 'organization', 'review'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export interface SetupDraft {
  setupToken: string;
  fullName: string;
  email: string;
  password: string;
  confirm: string;
  orgName: string;
  slug: string;
  /** The person typed a slug: stop deriving it from the workspace name. */
  slugEdited: boolean;
  timezone: string;
  locale: string;
}

export const emptyDraft = (timezone = 'UTC'): SetupDraft => ({
  setupToken: '',
  fullName: '',
  email: '',
  password: '',
  confirm: '',
  orgName: '',
  slug: '',
  slugEdited: false,
  timezone,
  locale: 'en',
});

/** Message key under `install-update-licensing.setup.errors`, or nothing. One entry per field with a problem. */
export type FieldErrors = Partial<Record<keyof SetupDraft, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function passwordRules(draft: SetupDraft): SetupPasswordRule[] {
  return evaluateSetupPassword(draft.password, { email: draft.email, fullName: draft.fullName });
}

export function validateStep(step: SetupStep, d: SetupDraft): FieldErrors {
  const e: FieldErrors = {};
  if (step === 'token' && d.setupToken.trim().length < SETUP_TOKEN_MIN_LENGTH) {
    e.setupToken = 'tokenLength';
  }
  if (step === 'operator') {
    if (!d.fullName.trim()) e.fullName = 'required';
    if (!EMAIL.test(d.email.trim())) e.email = 'email';
    if (passwordRules(d).length > 0) e.password = 'passwordWeak';
    if (d.confirm !== d.password) e.confirm = 'passwordMismatch';
  }
  if (step === 'organization') {
    if (d.orgName.trim().length < 2) e.orgName = 'orgName';
    if (!orgSlugSchema.safeParse(d.slug).success) e.slug = 'slug';
    if (!isValidTimezone(d.timezone)) e.timezone = 'timezone';
    if (!isValidLocale(d.locale)) e.locale = 'locale';
  }
  return e;
}

/** The first step whose fields have a problem, so "Create" can send the person back to it. */
export function firstInvalidStep(d: SetupDraft): SetupStep | null {
  return SETUP_STEPS.find((s) => Object.keys(validateStep(s, d)).length > 0) ?? null;
}

export function toRequest(d: SetupDraft): SetupBootstrapRequest {
  return {
    setupToken: d.setupToken.trim(),
    operator: {
      fullName: d.fullName.trim(),
      email: d.email.trim().toLowerCase(),
      password: d.password,
    },
    organization: {
      name: d.orgName.trim(),
      slug: d.slug,
      timezone: d.timezone,
      locale: d.locale,
    },
  };
}

export type SetupFailure =
  | { kind: 'token' }
  | { kind: 'disabled' }
  | { kind: 'completed' }
  | { kind: 'prerequisites'; failed: string[] }
  | { kind: 'slugTaken' }
  | { kind: 'fields'; step: SetupStep; fields: FieldErrors }
  | { kind: 'unknown'; requestId?: string };

const FIELD_OF: Array<[prefix: string, field: keyof SetupDraft, step: SetupStep, key: string]> = [
  ['setupToken', 'setupToken', 'token', 'tokenLength'],
  ['operator.password', 'password', 'operator', 'passwordWeak'],
  ['operator.email', 'email', 'operator', 'email'],
  ['operator.fullName', 'fullName', 'operator', 'required'],
  ['organization.slug', 'slug', 'organization', 'slug'],
  ['organization.timezone', 'timezone', 'organization', 'timezone'],
  ['organization.locale', 'locale', 'organization', 'locale'],
  ['organization.name', 'orgName', 'organization', 'orgName'],
];

/** Turns an API problem into what the form should do about it. Branches on `code`, never on the message text. */
export function classifyFailure(error: unknown): SetupFailure {
  if (!(error instanceof ApiError)) return { kind: 'unknown' };
  switch (error.code) {
    case ERROR_CODES.SETUP_TOKEN_INVALID:
      return { kind: 'token' };
    case ERROR_CODES.SETUP_DISABLED:
      return { kind: 'disabled' };
    case ERROR_CODES.SETUP_ALREADY_COMPLETED:
      return { kind: 'completed' };
    case ERROR_CODES.SETUP_PREREQUISITES_FAILED:
      return { kind: 'prerequisites', failed: error.fieldErrors.map((f) => f.path) };
    case ERROR_CODES.AUTH_SLUG_TAKEN:
      return { kind: 'slugTaken' };
    case ERROR_CODES.VALIDATION_FAILED: {
      const hit = FIELD_OF.find(([prefix]) => error.fieldErrors.some((f) => f.path === prefix));
      if (hit) return { kind: 'fields', step: hit[2], fields: { [hit[1]]: hit[3] } };
      return { kind: 'unknown', requestId: error.requestId };
    }
    default:
      return { kind: 'unknown', requestId: error.requestId };
  }
}
