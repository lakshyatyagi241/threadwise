import { describe, expect, it } from 'vitest';
import { WabaApiError } from '../../../src/infra/providers/whatsapp-cloud-api-waba/waba-errors';
import { refused } from '../../../src/modules/calling-voice/calling-support';

const metaError = (code: number, message: string) =>
  WabaApiError.fromResponse(400, {
    error: { code, message, fbtrace_id: 'A69TaDiJUGtqIG0QUn7O3k2' },
  });

describe('refused', () => {
  it('never shows the Meta trace id', () => {
    const err = refused(metaError(100, 'Invalid parameter'), 'Meta refused call');
    expect(err.message).toContain('Invalid parameter');
    expect(err.message).not.toContain('trace');
    expect(err.message).not.toContain('A69Ta');
  });

  it('gives the permission-request limit its own sentence', () => {
    const err = refused(
      metaError(138009, 'Unable to send Call permission request'),
      'Meta refused permission_request',
    );
    expect(err.message).toBe(
      'WhatsApp limits how often you can ask this customer for call permission. Try again later.',
    );
  });
});
