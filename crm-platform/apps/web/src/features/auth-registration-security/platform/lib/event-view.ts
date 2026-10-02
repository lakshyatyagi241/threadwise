import type { z } from 'zod';
import type { securityEventSchema } from '@crm/contracts';

export type SecurityEventRow = z.infer<typeof securityEventSchema>;

/** First eight characters of an id plus an ellipsis: enough to recognise, short enough to sit in a row. */
export function shortId(id: string): string {
  const chars = Array.from(id);
  return chars.length <= 9 ? id : `${chars.slice(0, 8).join('')}…`;
}

export interface EventActor {
  /** A person's name, else their email, else null (a system event or a deleted account). */
  label: string | null;
  /** Email shown beside the name when both exist. */
  email: string | null;
  /** The account's public id; null for system events. */
  id: string | null;
  /** The kind of actor, e.g. "user" or "platform_operator". */
  type: string;
}

type ActorFields = Pick<SecurityEventRow, 'actorType' | 'actorId' | 'actorName' | 'actorEmail'>;

export function eventActor(row: ActorFields): EventActor {
  const name = row.actorName?.trim() || null;
  const email = row.actorEmail?.trim() || null;
  return {
    label: name ?? email,
    email: name ? email : null,
    id: row.actorId,
    type: row.actorType,
  };
}

export interface EventOrg {
  /** "Acme Ltd", else the slug, else the uuid shortened. */
  label: string;
  slug: string | null;
  /** The full uuid, for the copy button. */
  id: string;
}

type OrgFields = Pick<SecurityEventRow, 'orgId' | 'orgSlug' | 'orgName'>;

/** Null for events that belong to no workspace. */
export function eventOrg(row: OrgFields): EventOrg | null {
  if (!row.orgId) return null;
  const name = row.orgName?.trim();
  const slug = row.orgSlug?.trim() || null;
  return { label: name || slug || shortId(row.orgId), slug: name ? slug : null, id: row.orgId };
}
