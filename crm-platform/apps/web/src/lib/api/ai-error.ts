import { ApiError } from './errors';

/**
 * Which sentence an "Build with AI" failure gets. The campaign text, the campaign picture and the template draft all answer
 * with the same `CAMP_AI_*` problem codes (the branch is on `code`, never on the message); each screen words them in its own
 * message namespace under the keys below.
 */
export type AiErrorKind =
  | 'noKey'
  | 'limitReached'
  | 'providerFailed'
  | 'badJson'
  | 'imageRefused'
  | 'invalid'
  | 'forbidden'
  | 'network'
  | 'failed';

export function aiErrorKind(e: unknown): AiErrorKind {
  if (!(e instanceof ApiError)) return 'network';
  switch (e.code) {
    case 'CAMP_AI_NO_KEY':
      return 'noKey';
    case 'CAMP_AI_LIMIT_REACHED':
      return 'limitReached';
    case 'CAMP_AI_PROVIDER_FAILED':
      return 'providerFailed';
    case 'CAMP_AI_BAD_JSON':
      return 'badJson';
    case 'CAMP_AI_IMAGE_REFUSED':
      return 'imageRefused';
    case 'VALIDATION_FAILED':
      return 'invalid';
    case 'FORBIDDEN':
      return 'forbidden';
    default:
      return e.status === 403 ? 'forbidden' : 'failed';
  }
}
