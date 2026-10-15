import type { ListEmailTemplatesQuery } from '@crm/contracts';

/** The list's filters, kept in the address so a view can be shared and survives a reload. */
export interface TemplateFilters {
  q: string;
  scope: 'all' | 'shared' | 'mine';
  purpose: '' | 'general' | 'marketing';
  status: 'active' | 'archived' | 'all';
  category: string;
}

export const DEFAULT_FILTERS: TemplateFilters = {
  q: '',
  scope: 'all',
  purpose: '',
  status: 'active',
  category: '',
};

export const SCOPES = ['all', 'shared', 'mine'] as const;
export const PURPOSES = ['general', 'marketing'] as const;
export const STATUSES = ['active', 'archived', 'all'] as const;

const pick = <T extends string>(raw: string | null, allowed: readonly T[], fallback: T): T => {
  const value = raw ?? '';
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
};

/** Reads the filters from the address; anything unknown falls back to the default, so a hand-edited link never breaks the page. */
export function parseFilters(search: { get(key: string): string | null }): TemplateFilters {
  return {
    q: (search.get('q') ?? '').slice(0, 100),
    scope: pick(search.get('scope'), SCOPES, DEFAULT_FILTERS.scope),
    purpose: pick(search.get('purpose'), ['', ...PURPOSES] as const, DEFAULT_FILTERS.purpose),
    status: pick(search.get('status'), STATUSES, DEFAULT_FILTERS.status),
    category: (search.get('category') ?? '').slice(0, 64),
  };
}

/** The address query for a set of filters: only what differs from the default, so the plain list has a plain address. */
export function filtersToSearch(f: TemplateFilters): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.scope !== DEFAULT_FILTERS.scope) p.set('scope', f.scope);
  if (f.purpose) p.set('purpose', f.purpose);
  if (f.status !== DEFAULT_FILTERS.status) p.set('status', f.status);
  if (f.category) p.set('category', f.category);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const hasActiveFilter = (f: TemplateFilters): boolean =>
  f.q.trim() !== '' ||
  f.scope !== DEFAULT_FILTERS.scope ||
  f.purpose !== '' ||
  f.status !== DEFAULT_FILTERS.status ||
  f.category !== '';

/** What the list request carries (the cursor and page size are added by the hook). */
export function listQuery(f: TemplateFilters): Omit<ListEmailTemplatesQuery, 'cursor' | 'limit'> {
  return {
    scope: f.scope,
    status: f.status,
    ...(f.q.trim() ? { q: f.q.trim() } : {}),
    ...(f.purpose ? { purpose: f.purpose } : {}),
    ...(f.category ? { category: f.category } : {}),
  };
}
