import { describe, expect, it } from 'vitest';
import { isRetryableVendorError } from '../../../src/modules/message-templates/template-ai-rules';

describe('isRetryableVendorError (the template builder tries a throttled vendor once more)', () => {
  it('a throttle (429) and a server error (5xx) are worth one more try', () => {
    expect(isRetryableVendorError(new Error('AI provider answered 429'))).toBe(true);
    expect(isRetryableVendorError(new Error('AI provider answered 503'))).toBe(true);
  });

  it('a refusal (a bad key, a bad request) is not', () => {
    expect(isRetryableVendorError(new Error('AI provider answered 401'))).toBe(false);
    expect(isRetryableVendorError(new Error('AI provider answered 400'))).toBe(false);
  });

  it('a timeout or any other failure is not', () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    expect(isRetryableVendorError(timeout)).toBe(false);
    expect(isRetryableVendorError(new Error('no adapter for the AI provider x'))).toBe(false);
    expect(isRetryableVendorError('AI provider answered 429')).toBe(false);
  });
});
