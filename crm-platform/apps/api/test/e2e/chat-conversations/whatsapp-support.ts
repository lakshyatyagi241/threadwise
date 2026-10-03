import type { Harness } from '../auth-registration-security/harness';
import type { ChannelRow } from '../../../src/modules/chat-conversations/channels.repository';
import { WabaChannelLinkService } from '../../../src/modules/chat-conversations/waba-channel-link.service';

/**
 * WhatsApp in the inbox specs. There is one WhatsApp stack: a number is connected in the WABA domain (a `wa_provider_configs` row of
 * provider `waba`), and the inbox's channel is its view, made by `WabaChannelLinkService` (on the connect event, or on the first
 * inbound message). These helpers arrange that the way the product does, with the owner connection for the connection row (the connect
 * flow itself talks to Meta and is covered by the WABA specs) and the real link service for the channel.
 */

export interface WaNumber {
  configId: number;
  phoneNumberId: string;
  wabaId: string;
}

export async function connectNumber(
  h: Harness,
  orgId: number,
  o: { phoneNumberId: string; wabaId?: string; phone?: string; label?: string; status?: string },
): Promise<WaNumber> {
  const wabaId = o.wabaId ?? `88${o.phoneNumberId}`;
  const row = await h.owner.query(
    `INSERT INTO wa_provider_configs (org_id, provider, status, phone_number, display_label, meta_json, connected_at)
     VALUES ($1, 'waba', $2, $3, $4, $5::jsonb, now()) RETURNING id`,
    [
      orgId,
      o.status ?? 'connected',
      o.phone ?? `+${o.phoneNumberId}`,
      o.label ?? null,
      JSON.stringify({ provider: 'meta', waba_id: wabaId, phone_number_id: o.phoneNumberId }),
    ],
  );
  return { configId: Number(row.rows[0].id), phoneNumberId: o.phoneNumberId, wabaId };
}

/** The inbox channel of a connected number, made (or found) the way the connect event and the first inbound message make it. */
export async function linkChannel(
  h: Harness,
  orgId: number,
  number: WaNumber,
  opts: { revive?: boolean } = {},
): Promise<ChannelRow> {
  const row = await h.app
    .get(WabaChannelLinkService, { strict: false })
    .ensure(orgId, number.configId, { create: true, revive: opts.revive });
  if (!row) throw new Error(`no channel was made for WhatsApp number ${number.phoneNumberId}`);
  return row;
}

/** A number and its channel in one call. */
export async function whatsappChannel(
  h: Harness,
  orgId: number,
  o: { phoneNumberId: string; label?: string; status?: string },
): Promise<{ number: WaNumber; channel: ChannelRow }> {
  const number = await connectNumber(h, orgId, o);
  return { number, channel: await linkChannel(h, orgId, number) };
}
