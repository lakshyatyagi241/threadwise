import type { BookingType } from '../api/schemas';

export type TypeStatusFilter = 'all' | 'active' | 'paused';

/** The booking types that match a search (name, slug, description) and a status filter, in the order given. */
export function filterTypes(
  types: readonly BookingType[],
  q: string,
  status: TypeStatusFilter,
): BookingType[] {
  const term = q.trim().toLowerCase();
  return types.filter((t) => {
    if (status === 'active' && !t.isActive) return false;
    if (status === 'paused' && t.isActive) return false;
    if (!term) return true;
    return [t.name, t.slug, t.description ?? ''].some((v) => v.toLowerCase().includes(term));
  });
}
