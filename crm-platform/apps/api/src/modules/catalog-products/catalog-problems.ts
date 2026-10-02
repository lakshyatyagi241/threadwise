import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { CatalogProviderError } from '../../infra/providers/catalog-products/catalog-provider.port';

/** The details a Meta failure carries to the caller, so the screen can show Meta's code without parsing text. */
export function metaDetails(err: CatalogProviderError): Array<{ path: string; message: string }> {
  const out: Array<{ path: string; message: string }> = [];
  if (err.meta.code !== null) out.push({ path: 'metaCode', message: String(err.meta.code) });
  if (err.meta.subcode !== null)
    out.push({ path: 'metaSubcode', message: String(err.meta.subcode) });
  return out;
}

/** A provider failure on an action that talks to Meta in the background of the request: 502, Meta's message as is. */
export function providerFailure(
  err: CatalogProviderError,
  extra: Array<{ path: string; message: string }> = [],
): AppError {
  return new AppError(
    err.kind === 'meta' ? ERROR_CODES.CAT_META_REJECTED : ERROR_CODES.CAT_PROVIDER_FAILED,
    err.message,
    HttpStatus.BAD_GATEWAY,
    [...metaDetails(err), ...extra],
  );
}

/** The same failure on an action Reference answered with a 422 (import, commerce settings, connect). */
export function providerRefusal(err: CatalogProviderError, message = err.message): AppError {
  return new AppError(
    err.kind === 'meta' ? ERROR_CODES.CAT_META_REJECTED : ERROR_CODES.CAT_PROVIDER_FAILED,
    message,
    HttpStatus.UNPROCESSABLE_ENTITY,
    metaDetails(err),
  );
}

export const notConnected = (): AppError =>
  new AppError(
    ERROR_CODES.CAT_NOT_CONNECTED,
    'No catalog connected.',
    HttpStatus.UNPROCESSABLE_ENTITY,
  );
