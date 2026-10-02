import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { idleLoginTarget } from './idle-redirect';

const idle = (minutes?: string) =>
  new ApiError(401, 'UNAUTHENTICATED', 'Session ended', 'req-1', [
    { path: 'reason', message: 'idle' },
    ...(minutes ? [{ path: 'idleMinutes', message: minutes }] : []),
  ]);

describe('idleLoginTarget (browser calls that find the session ended for inactivity)', () => {
  it('sends the person to sign-in with the reason, the limit and the page they were on', () => {
    expect(idleLoginTarget(idle('30'), '/contacts?tab=all')).toBe(
      '/login?expired=idle&minutes=30&next=%2Fcontacts%3Ftab%3Dall',
    );
  });

  it('omits next when the page is the home page or not worth returning to', () => {
    expect(idleLoginTarget(idle('15'), '/')).toBe('/login?expired=idle&minutes=15');
    expect(idleLoginTarget(idle('15'), '/login')).toBe('/login?expired=idle&minutes=15');
    expect(idleLoginTarget(idle('15'), null)).toBe('/login?expired=idle&minutes=15');
  });

  it('falls back to the plain expired notice when the API sent no usable limit', () => {
    expect(idleLoginTarget(idle(), '/inbox')).toBe('/login?expired=1&next=%2Finbox');
    expect(idleLoginTarget(idle('soon'), '/inbox')).toBe('/login?expired=1&next=%2Finbox');
    expect(idleLoginTarget(idle('0'), '/inbox')).toBe('/login?expired=1&next=%2Finbox');
  });

  it('ignores every other failure, including a 401 that is not an idle timeout', () => {
    expect(idleLoginTarget(new ApiError(401, 'UNAUTHENTICATED', 'x'), '/inbox')).toBeNull();
    expect(idleLoginTarget(new ApiError(403, 'FORBIDDEN', 'x'), '/inbox')).toBeNull();
    expect(
      idleLoginTarget(
        new ApiError(403, 'FORBIDDEN', 'x', undefined, [{ path: 'reason', message: 'idle' }]),
        '/inbox',
      ),
    ).toBeNull();
    expect(idleLoginTarget(new Error('network'), '/inbox')).toBeNull();
  });

  it('never carries an external or API address as next', () => {
    expect(idleLoginTarget(idle('30'), '//evil.example/x')).toBe('/login?expired=idle&minutes=30');
    expect(idleLoginTarget(idle('30'), '/api/v2/contacts')).toBe('/login?expired=idle&minutes=30');
  });
});
