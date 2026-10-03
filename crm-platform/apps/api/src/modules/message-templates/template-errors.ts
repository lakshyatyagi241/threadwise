import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';

/**
 * Meta's refusal of a template call, in words an operator can act on (WaDesk `errorHint`, WD-TPL-025 rule 9). Meta's own
 * reason is always kept after the hint, and the numeric code is never dropped.
 */
export interface TemplateCallFailure {
  message: string;
  /** Network failure, 5xx or a throttle: the same call may well work in a minute, so the row is not marked rejected. */
  retryable: boolean;
}

function hintFor(err: WabaApiError): string | null {
  switch (err.code) {
    case 190:
      return 'Meta token expired or invalid. Reconnect this WhatsApp number, then retry.';
    case 200:
      return 'The token is missing the whatsapp_business_management permission. Generate a new System User token with it, then retry.';
    case 100:
      return err.missingBusinessManagement
        ? 'The token is missing the whatsapp_business_management permission.'
        : 'Bad parameter';
    case 132000:
      return 'The number of variables does not match the sample values.';
    case 132001:
      return 'This language is not supported for the template.';
    case 132005:
      return 'Meta cannot find this template.';
    case 132007:
      return 'A template with this name already exists for a different language.';
    case 192:
      return /limit|quota|exceed/i.test(err.message)
        ? "Template exceeds your WhatsApp account's template quota. Delete old templates first."
        : null;
    default:
      return err.subcode === 1349174
        ? 'The token is missing the whatsapp_business_management permission.'
        : null;
  }
}

export function describeTemplateFailure(e: unknown): TemplateCallFailure {
  if (!(e instanceof WabaApiError))
    return { message: e instanceof Error ? e.message : String(e), retryable: false };
  const hint = hintFor(e);
  const theirs = e.userMessage ?? e.message;
  const message = hint ? `${hint} (${theirs})` : theirs;
  return { message, retryable: e.retryable };
}

/** A failed Meta call as a problem+json error: a throttle or outage is 503 (try again), a refusal is 422 with Meta's reason. */
export function providerProblem(what: string, e: unknown): AppError {
  const f = describeTemplateFailure(e);
  return f.retryable
    ? new AppError(
        ERROR_CODES.WABA_PROVIDER_UNAVAILABLE,
        `${what}: ${f.message}`,
        HttpStatus.SERVICE_UNAVAILABLE,
      )
    : new AppError(
        ERROR_CODES.TPL_META_REJECTED,
        `${what}: ${f.message}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
}
