import { AppError } from '../../../../common/errors/app-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

/** Laravel's `{id}` route was numeric: anything that is not an id of ours simply does not match a row, so it is a 404, never a 400. */
export function uuidOrNotFound(id: string, resource: string): string {
  if (!isUuid(id)) throw AppError.notFound(resource);
  return id.toLowerCase();
}

/** WaDesk's `$request->has(key)`: a key sent as null still counts as sent, which is how a client clears a field. */
export const has = (raw: unknown, key: string): boolean =>
  raw !== null && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, key);
