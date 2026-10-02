import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type AddTchatChannelMemberInput,
  type CreateTchatChannelInput,
  type OpenTchatDirectInput,
  type TchatChannelListResponse,
  type TchatChannelMember,
  type TchatChannelResponse,
  type TchatMemberListResponse,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { channelSlug, directSlug } from './chat-rules';
import { TeamChatAccess } from './team-chat-access.service';
import { toChannelResponse, toMemberResponse } from './team-chat.mapper';
import { TeamChatRepository } from './team-chat.repository';

export const TCHAT_MODULE = 'team_chat_channels';

/**
 * Channels, direct messages, the roster and who is in a private channel (TW-TCHAT-001, 003..007, 015).
 *
 * What differs from Reference (all in the inventory): `#general` is created with ON CONFLICT instead of racing to a 500; a channel
 * name is reusable once its channel is gone (rows are hard-deleted here, so the unique slug is released); private-channel
 * members can be added and removed, and direct messages exist.
 */
@Injectable()
export class ChannelsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TeamChatRepository,
    private readonly access: TeamChatAccess,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<TchatChannelListResponse> {
    const { orgId, userId } = this.access.actor();
    const caps = await this.access.capabilities();
    return this.db.tx(async (tx) => {
      await this.repo.ensureGeneral(tx, orgId);
      const rows = await this.repo.listForUser(tx, orgId, userId);
      const me = (await this.repo.roster(tx, orgId)).find((p) => p.id === userId);
      return {
        data: rows.map((r) => toChannelResponse(r)),
        me: { id: me?.uuid ?? '', name: me?.name ?? '', ...caps },
      };
    });
  }

  async create(input: CreateTchatChannelInput): Promise<TchatChannelResponse> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const name = input.name.toLowerCase();
      const slug = channelSlug(name);
      const row = await this.repo.insertChannel(tx, orgId, {
        name,
        slug,
        description: input.description?.trim() || null,
        type: input.type,
        createdBy: userId,
      });
      if (!row) {
        throw new AppError(
          ERROR_CODES.TCHAT_CHANNEL_NAME_TAKEN,
          'A channel with this name already exists',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      // A public channel needs no member rows; a private one starts with its creator, who is its admin.
      if (input.type === 'private') await this.repo.addMember(tx, orgId, row.id, userId, 'admin');
      await this.audit.record(tx, { module: TCHAT_MODULE, recordId: row.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MODULE,
        aggregateId: row.id,
        eventType: 'teamchat.channel.created',
        payload: { uuid: row.uuid, name: row.name, type: row.type },
      });
      return toChannelResponse(row);
    });
  }

  async remove(channelUuid: string): Promise<void> {
    const { orgId } = this.access.actor();
    await this.db.tx(async (tx) => {
      const channel = await this.repo.channelByUuid(tx, orgId, channelUuid);
      if (!channel) throw AppError.notFound('Channel', channelUuid);
      if (channel.slug === 'general') {
        throw new AppError(
          ERROR_CODES.TCHAT_CHANNEL_PROTECTED,
          '#general cannot be deleted',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      await this.audit.record(tx, { module: TCHAT_MODULE, recordId: channel.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MODULE,
        aggregateId: channel.id,
        eventType: 'teamchat.channel.deleted',
        payload: { uuid: channel.uuid, name: channel.name },
      });
      await this.repo.deleteChannel(tx, orgId, channel.id);
    });
  }

  /** The direct message with one teammate: created on the first open, the same channel on every later one (TW-TCHAT-007). */
  async openDirect(input: OpenTchatDirectInput): Promise<TchatChannelResponse> {
    const { orgId, userId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const peer = await this.repo.activeUserByUuid(tx, orgId, input.userId);
      if (!peer) throw AppError.notFound('User', input.userId);
      if (peer.id === userId) {
        throw new AppError(
          ERROR_CODES.TCHAT_CHANNEL_KIND_INVALID,
          'You cannot message yourself',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const { channel, created } = await this.repo.upsertDirect(
        tx,
        orgId,
        directSlug(userId, peer.id),
        userId,
        peer.id,
      );
      if (created) {
        await this.audit.record(tx, {
          module: TCHAT_MODULE,
          recordId: channel.id,
          action: 'insert',
        });
      }
      return toChannelResponse({ ...channel, unread: 0, peerUuid: peer.uuid, peerName: peer.name });
    });
  }

  /** Everyone in the workspace (the members rail and the mention picker). */
  async roster(): Promise<TchatMemberListResponse> {
    const { orgId } = this.access.actor();
    return this.db.tx(async (tx) => ({
      data: (await this.repo.roster(tx, orgId)).map(toMemberResponse),
    }));
  }

  // --- who is in a private channel -------------------------------------------------------------------------------------

  async members(channelUuid: string): Promise<{ data: TchatChannelMember[] }> {
    const { orgId } = this.access.actor();
    return this.db.tx(async (tx) => {
      const { channel } = await this.access.openChannel(tx, this.repo, channelUuid);
      if (channel.type === 'public') {
        // A public channel is everyone: the roster is its member list.
        return {
          data: (await this.repo.roster(tx, orgId)).map((p) => ({
            ...toMemberResponse(p),
            role: 'member' as const,
          })),
        };
      }
      const rows = await this.repo.channelMembers(tx, orgId, channel.id);
      return { data: rows.map((p) => ({ ...toMemberResponse(p), role: p.role })) };
    });
  }

  async addMember(channelUuid: string, input: AddTchatChannelMemberInput): Promise<void> {
    const { orgId } = this.access.actor();
    await this.db.tx(async (tx) => {
      const channel = await this.managedPrivateChannel(tx, channelUuid);
      const person = await this.repo.activeUserByUuid(tx, orgId, input.userId);
      if (!person) throw AppError.notFound('User', input.userId);
      const added = await this.repo.addMember(tx, orgId, channel.id, person.id, 'member');
      if (!added) return;
      await this.audit.record(tx, {
        module: TCHAT_MODULE,
        recordId: channel.id,
        action: 'update',
        delta: { member: { old: null, new: person.uuid } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MODULE,
        aggregateId: channel.id,
        eventType: 'teamchat.channel.member_added',
        payload: { uuid: channel.uuid, userId: person.uuid },
      });
    });
  }

  /** Remove a person, or leave yourself (always allowed). */
  async removeMember(channelUuid: string, userUuid: string): Promise<void> {
    const { orgId, userId } = this.access.actor();
    await this.db.tx(async (tx) => {
      const person = await this.repo.activeUserByUuid(tx, orgId, userUuid);
      if (!person) throw AppError.notFound('User', userUuid);
      const channel =
        person.id === userId
          ? (await this.access.openChannel(tx, this.repo, channelUuid)).channel
          : await this.managedPrivateChannel(tx, channelUuid);
      if (channel.type === 'public') throw this.notPrivate();
      const removed = await this.repo.removeMember(tx, orgId, channel.id, person.id);
      if (!removed) throw AppError.notFound('Channel member', userUuid);
      await this.audit.record(tx, {
        module: TCHAT_MODULE,
        recordId: channel.id,
        action: 'update',
        delta: { member: { old: person.uuid, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: TCHAT_MODULE,
        aggregateId: channel.id,
        eventType: 'teamchat.channel.member_removed',
        payload: { uuid: channel.uuid, userId: person.uuid },
      });
    });
  }

  /** A private channel the caller may manage: a holder of tchat.channel.manage, or the channel's own admin. */
  private async managedPrivateChannel(
    tx: Parameters<TeamChatRepository['roster']>[0],
    uuid: string,
  ) {
    const { channel, role } = await this.access.channelForManage(tx, this.repo, uuid);
    if (channel.type === 'public') throw this.notPrivate();
    const caps = await this.access.capabilities();
    if (!caps.canManageChannels && role !== 'admin') {
      throw AppError.forbidden('tchat.channel.manage');
    }
    return channel;
  }

  private notPrivate(): AppError {
    return new AppError(
      ERROR_CODES.TCHAT_CHANNEL_KIND_INVALID,
      'Only private channels have a member list',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
