import { ERROR_CODES } from '@crm/contracts';
import type { TFunction } from 'i18next';
import { ApiError, CLIENT_ERROR_CODES } from '@/lib/api';
import { attachErrorMessage, sendErrorMessage } from './thread-errors';

// The translator answers with the key, so the test reads which words were chosen.
const t = ((key: string, options?: { code?: string }) =>
  options?.code ? `${key}:${options.code}` : key) as unknown as TFunction;
const refusal = (status: number, code: string) => new ApiError(status, code, 'English text');

describe('sendErrorMessage', () => {
  it('names a template the conversation cannot send', () => {
    expect(sendErrorMessage(refusal(422, ERROR_CODES.INBOX_TEMPLATE_NOT_SENDABLE), t)).toBe(
      'inbox.errors.templateNotSendable',
    );
  });

  it('says why a marketing message to a contact without consent was refused', () => {
    expect(sendErrorMessage(refusal(422, ERROR_CODES.CONSENT_SEND_DENIED), t)).toBe(
      'inbox.errors.consentRequired',
    );
    expect(sendErrorMessage(refusal(422, ERROR_CODES.CONSENT_OPTED_OUT), t)).toBe(
      'inbox.errors.contactOptedOut',
    );
  });

  it('names invalid values instead of the app-wide message', () => {
    expect(sendErrorMessage(refusal(422, ERROR_CODES.VALIDATION_FAILED), t)).toBe(
      'inbox.errors.validation',
    );
  });

  it('adds the code to the app-wide message for an answer it does not know', () => {
    expect(sendErrorMessage(refusal(500, 'INTERNAL_ERROR'), t)).toBe(
      'inbox.errors.withCode:INTERNAL_ERROR',
    );
  });
});

it('does not add a code to a failure that never reached the server', () => {
  expect(sendErrorMessage(new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x'), t)).toBe(
    'errors.network',
  );
});

describe('attachErrorMessage', () => {
  it('says the server cannot be reached when the upload got no answer', () => {
    expect(attachErrorMessage(new ApiError(0, CLIENT_ERROR_CODES.NETWORK, 'x'), t)).toBe(
      'errors.network',
    );
  });

  it('says a file is too large when the server answers 413', () => {
    expect(attachErrorMessage(refusal(413, 'PAYLOAD_TOO_LARGE'), t)).toBe(
      'inbox.attach.serverTooLarge',
    );
  });
});
