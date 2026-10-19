import type { TemplateDetail } from '@crm/contracts';
import { canonicalStorageKey, storageKeyIsOwnedBy } from '../../common/storage-key-owner';
import type { MediaStorageService } from '../platform-settings-branding-storage';
import { toDetail } from './templates.mapper';
import type { TemplateRow } from './templates.repository';

/** How long a link to a stored header file lasts; a fresh link is made at every read. */
export const MEDIA_PREVIEW_TTL_S = 3600;

/** The folder of one workspace's uploaded template headers (`template-media/<orgId>/...`). */
export const templateMediaFolder = (orgId: number): string => `template-media/${orgId}/`;

/** True only for a key this workspace stored as a template header: the folder itself, not any other file of the workspace. */
export const isTemplateMediaKey = (orgId: number, key: string): boolean =>
  storageKeyIsOwnedBy(orgId, key) &&
  canonicalStorageKey(key).startsWith(templateMediaFolder(orgId));

/** The template detail with a link to its stored header file (null when none was stored). */
export async function detailWithMedia(
  storage: MediaStorageService,
  row: TemplateRow,
): Promise<TemplateDetail> {
  return {
    ...toDetail(row),
    headerMediaUrl: row.headerMediaKey
      ? await storage.url(row.headerMediaKey, MEDIA_PREVIEW_TTL_S)
      : null,
  };
}
