import { HttpStatus, Injectable } from '@nestjs/common';
import { ERROR_CODES } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { RbacService } from '../../kernel/rbac/rbac.service';
import type { ChannelRow, TeamChatRepository } from './team-chat.repository';

export const PERM_CHANNEL_MANAGE = 'tchat.channel.manage';
export const PERM_INVITE_APPROVE = 'tchat.invite.approve';
export const PERM_MODERATE = 'tchat.message.moderate';

export interface Capabilities {
  canManageChannels: boolean;
  canDecideInvitations: boolean;
  canModerate: boolean;
}

/**
 * Who may do what in team chat (WD-TCHAT-002). Any active staff user is a member: no permission key is needed to read, post,
 * react or ask for an invitation, as in WaDesk. WaDesk's "owner or admin" becomes three keys the Admin preset holds, so a
 * workspace can hand any of them to a manager. Unlike WaDesk, channel access is checked on every message-scoped route.
 */
@Injectable()
export class TeamChatAccess {
  constructor(private readonly rbac: RbacService) {}

  /** The caller as a staff user; any other actor kind has no chat. */
  actor(): { orgId: number; userId: number } {
    const ctx = RequestContextStore.require();
    if (ctx.actorType !== 'user' || !ctx.userId) throw AppError.unauthenticated();
    return { orgId: ctx.orgId, userId: ctx.userId };
  }

  async capabilities(): Promise<Capabilities> {
    const { orgId, userId } = this.actor();
    const grants = await this.rbac.grantsForUser(orgId, userId);
    return {
      canManageChannels: this.rbac.can(grants, PERM_CHANNEL_MANAGE).allowed,
      canDecideInvitations: this.rbac.can(grants, PERM_INVITE_APPROVE).allowed,
      canModerate: this.rbac.can(grants, PERM_MODERATE).allowed,
    };
  }

  /**
   * The channel by uuid, if the caller may open it: 404 when it does not exist in this workspace, 403 when it is private (or a
   * direct message) and the caller has no membership row. A public channel is open to every member.
   */
  async openChannel(
    tx: Tx,
    repo: TeamChatRepository,
    channelUuid: string,
  ): Promise<{ channel: ChannelRow; role: 'admin' | 'member' | null }> {
    const { orgId, userId } = this.actor();
    const channel = await repo.channelByUuid(tx, orgId, channelUuid);
    if (!channel) throw AppError.notFound('Channel', channelUuid);
    const role = await repo.memberRole(tx, orgId, channel.id, userId);
    if (channel.type !== 'public' && !role) {
      throw new AppError(
        ERROR_CODES.TCHAT_NOT_CHANNEL_MEMBER,
        'You are not a member of this channel',
        HttpStatus.FORBIDDEN,
      );
    }
    return { channel, role };
  }

  /** The channel and the caller's role in it, without requiring membership: for a manager acting on a channel they are not in. */
  async channelForManage(
    tx: Tx,
    repo: TeamChatRepository,
    channelUuid: string,
  ): Promise<{ channel: ChannelRow; role: 'admin' | 'member' | null }> {
    const { orgId, userId } = this.actor();
    const channel = await repo.channelByUuid(tx, orgId, channelUuid);
    if (!channel) throw AppError.notFound('Channel', channelUuid);
    return { channel, role: await repo.memberRole(tx, orgId, channel.id, userId) };
  }
}
