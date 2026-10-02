import { mfaLoginRequestSchema } from '@crm/contracts';
import { describe, expect, it } from 'vitest';

/** WD-AUTH-030.4: a code pasted as the authenticator shows it ("123 456") is accepted. */
describe('second-factor sign-in request', () => {
  const parse = (v: Record<string, unknown>) =>
    mfaLoginRequestSchema.safeParse({ challengeToken: 'c', ...v });

  it('accepts a code with the spaces an authenticator app shows', () => {
    const ok = parse({ code: '123 456' });
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.code).toBe('123456');
    expect(parse({ code: ' 123456 ' }).success).toBe(true);
  });

  it('still refuses anything that is not six digits', () => {
    expect(parse({ code: '12345' }).success).toBe(false);
    expect(parse({ code: '1234567' }).success).toBe(false);
    expect(parse({ code: '12a456' }).success).toBe(false);
  });

  it('wants exactly one of code and recovery code', () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ code: '123456', recoveryCode: 'AAAAA-BBBBB' }).success).toBe(false);
    expect(parse({ recoveryCode: 'AAAAA-BBBBB' }).success).toBe(true);
  });
});
