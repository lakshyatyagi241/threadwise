import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  ConversationGroupMembers,
  ConversationPersonalGroup,
  ListConversationGroupMembersQuery,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { groupIdOf, isGroupPeer } from '../../infra/providers/whatsapp/group-peer';

interface GroupRow {
  left_at: Date | string | null;
  announce: boolean;
  is_admin: boolean;
  size: number | string;
  participants: unknown;
}

/**
 * What the inbox shows about a thread of a group on a personal (linked) number: whether the number can still write there, and the
 * members the composer offers for an @mention. A cheap read of `wa_device_groups` (kept by the groups directory sync), never a call to
 * WhatsApp. The caller has already checked that the person may see the conversation (the inbox's read scope); this only reads.
 *
 * The channel is matched through `channels.external_id = devices.uuid` (a `whatsapp_qr` channel's handle).
 */
@Injectable()
export class PersonalGroupThreadReader {
  /** The state for the thread header; null when the thread is not a personal-number group thread. */
  async stateOf(
    tx: Tx,
    orgId: number,
    channel: { id: number; kind: string },
    peerKey: string,
  ): Promise<ConversationPersonalGroup | null> {
    if (channel.kind !== 'whatsapp_qr' || !isGroupPeer(peerKey)) return null;
    const groupId = groupIdOf(peerKey);
    const row = await this.row(tx, orgId, channel.id, groupId);
    // No directory row yet (the first sync has not run): nothing is known against writing, so the thread is writable.
    const left = row?.left_at != null;
    const announce = row?.announce === true;
    const isAdmin = row?.is_admin === true;
    const announceOnly = row !== null && announce && !isAdmin;
    return {
      groupId,
      left,
      announce,
      isAdmin,
      announceOnly,
      canSend: !left && !announceOnly,
      memberCount: row ? Number(row.size) || participantsOf(row).length : 0,
    };
  }

  /** The members for the @mention picker, filtered by name or number, admins first then by name. */
  async members(
    tx: Tx,
    orgId: number,
    channel: { id: number; kind: string },
    peerKey: string,
    query: ListConversationGroupMembersQuery,
  ): Promise<ConversationGroupMembers> {
    if (channel.kind !== 'whatsapp_qr' || !isGroupPeer(peerKey)) return { members: [], total: 0 };
    const row = await this.row(tx, orgId, channel.id, groupIdOf(peerKey));
    const all = row ? participantsOf(row) : [];
    const q = (query.q ?? '').trim().toLowerCase();
    const qDigits = q.replace(/\D+/g, '');
    const matches = all.filter(
      (p) =>
        q === '' ||
        (p.name ?? '').toLowerCase().includes(q) ||
        (qDigits !== '' && ((p.phone ?? '').includes(qDigits) || (p.lid ?? '').includes(qDigits))),
    );
    matches.sort(
      (a, b) =>
        Number(b.admin !== null) - Number(a.admin !== null) ||
        (a.name ?? a.phone ?? '\uffff').localeCompare(b.name ?? b.phone ?? '\uffff'),
    );
    return {
      members: matches.slice(0, query.limit).map((p) => ({
        jid: p.jid,
        name: p.name,
        phone: p.phone ? `+${p.phone}` : null,
        admin: p.admin,
      })),
      total: all.length,
    };
  }

  private async row(
    tx: Tx,
    orgId: number,
    channelId: number,
    groupId: string,
  ): Promise<GroupRow | null> {
    const res = await tx.execute(sql`
      SELECT g.left_at, g.announce, g.is_admin, g.size, g.participants
        FROM channels ch
        JOIN devices d ON d.org_id = ch.org_id AND d.uuid::text = ch.external_id
        JOIN wa_device_groups g ON g.org_id = d.org_id AND g.device_id = d.id
       WHERE ch.org_id = ${orgId} AND ch.id = ${channelId} AND g.group_jid = ${groupId}
       LIMIT 1`);
    return (res.rows[0] as unknown as GroupRow | undefined) ?? null;
  }
}

interface Member {
  jid: string;
  phone: string | null;
  lid: string | null;
  name: string | null;
  admin: 'admin' | 'superadmin' | null;
}

function participantsOf(row: GroupRow): Member[] {
  if (!Array.isArray(row.participants)) return [];
  const out: Member[] = [];
  for (const p of row.participants as Array<Record<string, unknown>>) {
    if (typeof p?.jid !== 'string' || p.jid === '') continue;
    out.push({
      jid: p.jid,
      phone: typeof p.phone === 'string' && p.phone !== '' ? p.phone : null,
      lid: typeof p.lid === 'string' && p.lid !== '' ? p.lid : null,
      name: typeof p.name === 'string' && p.name !== '' ? p.name : null,
      admin: p.admin === 'admin' || p.admin === 'superadmin' ? p.admin : null,
    });
  }
  return out;
}
