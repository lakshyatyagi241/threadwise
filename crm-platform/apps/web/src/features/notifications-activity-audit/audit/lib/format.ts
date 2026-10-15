import type { AuditLogEntry } from '@crm/contracts';

/** What the table and the panel say about an entry, as a message key plus values (the components translate it). Pure. */

export const KNOWN_ACTIONS = [
  'insert',
  'update',
  'delete',
  'merge',
  'login',
  'export',
  'read',
] as const;
export const KNOWN_MODULES = [
  'contacts',
  'contact_groups',
  'contact_notes',
  'companies',
  'deals',
  'tags',
  'members',
  'teams',
  'conversation_notes',
  'broadcasts',
  'campaigns',
  'faqs',
  'api_keys',
  'audit-log',
  'audit-log-exports',
  'contact_consent_exports',
  'revenue-report-exports',
] as const;

export const isKnownAction = (a: string): boolean =>
  (KNOWN_ACTIONS as readonly string[]).includes(a);
export const isKnownModule = (m: string): boolean =>
  (KNOWN_MODULES as readonly string[]).includes(m);

export type ActorLabel =
  | { kind: 'user'; name: string | null }
  | {
      kind: 'system' | 'api_key' | 'bot' | 'partner_agent' | 'candidate' | 'other';
      name: string | null;
    };

/** Who an entry shows as. A named API key keeps its name; a user whose record is gone is "a removed user". */
export function actorLabel(e: Pick<AuditLogEntry, 'actor'>): ActorLabel {
  return { kind: e.actor.kind, name: e.actor.name };
}

/** The first letters of a name, for the avatar circle. */
export function initials(name: string | null): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = Array.from(words[0]!)[0] ?? '?';
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  return `${first}${last}`.toUpperCase();
}

/** Changed fields for a cell: the first few, then "+N". */
export function fieldSummary(fields: string[], max = 3): { shown: string[]; more: number } {
  return { shown: fields.slice(0, max), more: Math.max(0, fields.length - max) };
}

/** A value of a change as text for the diff cell. */
export function showValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v, null, 2);
}

/** Whether a rendered value is the placeholder of a secret. */
export const isRedacted = (v: unknown): boolean => v === '[REDACTED]';
