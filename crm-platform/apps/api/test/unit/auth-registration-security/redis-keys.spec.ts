import { describe, expect, it } from 'vitest';
import { AuthKeys } from '../../../src/modules/auth/support/redis-keys';

describe('AuthKeys.signupEmailStage', () => {
  it('namespaces by the opaque token, not the email', () => {
    const key = AuthKeys.signupEmailStage('tok_abc123');
    expect(key).toBe('auth:signup-email-stage:tok_abc123');
  });
});
