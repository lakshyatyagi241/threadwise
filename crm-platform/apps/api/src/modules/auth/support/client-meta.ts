import { RequestContextStore } from '../../../common/context/request-context';

export interface ClientMeta {
  ip?: string | null;
  userAgent?: string | null;
}

/** Where the request came from, as the request-context middleware recorded it. */
export const clientMeta = (): ClientMeta => {
  const ctx = RequestContextStore.peek();
  return { ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null };
};
