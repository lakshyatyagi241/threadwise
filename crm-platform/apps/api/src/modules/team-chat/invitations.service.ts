import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  TCHAT_INVITATIONS_LIMIT,
  type CreateTchatInvitationInput,
  type CreateTchatInvitationResult,
  type TchatInvitationListResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { TeamChatAccess } from './team-chat-access.service';
import { toInvitationResponse } from './team-chat.mapper';
import { TeamChatRepository, type InvitationRow } from './team-chat.repository';

export const TCHAT_INVITATION_MODULE = 'team_chat_invitations';

/**
 * "Add a teammate" requests (WD-TCHAT-024..027): anyone may ask, a holder of tchat.invite.approve decides, and an approver's own
 * request is decided on the spot.
 *
 * Creating a login is the workspace-members domain's job (seat limit, role, mail), which is not built yet. Until it is, an
 * approval for someone with no account is recorded and announced (`teamchat.invitation.approved`, `needsAccount: true`) and
 * adds nobody; WaDesk reported "Member added" in that case. What approval does add is the person to the target private channel,
 * when they have an account. The account is looked up when the decision is made, not frozen at the request.
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TeamChatRepository,
    private readonly access: TeamChatAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<TchatInvitationListResponse> {
    const { orgId, userId } = this.access.actor();
    const caps = await this.access.capabilities();
    const only = caps.canDecideInvitations ? null : userId;
    return this.db.tx(async (tx) => {
      const rows = await this.repo.listInvitations(tx, orgId, only, TCHAT_INVITATIONS_LIMIT);
      return {
        isAdmin: caps.canDecideInvitations,
        data: rows.map(toInvitationResponse),
        pendingCount: await this.repo.countPending(tx, orgId, only),
      };
    });
  }

  async create(input: CreateTchatInvitationInput): Promise<CreateTchatInvitationResult> {
    const { orgId, userId } = this.access.actor();
    const caps = await this.access.capabilities();
    const approver = caps.canDecideInvitations;
    return this.db.tx(async (tx) => {
      const invitee = await this.repo.userByEmail(tx, orgId, input.inviteeEmail);
      const active = invitee?.active === true;

      let channel: Awaited<ReturnType<TeamChatRepository['channelByUuid']>> = null;
      if (input.channelId) {
        const found = await this.access.channelForManage(tx, this.repo, input.channelId);
        if (found.channel.type !== 'public' && !found.role && !caps.canManageChannels) {
          throw AppError.forbidden('tchat.channel.manage');
        }
        channel = found.channel;
      }

      // Already in: on the roster with no channel to add them to, or already in that channel (a public one is everyone's).
      const alreadyIn =
        active &&
        (!channel ||
          channel.type === 'public' ||
          (await this.repo.memberRole(tx, orgId, channel.id, invitee.id)) !== null);
      if (alreadyIn) {
        throw new AppError(
          ERROR_CODES.TCHAT_ALREADY_MEMBER,
          'Already a workspace member',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const created = await this.repo.insertInvitation(tx, orgId, {
        channelId: channel?.id ?? null,
        requesterId: userId,
        inviteeUserId: invitee?.id ?? null,
        inviteeEmail: input.inviteeEmail,
        inviteeName: input.inviteeName?.trim() || invitee?.name || null,
        note: input.note?.trim() || null,
        status: approver ? 'approved' : 'pending',
        decidedBy: approver ? userId : null,
      });
      await this.audit.record(tx, {
        module: TCHAT_INVITATION_MODULE,
        recordId: created.id,
        action: 'insert',
      });

      if (!approver) {
        await this.outbox.emit(tx, {
          aggregateModule: TCHAT_INVITATION_MODULE,
          aggregateId: created.id,
          eventType: 'teamchat.invitation.requested',
          payload: { uuid: created.uuid, inviteeEmail: input.inviteeEmail },
        });
        return {
          id: created.uuid,
          status: 'pending' as const,
          message: 'Invitation submitted, waiting for admin approval',
        };
      }

      await this.applyApproval(tx, orgId, {
        id: created.id,
        uuid: created.uuid,
        email: input.inviteeEmail,
        channelId: channel?.id ?? null,
        channelUuid: channel?.uuid ?? null,
        channelType: channel?.type ?? null,
        inviteeId: invitee?.id ?? null,
        inviteeUuid: invitee?.uuid ?? null,
        inviteeActive: active,
      });
      return {
        id: created.uuid,
        status: 'approved' as const,
        message: active
          ? 'Member added'
          : 'Recorded. This person has no account in the workspace yet, so nobody was added',
      };
    });
  }

  async approve(uuid: string): Promise<{ ok: true }> {
    return this.decide(uuid, 'approved');
  }

  async decline(uuid: string): Promise<{ ok: true }> {
    return this.decide(uuid, 'declined');
  }

  private async decide(uuid: string, status: 'approved' | 'declined'): Promise<{ ok: true }> {
    const { orgId, userId } = this.access.actor();
    await this.db.tx(async (tx) => {
      const inv = await this.repo.invitationByUuid(tx, orgId, uuid);
      if (!inv) throw AppError.notFound('Invitation', uuid);
      // The status check is inside the UPDATE, so two admins deciding at once cannot both win.
      const decided = await this.repo.decideInvitation(tx, orgId, inv.id, status, userId);
      if (!decided) {
        throw new AppError(
          ERROR_CODES.TCHAT_INVITATION_DECIDED,
          'Already decided',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      await this.audit.record(tx, {
        module: TCHAT_INVITATION_MODULE,
        recordId: inv.id,
        action: 'update',
        delta: { status: { old: 'pending', new: status } },
      });
      if (status === 'declined') {
        await this.outbox.emit(tx, {
          aggregateModule: TCHAT_INVITATION_MODULE,
          aggregateId: inv.id,
          eventType: 'teamchat.invitation.declined',
          payload: { uuid: inv.uuid, inviteeEmail: inv.inviteeEmail },
        });
        return;
      }
      await this.approveRow(tx, orgId, inv);
    });
    return { ok: true };
  }

  private async approveRow(tx: Tx, orgId: number, inv: InvitationRow): Promise<void> {
    const account = inv.inviteeEmail
      ? await this.repo.userByEmail(tx, orgId, inv.inviteeEmail)
      : null;
    const channel = inv.channelId
      ? await this.repo.channelByUuid(tx, orgId, inv.channelUuid!)
      : null;
    await this.applyApproval(tx, orgId, {
      id: inv.id,
      uuid: inv.uuid,
      email: inv.inviteeEmail ?? '',
      channelId: channel?.id ?? null,
      channelUuid: channel?.uuid ?? null,
      channelType: channel?.type ?? null,
      inviteeId: account?.id ?? null,
      inviteeUuid: account?.uuid ?? null,
      inviteeActive: account?.active === true,
    });
  }

  /** Links the account, adds the person to the target private channel, and announces the approval. */
  private async applyApproval(
    tx: Tx,
    orgId: number,
    a: {
      id: number;
      uuid: string;
      email: string;
      channelId: number | null;
      channelUuid: string | null;
      channelType: 'public' | 'private' | 'dm' | null;
      inviteeId: number | null;
      inviteeUuid: string | null;
      inviteeActive: boolean;
    },
  ): Promise<void> {
    if (a.inviteeId) await this.repo.linkInvitee(tx, orgId, a.id, a.inviteeId);
    if (a.inviteeActive && a.inviteeId && a.channelId && a.channelType === 'private') {
      await this.repo.addMember(tx, orgId, a.channelId, a.inviteeId, 'member');
    }
    await this.outbox.emit(tx, {
      aggregateModule: TCHAT_INVITATION_MODULE,
      aggregateId: a.id,
      eventType: 'teamchat.invitation.approved',
      payload: {
        uuid: a.uuid,
        inviteeEmail: a.email,
        inviteeUserId: a.inviteeUuid,
        channelId: a.channelUuid,
        needsAccount: !a.inviteeActive,
      },
    });
  }
}
