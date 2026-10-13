import { describe, expect, it } from 'vitest';
import { smsErrorKey } from './api-errors';

describe('SMS error codes', () => {
  it('map the codes the screen words itself to a message key', () => {
    expect(smsErrorKey('SMS_NOT_AVAILABLE')).toBe('connect.api.notAvailable');
    expect(smsErrorKey('SMS_QUOTA_EXCEEDED')).toBe('connect.api.notAvailable');
    expect(smsErrorKey('SMS_SENDER_UNAVAILABLE')).toBe('connect.api.unavailable');
    expect(smsErrorKey('ROW_VERSION_CONFLICT')).toBe('card.changed');
  });

  it('leave every other code, including a provider refusal, to show the server sentence', () => {
    expect(smsErrorKey('SMS_CREDENTIALS_REJECTED')).toBeNull();
    expect(smsErrorKey('VALIDATION_FAILED')).toBeNull();
  });
});
