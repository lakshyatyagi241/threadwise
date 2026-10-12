import type { RealtimeRoomKey, RealtimeRoomSpec } from '@crm/contracts';

/**
 * Rooms, as the server sees them.
 *
 *   org:{orgId}             the whole workspace (rare, org-wide notices)
 *   user:{orgId}:{userId}   one staff user, on every device: assignments, unread counts, personal signals
 *   conv:{orgId}:{uuid}     the people with one conversation open (joined explicitly and checked)
 *   inbox:{orgId}:{scope}   everyone watching a list: `all`, or `team:<team uuid>` (joined explicitly and checked)
 *
 * The workspace id is in every name so a room can never be shared between two tenants, even if two uuids ever collided. The
 * names carry internal ids and stay on the server; what a client sees is `roomKeyFor`.
 */
export type RoomRef =
  | { kind: 'org' }
  | { kind: 'user'; userId: number }
  | { kind: 'conv'; id: string }
  | { kind: 'inbox'; scope: string }
  /** The sockets whose member holds one permission: joined by the server only, re-evaluated when grants change (AZ-016). */
  | { kind: 'perm'; permission: string };

export function roomName(orgId: number, ref: RoomRef): string {
  switch (ref.kind) {
    case 'org':
      return `org:${orgId}`;
    case 'user':
      return `user:${orgId}:${ref.userId}`;
    case 'conv':
      return `conv:${orgId}:${ref.id.toLowerCase()}`;
    case 'inbox':
      return `inbox:${orgId}:${ref.scope.toLowerCase()}`;
    case 'perm':
      return `perm:${orgId}:${ref.permission}`;
  }
}

/** A room as the client names it: no internal ids, and `user` always means the viewer's own. */
export function roomKeyFor(ref: RoomRef): RealtimeRoomKey {
  switch (ref.kind) {
    case 'org':
      return 'org';
    case 'user':
      return 'user';
    case 'conv':
      return `conv:${ref.id.toLowerCase()}`;
    case 'inbox':
      return `inbox:${ref.scope.toLowerCase()}`;
    case 'perm':
      // Not a room the client knows: its events are workspace-wide state for the members allowed to see it.
      return 'org';
  }
}

/** What a client asked to join, as a room reference. */
export function refFromSpec(spec: RealtimeRoomSpec): RoomRef {
  return spec.kind === 'conv'
    ? { kind: 'conv', id: spec.id }
    : { kind: 'inbox', scope: spec.scope };
}
