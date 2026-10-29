import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { failureNotice } from './wa-form-notice';

describe('failureNotice (a form that cannot publish without a direct WhatsApp connection)', () => {
  it('marks the no-connection error so the notice points to the channels', () => {
    const err = new ApiError(422, 'WFL_FORM_NO_WABA_CREDENTIALS', 'No connected number');
    expect(failureNotice(err, 'No connected number')).toEqual({
      tone: 'danger',
      text: 'No connected number',
      connect: true,
    });
  });

  it('leaves every other failure as a plain danger notice', () => {
    const other = new ApiError(409, 'ROW_VERSION_CONFLICT', 'changed elsewhere');
    expect(failureNotice(other, 'changed elsewhere').connect).toBe(false);
    expect(failureNotice(new Error('network'), 'network').connect).toBe(false);
  });
});
