import { Injectable } from '@nestjs/common';
import type { WabaConnection } from './waba-admin.port';
import { WabaApiError } from './waba-errors';
import { GROUP_ERR_NOT_ELIGIBLE } from './waba-group-errors';
import type { GroupInfo, GroupInfoField, WabaGroupsPort } from './waba-groups.port';
import { WabaHttp } from './waba-http';

/**
 * Groups always go to Meta's own Graph host with the number's own access token, whatever route the number's other traffic takes
 * (Reference's GroupClient did the same). A number onboarded through Interakt only for its credit line still holds a Meta token.
 */
function metaAuthOf(conn: WabaConnection): { provider: 'meta'; accessToken: string } {
  if (!conn.accessToken) throw new Error('Groups need the number\'s Meta access token');
  return { provider: 'meta', accessToken: conn.accessToken };
}

/** Meta's limits (spec 6): the subject is trimmed and cut at 128 characters, the description at 2,048, a removal takes 8. */
const SUBJECT_MAX = 128;
const DESCRIPTION_MAX = 2048;
export const REMOVE_MAX = 8;

const ALL_FIELDS: GroupInfoField[] = [
  'subject',
  'description',
  'participants',
  'join_approval_mode',
  'suspended',
  'creation_timestamp',
  'total_participant_count',
];

/** PHP's mb_substr counts characters, not UTF-16 units: an emoji in a subject must not be cut in half. */
const cut = (s: string, max: number): string => Array.from(s).slice(0, max).join('');

interface RawInfo {
  subject?: string;
  description?: string;
  participants?: Array<{ wa_id?: string } | string>;
  join_approval_mode?: string;
  suspended?: boolean;
  creation_timestamp?: number | string;
  total_participant_count?: number;
}

/**
 * Meta Graph adapter for the Groups API (docs/specs/waba-groups-management.md 10). Goes through the one `WabaHttp` (base URL, version,
 * timeout and error normalisation are the existing ones); DELETE with a JSON body is how Meta takes the participant and join-request ids.
 * It never builds a URL outside `path`.
 *
 * Nothing here has run against real Meta (no Official Business Account to test with, BL-030): the tests drive it through a fake of the
 * Graph edge (`test/support/fake-waba-groups-gateway.ts`).
 */
@Injectable()
export class WabaGroupsClient implements WabaGroupsPort {
  constructor(private readonly http: WabaHttp) {}

  async create(
    conn: WabaConnection,
    input: { subject: string; description?: string; joinApprovalMode?: string },
  ): Promise<{ groupId: string }> {
    const description = input.description?.trim();
    const res = await this.http.call<{ id?: string; group_id?: string }>(metaAuthOf(conn), {
      method: 'POST',
      path: `/${conn.phoneNumberId}/groups`,
      json: {
        messaging_product: 'whatsapp',
        subject: cut(input.subject.trim(), SUBJECT_MAX),
        ...(description ? { description: cut(description, DESCRIPTION_MAX) } : {}),
        ...(input.joinApprovalMode ? { join_approval_mode: input.joinApprovalMode } : {}),
      },
    });
    return { groupId: String(res.id ?? res.group_id ?? '') };
  }

  async probe(conn: WabaConnection): Promise<'eligible' | 'not_eligible' | 'unknown'> {
    try {
      await this.http.call(metaAuthOf(conn), {
        method: 'GET',
        path: `/${conn.phoneNumberId}/groups`,
        query: { limit: 1 },
      });
      return 'eligible';
    } catch (e) {
      // Only 131215 is a definite "no": a network blip or a rate limit must not hide the feature (Reference's rule).
      if (e instanceof WabaApiError && e.code === GROUP_ERR_NOT_ELIGIBLE) return 'not_eligible';
      return 'unknown';
    }
  }

  async info(
    conn: WabaConnection,
    groupId: string,
    fields: GroupInfoField[] = ALL_FIELDS,
  ): Promise<GroupInfo> {
    const r = await this.http.call<RawInfo>(metaAuthOf(conn), {
      method: 'GET',
      path: `/${groupId}`,
      query: { fields: fields.join(',') },
    });
    const at = Number(r.creation_timestamp);
    return {
      subject: r.subject ?? null,
      description: r.description ?? null,
      joinApprovalMode: r.join_approval_mode ?? null,
      suspended: typeof r.suspended === 'boolean' ? r.suspended : null,
      totalParticipantCount:
        typeof r.total_participant_count === 'number' ? r.total_participant_count : null,
      creationTimestamp: Number.isFinite(at) && at > 0 ? at : null,
      participants: (r.participants ?? [])
        .map((p) => (typeof p === 'string' ? p : (p.wa_id ?? '')))
        .filter(Boolean),
    };
  }

  async inviteLink(conn: WabaConnection, groupId: string): Promise<string | null> {
    const r = await this.http.call<{ invite_link?: string }>(metaAuthOf(conn), {
      method: 'GET',
      path: `/${groupId}/invite_link`,
    });
    return r.invite_link || null;
  }

  async resetInviteLink(conn: WabaConnection, groupId: string): Promise<string | null> {
    const r = await this.http.call<{ invite_link?: string }>(metaAuthOf(conn), {
      method: 'POST',
      path: `/${groupId}/invite_link`,
      json: { messaging_product: 'whatsapp' },
    });
    return r.invite_link || null;
  }

  async update(
    conn: WabaConnection,
    groupId: string,
    fields: { subject?: string; description?: string },
  ): Promise<void> {
    await this.http.call(metaAuthOf(conn), {
      method: 'POST',
      path: `/${groupId}`,
      json: {
        messaging_product: 'whatsapp',
        ...(fields.subject !== undefined
          ? { subject: cut(fields.subject.trim(), SUBJECT_MAX) }
          : {}),
        ...(fields.description !== undefined
          ? { description: cut(fields.description.trim(), DESCRIPTION_MAX) }
          : {}),
      },
    });
  }

  async delete(conn: WabaConnection, groupId: string): Promise<void> {
    await this.http.call(metaAuthOf(conn), { method: 'DELETE', path: `/${groupId}` });
  }

  async approveJoinRequests(conn: WabaConnection, groupId: string, ids: string[]): Promise<void> {
    await this.http.call(metaAuthOf(conn), {
      method: 'POST',
      path: `/${groupId}/join_requests`,
      json: { messaging_product: 'whatsapp', join_requests: ids.map(String) },
    });
  }

  async rejectJoinRequests(conn: WabaConnection, groupId: string, ids: string[]): Promise<void> {
    await this.http.call(metaAuthOf(conn), {
      method: 'DELETE',
      path: `/${groupId}/join_requests`,
      json: { messaging_product: 'whatsapp', join_requests: ids.map(String) },
    });
  }

  async removeParticipants(conn: WabaConnection, groupId: string, waIds: string[]): Promise<void> {
    const participants = waIds.map(String).filter(Boolean);
    if (participants.length === 0) throw new Error('No participants given');
    // The contract already caps this; the adapter refuses too, so no caller can send Meta a request it will reject.
    if (participants.length > REMOVE_MAX)
      throw new Error(`Meta allows at most ${REMOVE_MAX} participants per removal request`);
    await this.http.call(metaAuthOf(conn), {
      method: 'DELETE',
      path: `/${groupId}/participants`,
      json: { messaging_product: 'whatsapp', participants },
    });
  }
}
