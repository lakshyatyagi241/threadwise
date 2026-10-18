import type { StorageCategory } from '@crm/contracts';

/**
 * The category of a key written straight through `MediaStorageService.put`, by the area its key starts with. `chat/` is not here on
 * purpose: chat keys are written through `ChatMediaStore`, which names the category itself (call recording, inbound customer media...)
 * and meters the write once, local disk included. A key of an area that carries no workspace (`site/`, the marketing site) is not a
 * workspace's file at all and is never metered.
 */
const AREA_CATEGORY: Readonly<Record<string, StorageCategory>> = {
  marketing: 'campaign_media',
  scheduled: 'scheduled_media',
  telegram: 'channel_profile_media',
  'ai-training': 'ai_training_file',
};

/** `<area>/<orgId>/...` parsed, or null for a key that does not carry a workspace id. */
export function areaOfKey(key: string): string | null {
  const m = /^([^/]+)\/\d+\//.exec(key);
  return m ? m[1]! : null;
}

export function categoryForAreaKey(key: string): StorageCategory | null {
  const area = areaOfKey(key);
  return area ? (AREA_CATEGORY[area] ?? null) : null;
}

/** The registry key of a Postgres blob (a row with a `bytea` column), which has no object key of its own. */
export const pgBlobKey = (table: string, id: number): string => `pg:${table}:${id}`;

export const TEAM_CHAT_BLOB_TABLE = 'team_chat_attachment_blobs';
export const teamChatBlobKey = (messageId: number): string =>
  pgBlobKey(TEAM_CHAT_BLOB_TABLE, messageId);
