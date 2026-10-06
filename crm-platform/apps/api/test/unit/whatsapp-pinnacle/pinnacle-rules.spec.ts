import { describe, expect, it } from 'vitest';
import {
  accountPayload,
  creditLinePayload,
  embeddedPayload,
  isPinnacleSuccess,
  pinnacleReason,
  readAccount,
} from '../../../src/infra/providers/whatsapp-cloud-api-waba/pinnacle-partner.rules';

describe('payloads follow the partner API', () => {
  it('account', () => {
    expect(
      accountPayload({
        templateNamespace: 'ns_1',
        wabaId: '100',
        wabaNumber: '+91 73857 11141',
        email: 'a@b.co',
        firstName: 'Asha',
        lastName: 'Rao',
        mobileNo: '9199',
      }),
    ).toEqual({
      template_namespace: 'ns_1',
      waba_id: '100',
      mobileno: '9199',
      firstname: 'Asha',
      lastname: 'Rao',
      billingname: 'Asha Rao',
      waba_number: ['+91 73857 11141'],
      email: 'a@b.co',
    });
  });
  it('embedded details always ask for mm lite', () => {
    expect(
      embeddedPayload({
        wabaId: '1',
        phoneNumberId: '2',
        configId: '3',
        accessToken: 't',
        solutionId: '4',
        businessId: null,
      }),
    ).toEqual({
      waba_id: '1',
      phone_numberid: '2',
      config_id: '3',
      access_token: 't',
      mmlite: 1,
      solution_id: '4',
      business_id: null,
    });
  });
  it('credit line defaults to INR', () => {
    expect(creditLinePayload({ businessId: 'b', wabaId: 'w' })).toEqual({
      business_id: 'b',
      waba_currency: 'INR',
      waba_id: 'w',
    });
  });
});

describe('reading answers', () => {
  it.each([
    [{ code: 200 }, true],
    [{ status: 'Success' }, true],
    [{ code: 400, status: 'error' }, false],
    [{ status: 'failed' }, false],
    ['nope', false],
    [null, false],
  ])('success of %j is %s', (body, ok) => expect(isPinnacleSuccess(body)).toBe(ok));

  it('reads the client account only from a success that carries an apikey', () => {
    expect(
      readAccount({ code: 200, data: { apikey: ' k-1 ', username: 'u', password: 'p' } }),
    ).toEqual({ apiKey: 'k-1', username: 'u', password: 'p' });
    expect(readAccount({ code: 200, data: { username: 'u' } })).toBeNull();
    expect(readAccount({ code: 400, data: { apikey: 'k' } })).toBeNull();
  });

  it('gives Pinnacle its own words and nothing else', () => {
    expect(pinnacleReason({ message: ' Already registered ', data: { apikey: 'SECRET' } })).toBe(
      'Already registered',
    );
    expect(pinnacleReason({ data: { apikey: 'SECRET' } })).toBe('Pinnacle refused the request');
  });
});
