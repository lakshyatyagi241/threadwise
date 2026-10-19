import type { TemplateDetail } from '@crm/contracts';
import { canonicalStorageKey, storageKeyIsOwnedBy } from '../../common/storage-key-owner';
import { headerFormatOf } from '../../infra/providers/whatsapp/template-vocab';
import type { MediaStorageService, StoredLinker } from '../platform-settings-branding-storage';
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

/** The link to a template's stored header file (our upload), or null when none is stored or the file has no link. */
export async function storedHeaderUrl(
  link: StoredLinker,
  row: Pick<TemplateRow, 'headerMediaKey'>,
): Promise<string | null> {
  return row.headerMediaKey ? link(row.headerMediaKey) : null;
}

/**
 * A link the thread can play or show a template's header file with: our stored copy first (a fresh link), else the channel's sample
 * when it is a web address. Null when the template has neither, or its header is a location pin (it has no file).
 */
export async function headerPreviewUrl(
  link: StoredLinker,
  row: Pick<TemplateRow, 'attachmentType' | 'headerMediaKey' | 'headerSampleUrl'>,
): Promise<string | null> {
  if (headerFormatOf(row.attachmentType) === 'location') return null;
  const stored = await storedHeaderUrl(link, row);
  if (stored) return stored;
  return row.headerSampleUrl && /^https?:\/\//i.test(row.headerSampleUrl)
    ? row.headerSampleUrl
    : null;
}

/** The template detail with a link to its stored header file (null when none was stored). */
export async function detailWithMedia(
  storage: MediaStorageService,
  row: TemplateRow,
): Promise<TemplateDetail> {
  return {
    ...toDetail(row),
    headerMediaUrl: await storedHeaderUrl(await storage.linker(MEDIA_PREVIEW_TTL_S), row),
  };
}
