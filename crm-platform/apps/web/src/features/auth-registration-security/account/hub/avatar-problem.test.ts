import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { ImageError } from '../../shared/image-downscale';
import { avatarProblem } from './avatar-problem';

const api = (status: number, code: string) => new ApiError(status, code, 'x');

describe('avatarProblem', () => {
  it('passes the browser-side reasons through', () => {
    expect(avatarProblem(new ImageError('type'))).toBe('type');
    expect(avatarProblem(new ImageError('source-too-large'))).toBe('source-too-large');
    expect(avatarProblem(new ImageError('too-large'))).toBe('too-large');
    expect(avatarProblem(new ImageError('decode'))).toBe('decode');
    expect(avatarProblem(new ImageError('encode'))).toBe('encode');
  });

  it('a 413 from the server names the server limit, not the 20 MB browser limit', () => {
    expect(avatarProblem(api(413, 'UNKNOWN'))).toBe('too-large');
  });

  it('maps an ended sign-in (401, 419) and a refusal (403)', () => {
    expect(avatarProblem(api(401, ERROR_CODES.UNAUTHENTICATED))).toBe('expired');
    expect(avatarProblem(api(419, 'UNKNOWN'))).toBe('expired');
    expect(avatarProblem(api(403, ERROR_CODES.FORBIDDEN))).toBe('forbidden');
  });

  it('maps a rejected file', () => {
    expect(avatarProblem(api(422, ERROR_CODES.AUTH_UPLOAD_REJECTED))).toBe('rejected');
    expect(avatarProblem(api(422, ERROR_CODES.VALIDATION_FAILED))).toBe('rejected');
  });

  it('has no sentence for anything else', () => {
    expect(avatarProblem(api(500, 'INTERNAL'))).toBeNull();
    expect(avatarProblem(new Error('boom'))).toBeNull();
    expect(avatarProblem(null)).toBeNull();
  });
});
