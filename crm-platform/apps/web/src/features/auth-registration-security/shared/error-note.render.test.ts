import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { renderAccount } from '../account/render-test-utils';
import { ErrorNote } from './error-note';

const lockedError = (seconds?: string) =>
  new ApiError(
    429,
    'AUTH_ACCOUNT_LOCKED',
    'Too many attempts',
    'req-lock',
    seconds ? [{ path: 'retryAfterSeconds', message: seconds }] : [],
  );
const render = (error: unknown, locale: 'en' | 'ar' = 'en') =>
  renderAccount(createElement(ErrorNote, { error }), { locale });

describe('ErrorNote on a lockout (every two-factor screen of the account pane)', () => {
  it('says how many minutes to wait, from the Retry-After the API sent', () => {
    const html = render(lockedError('900'));
    expect(html).toContain('Too many failed attempts. Try again in 15 minutes.');
    expect(html).not.toContain('900 seconds');
  });

  it('uses the singular for one minute and rounds a short wait up to it', () => {
    expect(render(lockedError('60'))).toContain('Try again in 1 minute.');
    expect(render(lockedError('20'))).toContain('Try again in 1 minute.');
  });

  it('still tells the person to wait when no wait was sent', () => {
    expect(render(lockedError())).toContain('Too many failed attempts. Wait a while');
  });

  it('keeps plain rate limits in seconds', () => {
    const limited = new ApiError(429, 'RATE_LIMITED', 'slow', 'req-1', [
      { path: 'retryAfterSeconds', message: '30' },
    ]);
    expect(render(limited)).toContain('Try again in 30 seconds.');
  });

  it('shows the request id so support can trace it', () => {
    expect(render(lockedError('900'))).toContain('req-lock');
  });

  it('is translated', () => {
    expect(render(lockedError('900'), 'ar')).toContain('15 دقيقة');
  });
});
