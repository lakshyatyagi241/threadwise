import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../src/common/errors/app-error';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { uploadProblem } from '../../../src/modules/message-templates/template-errors';

describe('uploadProblem', () => {
  it('answers a provider throttle as a 429 that asks for a short wait, not as a refused file', () => {
    const throttled = WabaApiError.fromResponse(403, {
      error: {
        message: 'Application request limit reached',
        code: 4,
        is_transient: true,
        fbtrace_id: 'AAA',
      },
    });
    const out = uploadProblem('Meta did not accept the file', throttled);
    expect(out).toBeInstanceOf(AppError);
    expect(out.code).toBe(ERROR_CODES.RATE_LIMITED);
    expect(out.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(out.message).toMatch(/limiting uploads/);
    expect(out.message).not.toMatch(/did not accept the file/);
  });

  it('keeps the outage answer for a transient failure that is not a throttle', () => {
    const outage = WabaApiError.fromResponse(503, {
      error: { message: 'Service down', is_transient: true, fbtrace_id: 'CCC' },
    });
    const out = uploadProblem('Meta did not accept the file', outage);
    expect(out.code).toBe(ERROR_CODES.WABA_PROVIDER_UNAVAILABLE);
    expect(out.getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('keeps the refusal answer for a file Meta rejects', () => {
    const refusal = WabaApiError.fromResponse(400, {
      error: { message: 'Invalid parameter', code: 100, fbtrace_id: 'DDD' },
    });
    const out = uploadProblem('Meta did not accept the file', refusal);
    expect(out.code).toBe(ERROR_CODES.TPL_META_REJECTED);
    expect(out.getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
  });
});
