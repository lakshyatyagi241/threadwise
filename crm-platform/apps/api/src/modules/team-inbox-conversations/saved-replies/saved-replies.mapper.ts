import { channelKindSchema, type SavedReply } from '@crm/contracts';
import { canChange, scopeOf, type ReplyCaller } from './saved-reply-rules';
import type { SavedReplyRow } from './saved-replies.repository';

const iso = (v: unknown): string => new Date(v as string | Date).toISOString();

/** One `saved_replies` row as the API returns it. `canEdit` is for this caller; the internal ids never leave the server. */
export function toSavedReply(r: SavedReplyRow, caller: ReplyCaller): SavedReply {
  const ownership = { userId: r.user_id === null ? null : Number(r.user_id) };
  const kinds = Array.isArray(r.channel_kinds) ? (r.channel_kinds as unknown[]) : [];
  return {
    id: r.uuid as string,
    shortcut: r.shortcut as string,
    title: r.title as string,
    body: r.body as string,
    category: (r.category as string | null) ?? null,
    language: (r.language as string | null) ?? null,
    // A kind that no longer exists (a hand-edited row, a retired channel) is dropped rather than failing the whole list.
    channelKinds: kinds.flatMap((k) => {
      const parsed = channelKindSchema.safeParse(k);
      return parsed.success ? [parsed.data] : [];
    }),
    scope: scopeOf(ownership),
    usedCount: Number(r.used_count),
    lastUsedAt: r.last_used_at ? iso(r.last_used_at) : null,
    createdByName: (r.created_by_name as string | null) ?? null,
    canEdit: canChange(ownership, caller),
    rowVersion: Number(r.row_version),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}
