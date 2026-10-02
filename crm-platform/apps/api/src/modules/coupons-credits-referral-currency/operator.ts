import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';

/** The platform operator making the call (the operator guard has already authenticated them). */
export function operatorId(): number {
  const id = RequestContextStore.require().actorId;
  if (!id) throw AppError.unauthenticated();
  return id;
}

/** `%`, `_` and `\` in a typed search are literals, not wildcards (Reference passed them through, TW-CPN-001). */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Opaque keyset cursors over one sortable key (a coupon id, a currency code). */
export const encodeKey = (key: string | number): string =>
  Buffer.from(String(key), 'utf8').toString('base64url');
export function decodeKey(raw: string): string {
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  if (!text) throw AppError.validation('Invalid pagination cursor');
  return text;
}
