import { HttpStatus, Injectable } from '@nestjs/common';
import {
  APPOINTMENT_CHANNELS,
  ERROR_CODES,
  type AppointmentChannel,
  type AppointmentChannelState,
  type AppointmentChannelsResponse,
  type UpdateAppointmentChannelInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  AppointmentChannelsRepository,
  type ChannelSettingRow,
  type SenderDirectory,
  type SenderRow,
} from './appointment-channels.repository';

const MODULE = 'appointment_channel_settings';

const sendersOf = (dir: SenderDirectory, channel: AppointmentChannel): SenderRow[] =>
  channel === 'voice' ? [] : dir[channel];

/** Whether the channel has something to send through. WhatsApp counts a connected QR number (text only); the library needs a Cloud API one. */
function isConnected(dir: SenderDirectory, channel: AppointmentChannel): boolean {
  if (channel === 'voice') return false;
  if (channel === 'whatsapp') return dir.whatsapp.length > 0 || dir.whatsappDevice;
  return sendersOf(dir, channel).length > 0;
}

/** The state of one channel for the owner's screen and for a booking type's Messaging step. Pure. */
export function stateOf(
  channel: AppointmentChannel,
  row: ChannelSettingRow | undefined,
  dir: SenderDirectory,
): AppointmentChannelState {
  const senders = sendersOf(dir, channel);
  const connection =
    channel === 'voice' ? 'coming_soon' : isConnected(dir, channel) ? 'connected' : 'not_connected';
  const enabled = channel !== 'voice' && (row?.enabled ?? false);
  const defaultSender = row?.defaultSenderId
    ? senders.find((s) => s.id === row.defaultSenderId)
    : undefined;
  return {
    channel,
    enabled,
    decided: row !== undefined,
    source: row?.source ?? null,
    connection,
    usable: enabled && connection === 'connected',
    senders: senders.map((s) => ({ id: s.uuid, label: s.label })),
    // A default that was disconnected since is shown as "not chosen": the sender falls back to the first connected one.
    defaultSenderId: defaultSender?.uuid ?? null,
    rowVersion: row?.rowVersion ?? null,
  };
}

/**
 * The workspace's choice of channels for appointment messages (BL-350). The owner (or an admin) switches email, WhatsApp and SMS on or
 * off and may pick a default sender per channel; voice is listed and cannot be switched on until the Voice bot exists.
 *
 * "Enabled" is the owner's decision; "connected" is the fact that a sender exists. A booking type can use a channel only when both hold,
 * and the shared sender (`ChannelAppointmentMessenger`) asks again at send time, so switching a channel off stops what is already
 * scheduled with the reason `channel_disabled`.
 */
@Injectable()
export class AppointmentChannelsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: AppointmentChannelsRepository,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<AppointmentChannelsResponse> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => ({ data: await this.states(tx, orgId) }));
  }

  async states(tx: Tx, orgId: number): Promise<AppointmentChannelState[]> {
    const [rows, dir] = await Promise.all([this.repo.settings(tx, orgId), this.repo.senders(tx, orgId)]);
    return APPOINTMENT_CHANNELS.map((c) =>
      stateOf(
        c,
        rows.find((r) => r.channel === c),
        dir,
      ),
    );
  }

  async update(
    channel: AppointmentChannel,
    input: UpdateAppointmentChannelInput,
  ): Promise<AppointmentChannelState> {
    const ctx = RequestContextStore.require();
    if (channel === 'voice') {
      throw new AppError(
        ERROR_CODES.APPT_CHANNEL_COMING_SOON,
        'The outbound reminder call arrives with the Voice bot and cannot be switched on yet.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'channel', message: 'voice' }],
      );
    }
    return this.db.tx(async (tx) => {
      const dir = await this.repo.senders(tx, ctx.orgId);
      let defaultSenderId: number | null | undefined;
      if (input.defaultSenderId !== undefined) {
        if (input.defaultSenderId === null) defaultSenderId = null;
        else {
          const sender = sendersOf(dir, channel).find((s) => s.uuid === input.defaultSenderId);
          if (!sender) {
            throw new AppError(
              ERROR_CODES.APPT_CHANNEL_SENDER_INVALID,
              'That sender is not connected in this workspace.',
              HttpStatus.UNPROCESSABLE_ENTITY,
              [{ path: 'defaultSenderId', message: input.defaultSenderId }],
            );
          }
          defaultSenderId = sender.id;
        }
      }
      const before = (await this.repo.settings(tx, ctx.orgId)).find((r) => r.channel === channel);
      const saved = await this.repo.upsert(tx, ctx.orgId, channel, {
        enabled: input.enabled,
        defaultSenderId,
        userId: ctx.userId,
      });
      await this.audit.record(tx, {
        module: MODULE,
        recordId: saved.id,
        action: before ? 'update' : 'insert',
        delta: {
          channel: { old: before?.channel ?? null, new: channel },
          enabled: { old: before?.enabled ?? null, new: saved.enabled },
          ...(saved.defaultSenderId !== (before?.defaultSenderId ?? null)
            ? { default_sender_id: { old: before?.defaultSenderId ?? null, new: saved.defaultSenderId } }
            : {}),
        },
      });
      return stateOf(channel, saved, dir);
    });
  }

  /**
   * A booking type may name only channels the owner has switched on. Only a channel the type did not use before is checked, so a type
   * that already uses one the owner has since switched off can still be saved (the sender then skips that channel with a clear reason).
   */
  async assertEnabled(
    tx: Tx,
    orgId: number,
    added: ReadonlyArray<{ channel: string; path: string }>,
  ): Promise<void> {
    if (added.length === 0) return;
    const rows = await this.repo.settings(tx, orgId);
    for (const a of added) {
      if (a.channel === 'voice') {
        throw new AppError(
          ERROR_CODES.APPT_CHANNEL_COMING_SOON,
          'The outbound reminder call arrives with the Voice bot.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: a.path, message: a.channel }],
        );
      }
      if (!rows.some((r) => r.channel === a.channel && r.enabled)) {
        throw new AppError(
          ERROR_CODES.APPT_CHANNEL_NOT_ENABLED,
          `The workspace owner has not switched ${a.channel} on for appointment messages.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: a.path, message: a.channel }],
        );
      }
    }
  }
}
