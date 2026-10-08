import { describe, expect, it } from 'vitest';
import { HttpStatus } from '@nestjs/common';
import {
  ERROR_CODES,
  roundMoney2,
  v1CreateContactSchema,
  v1CreateDealSchema,
  v1UpdateContactSchema,
  v1UpdateDealSchema,
} from '@crm/contracts';
import type { Problem } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { composeV1Phone } from '../../../src/modules/developer-rest-api-v1/resources/crm/contacts/phone';
import { toV1DealError } from '../../../src/modules/developer-rest-api-v1/resources/crm/deals/deals.service';
import { toV1Error } from '../../../src/modules/developer-rest-api-v1/http/v1-error-renderer';

describe('phone composition (Reference composeMobile + toE164)', () => {
  it('prefixes the country code to a national number that happens to start with its digits', () => {
    expect(composeV1Phone('9162915526', '+91')).toBe('+919162915526');
  });
  it('keeps a number that already starts with the code as sent', () => {
    expect(composeV1Phone('+919162915526', '+91')).toBe('+919162915526');
    expect(composeV1Phone('+91 91629 15526', '+91')).toBe('+919162915526');
  });
  it('works without a country code: digits with a plus', () => {
    expect(composeV1Phone('919162915526', null)).toBe('+919162915526');
    expect(composeV1Phone('+44 7700 900123', undefined)).toBe('+447700900123');
    expect(composeV1Phone('919162915526', '')).toBe('+919162915526');
  });
  it('takes a country code written without the plus', () => {
    expect(composeV1Phone('98123 45678', '91')).toBe('+919812345678');
    // Reference compares the strings as sent: "91" is a prefix of "9162915526", so nothing is added.
    expect(composeV1Phone('9162915526', '91')).toBe('+9162915526');
  });
  it('drops spaces, dashes and parentheses', () => {
    expect(composeV1Phone('(98123) 45-678', '+91')).toBe('+919812345678');
    expect(composeV1Phone('  98123.45678 ', '+91')).toBe('+919812345678');
  });
  it('refuses what is not a number: non-digits only, blank, too long, too short', () => {
    expect(composeV1Phone('abc', '+91')).toBeNull();
    expect(composeV1Phone('---', null)).toBeNull();
    expect(composeV1Phone('   ', '+91')).toBeNull();
    expect(composeV1Phone(null, '+91')).toBeNull();
    expect(composeV1Phone('1234567890123456', '+91')).toBeNull();
    expect(composeV1Phone('12', null)).toBeNull();
  });
  it('the contact schemas refuse a phone over 32 characters', () => {
    expect(v1CreateContactSchema.safeParse({ name: 'a', phone: '1'.repeat(33) }).success).toBe(
      false,
    );
    expect(v1UpdateContactSchema.safeParse({ phone: '1'.repeat(33) }).success).toBe(false);
    expect(v1CreateContactSchema.safeParse({ name: 'a', phone: '1'.repeat(32) }).success).toBe(
      true,
    );
  });
});

describe('deal value rounding (PHP round, half up, 2 decimals)', () => {
  it('rounds the third decimal half up and leaves up to two decimals alone', () => {
    expect(roundMoney2('12.345')).toBe('12.35');
    expect(roundMoney2('12.344')).toBe('12.34');
    expect(roundMoney2('0.005')).toBe('0.01');
    expect(roundMoney2('0.004')).toBe('0.00');
    expect(roundMoney2('1.005')).toBe('1.01');
    expect(roundMoney2('1.0049999')).toBe('1.00');
    expect(roundMoney2('99.995')).toBe('100.00');
    expect(roundMoney2('99999999.004')).toBe('99999999.00');
    expect(roundMoney2('5')).toBe('5');
    expect(roundMoney2('5.5')).toBe('5.5');
    expect(roundMoney2('5.50')).toBe('5.50');
    expect(roundMoney2('0.1234567')).toBe('0.12');
  });
  it('the request schemas round a number or a string before the service sees it, and judge the cap on the raw value', () => {
    const create = (value: unknown) => v1CreateDealSchema.safeParse({ title: 't', value });
    expect(create(12.345)).toMatchObject({ success: true, data: { value: '12.35' } });
    expect(create('0.005')).toMatchObject({ success: true, data: { value: '0.01' } });
    expect(create('0.004')).toMatchObject({ success: true, data: { value: '0.00' } });
    expect(create('99999999.004').success).toBe(false);
    expect(create(-0.001).success).toBe(false);
    expect(v1UpdateDealSchema.parse({ value: '2.675' }).value).toBe('2.68');
  });
});

describe('deal errors as Reference words them', () => {
  const problem = (err: AppError): Problem =>
    ({
      code: err.code,
      status: err.getStatus(),
      title: 'x',
      detail: err.message,
      errors: err.details,
    }) as unknown as Problem;

  it('reports an owner the service refuses on owner_user_id as a validation failure', () => {
    const src = new AppError(
      ERROR_CODES.DEAL_OWNER_INVALID,
      'The owner must be an active member of this workspace.',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'ownerId', message: 'abc' }],
    );
    const { status, body } = toV1Error(problem(toV1DealError(src) as AppError));
    expect(status).toBe(422);
    expect(body.error.code).toBe('validation_failed');
    expect(Object.keys(body.error.details ?? {})).toEqual(['owner_user_id']);
  });

  it('renames camelCase detail paths to the request field names', () => {
    const src = AppError.validation('x', [
      { path: 'stageId', message: 'a' },
      { path: 'lostReasonId', message: 'b' },
      { path: 'expectedCloseDate', message: 'c' },
    ]);
    const out = toV1DealError(src) as AppError;
    expect(out.details?.map((d) => d.path)).toEqual([
      'stage_id',
      'lost_reason',
      'expected_close_date',
    ]);
  });

  it('answers the stage codes as unprocessable (422) with the reason in the message', () => {
    for (const code of [ERROR_CODES.DEAL_STAGE_MISMATCH, ERROR_CODES.DEAL_NO_OPEN_STAGE]) {
      const src = new AppError(code, 'Pipeline has no stages.', HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'stageId', message: 'm' },
      ]);
      const { status, body } = toV1Error(problem(toV1DealError(src) as AppError));
      expect(status).toBe(422);
      expect(body.error.code).toBe('unprocessable');
      expect(body.error.message).toBe('Pipeline has no stages.');
      expect(Object.keys(body.error.details ?? {})).toEqual(['stage_id']);
    }
  });

  it('turns an amount the service refuses into a validation failure of value', () => {
    const src = new AppError(
      ERROR_CODES.DEAL_VALUE_INVALID,
      'bad',
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'value', message: 'too many decimals' }],
    );
    const { body } = toV1Error(problem(toV1DealError(src) as AppError));
    expect(body.error.code).toBe('validation_failed');
    expect(Object.keys(body.error.details ?? {})).toEqual(['value']);
  });
});
