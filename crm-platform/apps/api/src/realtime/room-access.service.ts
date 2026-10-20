import { Inject, Injectable } from '@nestjs/common';
import type { RealtimeRoomSpec } from '@crm/contracts';
import {
  CONVERSATION_RECORD_LOADER,
  type ConversationRecordLoader,
} from './audience/conversation-record.loader';
import { PERM_CONVERSATION_READ, conversationVisible } from './audience/conversation-visibility';
import { MemberDirectory } from './audience/member-directory.service';
import type { SocketIdentity } from './realtime-auth.service';

/**
 * Whether a socket may enter a room it asked for. Always the live answer (grants are read through the RBAC cache, which a role
 * change invalidates at once), never the audience cache: this is the moment a conversation could leak.
 *
 * `conv:` uses the same visibility rule as the REST read. Only staff users have a conversation or inbox room: a socket of any
 * other kind gets nothing.
 */
@Injectable()
export class RoomAccessService {
  constructor(
    private readonly directory: MemberDirectory,
    @Inject(CONVERSATION_RECORD_LOADER) private readonly loader: ConversationRecordLoader,
  ) {}

  /** Whether a staff user holds a permission right now (live grants, never the audience cache): the gate of a permission room. */
  async holds(identity: SocketIdentity, permission: string): Promise<boolean> {
    if (identity.actorType !== 'user') return false;
    const viewer = await this.directory.viewer(identity.orgId, identity.actorId, permission);
    return viewer.scope !== null;
  }

  async canJoin(identity: SocketIdentity, spec: RealtimeRoomSpec): Promise<boolean> {
    if (identity.actorType !== 'user') return false;
    const { orgId, actorId: userId } = identity;
    const viewer = await this.directory.viewer(orgId, userId, PERM_CONVERSATION_READ);
    if (viewer.scope === null) return false;

    if (spec.kind === 'conv') {
      const record = await this.loader.load(orgId, userId, spec.id);
      return record !== null && conversationVisible(viewer, record);
    }

    if (spec.scope === 'all') return viewer.scope === 'all';

    // `team:<uuid>`: a team member whose scope reaches the team's conversations, or anyone who may read them all.
    if (viewer.scope === 'own') return false;
    const team = await this.directory.teamMembership(
      orgId,
      userId,
      spec.scope.slice('team:'.length),
    );
    if (!team) return false;
    // `team_and_below`: the viewer's teams already include every team below them.
    return viewer.scope === 'all' || team.member || viewer.teamIds.includes(team.teamId);
  }
}
