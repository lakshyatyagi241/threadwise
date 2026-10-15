import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, iceServerSchema, type IceServer } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { WabaApiError } from '../../infra/providers/whatsapp-cloud-api-waba/waba-errors';
import type { WabaConnection } from '../../infra/providers/whatsapp-cloud-api-waba/waba-admin.port';
import { WabaConnectService } from '../whatsapp-cloud-api-waba';
import { metaReason, reasonDetail } from './calling-meta-errors';
import type { CallsRepository, NumberRow } from './calls.repository';

export const unprocessable = (
  code: keyof typeof ERROR_CODES,
  message: string,
  details?: Array<{ path: string; message: string }>,
) => new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY, details);

export const notFound = (code: keyof typeof ERROR_CODES, what: string) =>
  new AppError(ERROR_CODES[code], `${what} not found`, HttpStatus.NOT_FOUND);

/** Meta appends "(code N[/sub], trace X)" to its sentence; the trace id is for logs, never for the person reading the toast. */
const stripMetaSuffix = (text: string): string =>
  text.replace(/\s*\(code \d+(?:\/\d+)?(?:, trace [\w-]+)?\)\s*$/, '').trim();

/** Meta code 138009: too many call-permission requests to the same customer in the window. */
const PERMISSION_REQUEST_LIMIT = 138009;

/**
 * Meta's reason, as a refusal the caller can show. `prefix` says what was being asked ("Meta refused permission_request"). The problem
 * carries a stable `reason` (EXT-CALL-009) that the web turns into words; `message` stays Meta's own sentence for logs and for a reason
 * that is `unknown`.
 */
export function refused(err: unknown, prefix: string): AppError {
  if (err instanceof WabaApiError) {
    const reason = metaReason(err);
    if (err.code === PERMISSION_REQUEST_LIMIT) {
      return unprocessable(
        'CALL_META_REFUSED',
        'WhatsApp limits how often you can ask this customer for call permission. Try again later.',
        reasonDetail(reason),
      );
    }
    return unprocessable(
      'CALL_META_REFUSED',
      `${prefix} (${err.status}): ${stripMetaSuffix(err.userMessage ?? err.message)}`,
      reasonDetail(reason),
    );
  }
  return unprocessable(
    'CALL_META_REFUSED',
    `${prefix}: ${err instanceof Error ? err.message : 'unknown error'}`,
    reasonDetail('unknown'),
  );
}

/** The ambient workspace and person of an HTTP request. */
export const caller = (): { orgId: number; userId: number | null } => {
  const c = RequestContextStore.require();
  return { orgId: c.orgId, userId: c.userId ?? null };
};

export interface UsableNumber {
  number: NumberRow;
  conn: WabaConnection;
}

/**
 * A number of this workspace with a Cloud API connection that can call Meta, read inside the caller's transaction (the Meta call itself
 * is made outside it). 404 when the number is not this workspace's (or is not a Cloud API number); 422 when it has no usable connection.
 */
export async function usableNumber(
  tx: Tx,
  orgId: number,
  repo: CallsRepository,
  waba: WabaConnectService,
  ref: { uuid: string } | { id: number },
): Promise<UsableNumber> {
  const number =
    'uuid' in ref
      ? await repo.numberByUuid(tx, orgId, ref.uuid)
      : await repo.numberById(tx, orgId, ref.id);
  if (!number) throw notFound('CALL_NUMBER_NOT_FOUND', 'Number');
  const resolved = await waba.resolveConnection(tx, orgId, { id: number.id });
  if (!resolved?.conn || !resolved.conn.phoneNumberId) {
    throw unprocessable(
      'CALL_NUMBER_NOT_CONNECTED',
      'This number has no access token or phone number id. Reconnect it.',
    );
  }
  return { number, conn: resolved.conn };
}

/**
 * The operator's ICE servers from `CALLING_ICE_SERVERS` (a JSON list of `{ urls, username?, credential? }`): an entry that does not
 * fit is dropped, bad JSON gives nothing, and nothing makes the browser use the four public STUN servers. Reference read a window
 * global for this; the list is the operator's, so it comes from the environment (TURN credentials never come from a request).
 */
export function parseIceServersEnv(text: string | undefined | null): IceServer[] {
  if (!text?.trim()) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = iceServerSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}
