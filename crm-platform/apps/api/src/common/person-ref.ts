import type { PersonRef } from '@crm/contracts';

/**
 * A person as a list prints them ({ id, name }, the uuid only). Null when the row has no person left: the user was removed, or the
 * column was never set (a row written before it existed).
 */
export const personOf = (uuid: string | null, name: string | null): PersonRef | null =>
  uuid === null || name === null ? null : { id: uuid, name };
