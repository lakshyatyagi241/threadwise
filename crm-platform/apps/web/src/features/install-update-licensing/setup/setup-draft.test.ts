import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERROR_CODES, setupPrerequisiteKeys } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import {
  SETUP_STEPS,
  classifyFailure,
  emptyDraft,
  firstInvalidStep,
  toRequest,
  validateStep,
  type SetupDraft,
} from './setup-draft';

const good: SetupDraft = {
  ...emptyDraft('Asia/Kolkata'),
  setupToken: 'x'.repeat(32),
  fullName: 'Asha Rao',
  email: 'Owner@Example.com',
  password: 'Zq7!hello-World',
  confirm: 'Zq7!hello-World',
  orgName: 'Acme',
  slug: 'acme',
};

describe('validateStep', () => {
  it('accepts a complete draft on every step', () => {
    expect(firstInvalidStep(good)).toBeNull();
  });
  it('flags a short token, weak or mismatched password, bad slug and timezone', () => {
    expect(validateStep('token', { ...good, setupToken: 'short' }).setupToken).toBe('tokenLength');
    expect(validateStep('operator', { ...good, password: 'weak', confirm: 'weak' }).password).toBe(
      'passwordWeak',
    );
    expect(validateStep('operator', { ...good, confirm: 'other' }).confirm).toBe(
      'passwordMismatch',
    );
    expect(validateStep('organization', { ...good, slug: 'A b' }).slug).toBe('slug');
    expect(validateStep('organization', { ...good, timezone: 'Mars/Base' }).timezone).toBe(
      'timezone',
    );
  });
  it('rejects a password that contains the person name', () => {
    const d = { ...good, password: 'Asha-Rao#2024xx', confirm: 'Asha-Rao#2024xx' };
    expect(validateStep('operator', d).password).toBe('passwordWeak');
  });
});

describe('toRequest', () => {
  it('trims, lowercases the email and nests the fields', () => {
    const r = toRequest({ ...good, setupToken: `  ${good.setupToken} ` });
    expect(r.setupToken).toBe(good.setupToken);
    expect(r.operator.email).toBe('owner@example.com');
    expect(r.organization).toMatchObject({ slug: 'acme', timezone: 'Asia/Kolkata', locale: 'en' });
  });
});

describe('classifyFailure', () => {
  const api = (code: string, status = 400, fieldErrors: Array<{ path: string }> = []) =>
    new ApiError(
      status,
      code,
      't',
      undefined,
      fieldErrors.map((f) => ({ ...f, message: 'm' })),
    );

  it('maps setup codes', () => {
    expect(classifyFailure(api(ERROR_CODES.SETUP_TOKEN_INVALID, 403)).kind).toBe('token');
    expect(classifyFailure(api(ERROR_CODES.SETUP_DISABLED, 403)).kind).toBe('disabled');
    expect(classifyFailure(api(ERROR_CODES.SETUP_ALREADY_COMPLETED, 409)).kind).toBe('completed');
    expect(classifyFailure(api(ERROR_CODES.AUTH_SLUG_TAKEN, 409)).kind).toBe('slugTaken');
  });
  it('sends a field-level validation failure back to its step', () => {
    const f = classifyFailure(
      api(ERROR_CODES.VALIDATION_FAILED, 422, [{ path: 'operator.password' }]),
    );
    expect(f).toMatchObject({ kind: 'fields', step: 'operator' });
  });
  it('treats anything else as unknown', () => {
    expect(classifyFailure(new Error('boom')).kind).toBe('unknown');
  });
});

describe('messages', () => {
  const root = JSON.parse(
    readFileSync(join(process.cwd(), 'messages', 'en', 'install-update-licensing.json'), 'utf8'),
  ) as { 'install-update-licensing': { setup: Record<string, Record<string, unknown>> } };
  const setup = root['install-update-licensing'].setup;

  it('has a label for every step, prerequisite and field error the form can show', () => {
    for (const s of SETUP_STEPS) expect(setup.steps![s]).toBeTypeOf('string');
    for (const k of setupPrerequisiteKeys) expect(setup.prerequisites![k]).toBeTypeOf('string');
    for (const k of [
      'tokenWrong',
      'tokenLength',
      'slugTaken',
      'required',
      'email',
      'passwordWeak',
      'passwordMismatch',
      'orgName',
      'slug',
      'timezone',
      'locale',
      'unexpected',
    ])
      expect(setup.errors![k]).toBeTypeOf('string');
  });
});
